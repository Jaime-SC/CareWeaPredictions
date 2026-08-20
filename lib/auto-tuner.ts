import { existsSync, readFileSync } from "fs";
import path from "path";
import type { TrainingFeatureRow } from "./bet-types";
import { prisma } from "./db";
import {
  DEFAULT_MODEL_WEIGHTS,
  MIN_ODDS_CEILING,
  MIN_ODDS_FLOOR,
  PROBABILITY_SCALE_MAX,
  PROBABILITY_SCALE_MIN,
  RISK_PENALTY_MAX,
  RISK_PENALTY_MIN,
  loadModelWeights,
  resetModelWeights,
  saveModelWeights,
  type LeagueWeightConfig,
  type MarketWeightConfig,
  type ModelWeights,
} from "./model-weights";
import {
  clampTuningMultiplier,
  resetTuningConfig,
  saveTuningConfig,
  type TuningConfig,
} from "./tuning-config";

/** Below this, keep factory-neutral weights. */
export const MIN_SAMPLE_PARTIAL = 5;
/** Full target (before EMA). */
export const MIN_SAMPLE_FULL = 15;
/** Min picks settled in one settle run before auto-calibration fires. */
export const MIN_SETTLEMENT_CALIBRATION_BATCH = 5;
/** Backward-compatible alias used by older call sites / smokes. */
export const MIN_TUNING_SAMPLE_SIZE = MIN_SAMPLE_PARTIAL;

export const LEARNING_RATE = 0.25;

const LOW_WIN_RATE = 0.7;
const HIGH_WIN_RATE = 0.88;
const LOW_ROI = -0.1;
const HIGH_ROI = 0.08;
const MARKET_BAD_ROI = -0.25;
const MARKET_DISABLE_ROI = -0.45;
const MARKET_GOOD_ROI = 0.15;
const MARKET_GOOD_WR = 0.8;

export interface HistoricalPickRow {
  league: string;
  leagueId?: string;
  market: string;
  selection?: string;
  modelProbability: number;
  odds: number;
  outcome: "WON" | "LOST" | "PENDING" | "VOID" | string;
}

export interface TuningBucketStat {
  key: string;
  leagueId?: string;
  leagueName?: string;
  sampleSize: number;
  won: number;
  lost: number;
  winRate: number;
  roi: number;
  multiplier: number;
}

export interface CalibrationResult {
  weights: ModelWeights;
  message: string;
  leaguesAdjusted: number;
  marketsAdjusted: number;
  sampleSize: number;
  over15MinProbability: number;
  skippedLowSample: number;
  leagues: TuningBucketStat[];
  markets: TuningBucketStat[];
}

export interface RecalibrationResult extends CalibrationResult {
  config: TuningConfig;
  totalBetsAnalyzed: number;
}

type Agg = {
  won: number;
  lost: number;
  staked: number;
  returned: number;
  probSum: number;
  leagueId?: string;
  leagueName?: string;
};

function emptyAgg(): Agg {
  return { won: 0, lost: 0, staked: 0, returned: 0, probSum: 0 };
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampProbabilityScale(value: number): number {
  return clamp(value, PROBABILITY_SCALE_MIN, PROBABILITY_SCALE_MAX);
}

export function clampRiskPenalty(value: number): number {
  return clamp(value, RISK_PENALTY_MIN, RISK_PENALTY_MAX);
}

export function clampMinOdds(value: number): number {
  return clamp(value, MIN_ODDS_FLOOR, MIN_ODDS_CEILING);
}

/** α from sample size: 0 / 0.5 / 1.0 */
export function sampleAdjustmentAlpha(n: number): number {
  if (n < MIN_SAMPLE_PARTIAL) return 0;
  if (n < MIN_SAMPLE_FULL) return 0.5;
  return 1;
}

/** EMA: (1 − lr) · old + lr · target */
export function emaBlend(
  previous: number,
  target: number,
  learningRate: number = LEARNING_RATE
): number {
  const prev = Number.isFinite(previous) ? previous : target;
  const next = Number.isFinite(target) ? target : prev;
  const lr = clamp(learningRate, 0, 1);
  return (1 - lr) * prev + lr * next;
}

function applySampleAndEma(
  previous: number,
  target: number,
  neutral: number,
  n: number,
  clampFn: (value: number) => number
): number {
  const alpha = sampleAdjustmentAlpha(n);
  const damped = (1 - alpha) * neutral + alpha * target;
  return clampFn(emaBlend(previous, damped, LEARNING_RATE));
}

function pushOutcome(agg: Agg, row: HistoricalPickRow): void {
  const outcome = String(row.outcome).toUpperCase();
  if (outcome !== "WON" && outcome !== "LOST") return;

  const odds = row.odds > 1 ? row.odds : 1;
  agg.staked += 1;
  agg.probSum += row.modelProbability || 0;

  if (outcome === "WON") {
    agg.won += 1;
    agg.returned += odds;
  } else {
    agg.lost += 1;
  }
}

function winRate(agg: Agg): number {
  const n = agg.won + agg.lost;
  return n > 0 ? agg.won / n : 0;
}

function roi(agg: Agg): number {
  if (agg.staked <= 0) return 0;
  return (agg.returned - agg.staked) / agg.staked;
}

function sampleSize(agg: Agg): number {
  return agg.won + agg.lost;
}

function round3(n: number): number {
  return Number(n.toFixed(3));
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function leagueBucketKey(row: HistoricalPickRow): string {
  const id = String(row.leagueId ?? "").trim();
  if (id && id.toLowerCase() !== "unknown") return id;
  return (row.league || "Otros").trim() || "Otros";
}

function marketKey(row: HistoricalPickRow): string {
  return String(row.market || "unknown").trim() || "unknown";
}

function leagueSeverity(wr: number, marketRoi: number): number {
  const wrDeficit = Math.max(0, LOW_WIN_RATE - wr);
  const roiDeficit = Math.max(0, LOW_ROI - marketRoi);
  return clamp(Math.max(wrDeficit / 0.2, roiDeficit / 0.35), 0, 1);
}

type LeagueBand = "low" | "high" | "neutral";

function leagueBand(wr: number, marketRoi: number): LeagueBand {
  if (wr < LOW_WIN_RATE || marketRoi < LOW_ROI) return "low";
  if (wr > HIGH_WIN_RATE && marketRoi > HIGH_ROI) return "high";
  return "neutral";
}

function leagueTargets(
  wr: number,
  marketRoi: number,
  defaultMinOdds: number
): Pick<
  LeagueWeightConfig,
  "riskPenalty" | "probabilityScale" | "minOdds" | "minProbabilityBoost"
> {
  const band = leagueBand(wr, marketRoi);
  if (band === "low") {
    const severity = leagueSeverity(wr, marketRoi);
    return {
      riskPenalty: 1.1 + severity * 0.15,
      probabilityScale: 0.95 - severity * 0.07,
      minOdds: defaultMinOdds + 0.03 + severity * 0.02,
      minProbabilityBoost: 0.02 + severity * 0.06,
    };
  }
  if (band === "high") {
    return {
      riskPenalty: 0.97,
      probabilityScale: 1.02,
      minOdds: defaultMinOdds - 0.02,
      minProbabilityBoost: -0.02,
    };
  }
  return {
    riskPenalty: 1,
    probabilityScale: 1,
    minOdds: defaultMinOdds,
    minProbabilityBoost: 0,
  };
}

function marketTargets(
  wr: number,
  marketRoi: number,
  n: number,
  strictMin: number
): Pick<MarketWeightConfig, "weight" | "minProbability" | "disabled"> {
  if (n >= MIN_SAMPLE_FULL && marketRoi < MARKET_DISABLE_ROI) {
    return {
      weight: 0.35,
      minProbability: Math.min(0.92, strictMin + 0.08),
      disabled: true,
    };
  }
  if (n >= MIN_SAMPLE_FULL && marketRoi < MARKET_BAD_ROI) {
    return {
      weight: 0.35,
      minProbability: Math.min(0.92, strictMin + 0.08),
      disabled: false,
    };
  }
  if (marketRoi > MARKET_GOOD_ROI && wr >= MARKET_GOOD_WR) {
    return {
      weight: 1.15,
      minProbability: Math.max(0.8, strictMin - 0.02),
      disabled: false,
    };
  }
  return {
    weight: 1,
    minProbability: strictMin,
    disabled: false,
  };
}

function poissonMultiplierFromScale(scale: number): number {
  return clampTuningMultiplier(scale);
}

function poissonMultiplierFromMarket(cfg: MarketWeightConfig): number {
  if (cfg.disabled) return clampTuningMultiplier(0.95);
  const t = (cfg.weight - 0.35) / (1.15 - 0.35);
  return clampTuningMultiplier(0.95 + clamp(t, 0, 1) * 0.1);
}

function defaultLeague(
  previous: ModelWeights,
  extra?: Partial<LeagueWeightConfig>
): LeagueWeightConfig {
  return {
    riskPenalty: 1,
    probabilityScale: 1,
    minOdds: previous.global.defaultMinOdds,
    minProbabilityBoost: 0,
    ...extra,
  };
}

/**
 * Core calibration: derive league penalties, market weights and global
 * probability thresholds from historical WON/LOST picks.
 */
export function calibrateModelParameters(
  historicalData: HistoricalPickRow[],
  previous: ModelWeights = loadModelWeights()
): CalibrationResult {
  const leagueMap = new Map<string, Agg>();
  const marketMap = new Map<string, Agg>();

  const evaluated = historicalData.filter((r) => {
    const o = String(r.outcome).toUpperCase();
    return o === "WON" || o === "LOST";
  });

  for (const row of evaluated) {
    const lk = leagueBucketKey(row);
    const mk = marketKey(row);

    const lAgg = leagueMap.get(lk) ?? emptyAgg();
    pushOutcome(lAgg, row);
    lAgg.leagueId = String(row.leagueId ?? lAgg.leagueId ?? lk);
    lAgg.leagueName = (row.league || lAgg.leagueName || lk).trim() || lk;
    leagueMap.set(lk, lAgg);

    const mAgg = marketMap.get(mk) ?? emptyAgg();
    pushOutcome(mAgg, row);
    marketMap.set(mk, mAgg);
  }

  const leagues: Record<string, LeagueWeightConfig> = {
    ...previous.leagues,
  };
  const leagueStats: TuningBucketStat[] = [];
  let leaguesAdjusted = 0;
  let skippedLowSample = 0;

  for (const [key, agg] of leagueMap) {
    const n = sampleSize(agg);
    const wr = winRate(agg);
    const r = roi(agg);
    const band = leagueBand(wr, r);

    if (n < MIN_SAMPLE_PARTIAL) {
      skippedLowSample += 1;
      leagueStats.push({
        key,
        leagueId: agg.leagueId,
        leagueName: agg.leagueName,
        sampleSize: n,
        won: agg.won,
        lost: agg.lost,
        winRate: round4(wr),
        roi: round4(r),
        multiplier: 1,
      });
      continue;
    }

    const prev =
      lookupPreviousLeague(previous, key, agg) ?? defaultLeague(previous);
    const target = leagueTargets(wr, r, previous.global.defaultMinOdds);

    const next: LeagueWeightConfig = {
      riskPenalty: round3(
        applySampleAndEma(
          prev.riskPenalty,
          target.riskPenalty,
          1,
          n,
          clampRiskPenalty
        )
      ),
      probabilityScale: round3(
        applySampleAndEma(
          prev.probabilityScale,
          target.probabilityScale,
          1,
          n,
          clampProbabilityScale
        )
      ),
      minOdds: round3(
        applySampleAndEma(
          prev.minOdds,
          target.minOdds,
          previous.global.defaultMinOdds,
          n,
          clampMinOdds
        )
      ),
      minProbabilityBoost: round3(
        applySampleAndEma(
          prev.minProbabilityBoost,
          target.minProbabilityBoost,
          0,
          n,
          (v) => clamp(v, -0.08, 0.12)
        )
      ),
      leagueId: agg.leagueId,
      leagueName: agg.leagueName,
      winRate: round4(wr),
      roi: round4(r),
      sampleSize: n,
    };

    leagues[key] = next;
    if (agg.leagueName && agg.leagueName !== key) {
      leagues[agg.leagueName] = next;
    }

    if (band !== "neutral") leaguesAdjusted += 1;

    leagueStats.push({
      key,
      leagueId: agg.leagueId,
      leagueName: agg.leagueName,
      sampleSize: n,
      won: agg.won,
      lost: agg.lost,
      winRate: round4(wr),
      roi: round4(r),
      multiplier: poissonMultiplierFromScale(next.probabilityScale),
    });
  }

  const markets: Record<string, MarketWeightConfig> = {
    ...previous.markets,
  };
  const marketStats: TuningBucketStat[] = [];
  let marketsAdjusted = 0;

  for (const [market, agg] of marketMap) {
    const n = sampleSize(agg);
    const wr = winRate(agg);
    const r = roi(agg);

    if (n < MIN_SAMPLE_PARTIAL) {
      skippedLowSample += 1;
      marketStats.push({
        key: market,
        sampleSize: n,
        won: agg.won,
        lost: agg.lost,
        winRate: round4(wr),
        roi: round4(r),
        multiplier: 1,
      });
      continue;
    }

    const prev = previous.markets[market] ?? {
      weight: 1,
      minProbability: previous.global.strictMinProbability,
      disabled: false,
    };
    const target = marketTargets(wr, r, n, previous.global.strictMinProbability);
    const next: MarketWeightConfig = {
      weight: round3(
        applySampleAndEma(prev.weight, target.weight, 1, n, (v) =>
          clamp(v, 0.2, 1.3)
        )
      ),
      minProbability: round4(
        applySampleAndEma(
          prev.minProbability || previous.global.strictMinProbability,
          target.minProbability,
          previous.global.strictMinProbability,
          n,
          (v) => clamp(v, 0.5, 0.95)
        )
      ),
      disabled:
        n >= MIN_SAMPLE_FULL ? target.disabled : Boolean(prev.disabled),
      roi: Number((r * 100).toFixed(2)),
      winRate: round4(wr),
      sampleSize: n,
    };

    markets[market] = next;
    if (
      next.disabled ||
      next.weight !== 1 ||
      (n >= MIN_SAMPLE_FULL && (r < MARKET_BAD_ROI || (r > MARKET_GOOD_ROI && wr >= MARKET_GOOD_WR)))
    ) {
      marketsAdjusted += 1;
    }

    marketStats.push({
      key: market,
      sampleSize: n,
      won: agg.won,
      lost: agg.lost,
      winRate: round4(wr),
      roi: round4(r),
      multiplier: poissonMultiplierFromMarket(next),
    });
  }

  let over15MinProbability = previous.global.over15MinProbability;
  const overAgg = marketMap.get("over_1_5");
  if (overAgg && sampleSize(overAgg) >= MIN_SAMPLE_PARTIAL) {
    const n = sampleSize(overAgg);
    const wr = winRate(overAgg);
    const r = roi(overAgg);
    let target = previous.global.over15MinProbability;
    if (r < 0 || wr < 0.75) {
      target = Math.min(0.9, 0.78 + (0.75 - Math.min(wr, 0.75)) * 0.4 + 0.03);
    } else if (wr >= 0.88) {
      target = 0.76;
    } else {
      target = 0.78 + (wr < 0.82 ? 0.03 : 0);
    }
    over15MinProbability = round3(
      applySampleAndEma(
        previous.global.over15MinProbability,
        target,
        DEFAULT_MODEL_WEIGHTS.global.over15MinProbability,
        n,
        (v) => clamp(v, 0.7, 0.92)
      )
    );
  }

  let strictMinProbability = previous.global.strictMinProbability;
  if (evaluated.length >= MIN_SAMPLE_PARTIAL) {
    const overall = emptyAgg();
    for (const row of evaluated) pushOutcome(overall, row);
    const wr = winRate(overall);
    let target = previous.global.strictMinProbability;
    if (wr < 0.72) {
      target = Math.min(0.9, 0.78 + (0.72 - wr) * 0.5);
    } else if (wr > 0.88) {
      target = 0.76;
    }
    strictMinProbability = round3(
      applySampleAndEma(
        previous.global.strictMinProbability,
        target,
        DEFAULT_MODEL_WEIGHTS.global.strictMinProbability,
        evaluated.length,
        (v) => clamp(v, 0.5, 0.95)
      )
    );
  }

  const message = buildMessage({
    leaguesAdjusted,
    marketsAdjusted,
    over15MinProbability,
    sampleSize: evaluated.length,
  });

  leagueStats.sort((a, b) => b.sampleSize - a.sampleSize);
  marketStats.sort((a, b) => b.sampleSize - a.sampleSize);

  const weights: ModelWeights = {
    version: Math.max(1, previous.version) + (evaluated.length > 0 ? 1 : 0),
    calibratedAt: new Date().toISOString(),
    sampleSize: evaluated.length,
    global: {
      ...previous.global,
      strictMinProbability,
      over15MinProbability,
      backfillMinProbability: previous.global.backfillMinProbability,
    },
    leagues,
    markets,
    summary: {
      leaguesAdjusted,
      marketsAdjusted,
      message,
    },
  };

  return {
    weights,
    message,
    leaguesAdjusted,
    marketsAdjusted,
    sampleSize: evaluated.length,
    over15MinProbability,
    skippedLowSample,
    leagues: leagueStats,
    markets: marketStats,
  };
}

function lookupPreviousLeague(
  previous: ModelWeights,
  key: string,
  agg: Agg
): LeagueWeightConfig | undefined {
  return (
    previous.leagues[key] ??
    (agg.leagueId ? previous.leagues[agg.leagueId] : undefined) ??
    (agg.leagueName ? previous.leagues[agg.leagueName] : undefined)
  );
}

function buildMessage(opts: {
  leaguesAdjusted: number;
  marketsAdjusted: number;
  over15MinProbability: number;
  sampleSize: number;
}): string {
  if (opts.sampleSize === 0) {
    return "Sin picks resueltos: se mantienen los pesos por defecto.";
  }

  const parts: string[] = [];
  if (opts.leaguesAdjusted > 0) {
    parts.push(
      `${opts.leaguesAdjusted} liga${opts.leaguesAdjusted === 1 ? "" : "s"} ajustada${opts.leaguesAdjusted === 1 ? "" : "s"}`
    );
  }
  if (opts.marketsAdjusted > 0) {
    parts.push(
      `${opts.marketsAdjusted} mercado${opts.marketsAdjusted === 1 ? "" : "s"} recalibrado${opts.marketsAdjusted === 1 ? "" : "s"}`
    );
  }
  parts.push(
    `umbral de goles ajustado a ${(opts.over15MinProbability * 100).toFixed(0)}%`
  );

  return `Parámetros actualizados: ${parts.join(", ")}`;
}

export function deriveTuningConfig(weights: ModelWeights): TuningConfig {
  const leagueMultipliers: Record<string, number> = {};
  const marketMultipliers: Record<string, number> = {};

  for (const [key, cfg] of Object.entries(weights.leagues)) {
    leagueMultipliers[key] = poissonMultiplierFromScale(cfg.probabilityScale);
  }
  for (const [key, cfg] of Object.entries(weights.markets)) {
    marketMultipliers[key] = poissonMultiplierFromMarket(cfg);
  }

  return {
    lastCalibratedAt: weights.calibratedAt ?? new Date().toISOString(),
    totalBetsAnalyzed: weights.sampleSize,
    leagueMultipliers,
    marketMultipliers,
  };
}

/** Load training rows from Prisma (WON/LOST + PENDING for completeness). */
export async function loadHistoricalDataFromDb(): Promise<HistoricalPickRow[]> {
  const predictions = await prisma.prediction.findMany({
    where: { outcome: { in: ["WON", "LOST", "PENDING", "VOID"] } },
    select: {
      market: true,
      selection: true,
      modelProbability: true,
      odds: true,
      outcome: true,
      fixture: { select: { leagueName: true, leagueId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return predictions.map((p) => ({
    league: p.fixture.leagueName,
    leagueId: p.fixture.leagueId,
    market: p.market,
    selection: p.selection,
    modelProbability: p.modelProbability,
    odds: p.odds,
    outcome: p.outcome,
  }));
}

/** Accept TrainingFeatureRow[] / exported JSON payload. */
export function normalizeTrainingRows(
  rows: TrainingFeatureRow[] | HistoricalPickRow[] | unknown
): HistoricalPickRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      if (!r || typeof r !== "object") return null;
      const odds = Number(r.odds);
      const modelProbability = Number(r.modelProbability ?? 0);
      if (!Number.isFinite(odds)) return null;
      const leagueIdRaw = r.leagueId;
      const leagueId =
        leagueIdRaw != null && String(leagueIdRaw).trim()
          ? String(leagueIdRaw)
          : undefined;
      const row: HistoricalPickRow = {
        league: String(r.league ?? "Otros"),
        market: String(r.market ?? "unknown"),
        selection:
          typeof r.selection === "string" ? r.selection : undefined,
        modelProbability: Number.isFinite(modelProbability)
          ? modelProbability
          : 0,
        odds,
        outcome: String(r.outcome ?? "PENDING"),
      };
      if (leagueId) row.leagueId = leagueId;
      return row;
    })
    .filter((r): r is HistoricalPickRow => r !== null);
}

/** Read an exported training JSON file from disk (optional path). */
export function loadHistoricalDataFromJsonFile(
  filePath?: string
): HistoricalPickRow[] {
  const resolved =
    filePath ??
    path.join(process.cwd(), "config", "training-export.json");

  if (!existsSync(resolved)) return [];

  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8")) as {
      featureVectors?: unknown;
    } & unknown;

    if (Array.isArray(parsed)) {
      return normalizeTrainingRows(parsed);
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { featureVectors?: unknown }).featureVectors)
    ) {
      return normalizeTrainingRows(
        (parsed as { featureVectors: unknown[] }).featureVectors
      );
    }
    return [];
  } catch (err) {
    console.warn("[auto-tuner] Failed to read JSON export:", err);
    return [];
  }
}

/**
 * Unified pipeline: load settled WON/LOST picks, calibrate model-weights
 * and sync Poisson tuning multipliers.
 */
export async function recalibrateModel(options?: {
  extraRows?: HistoricalPickRow[] | TrainingFeatureRow[];
  jsonPath?: string;
}): Promise<RecalibrationResult> {
  const fromDb = await loadHistoricalDataFromDb();
  const fromJson = loadHistoricalDataFromJsonFile(options?.jsonPath);
  const extra = normalizeTrainingRows(options?.extraRows ?? []);
  const merged = [...fromDb, ...fromJson, ...extra];

  const result = calibrateModelParameters(merged, loadModelWeights());
  saveModelWeights(result.weights);
  const config = saveTuningConfig(deriveTuningConfig(result.weights));

  return {
    ...result,
    config,
    totalBetsAnalyzed: result.sampleSize,
  };
}

/** @deprecated Use `recalibrateModel()`. */
export async function runAutoCalibration(options?: {
  extraRows?: HistoricalPickRow[] | TrainingFeatureRow[];
  jsonPath?: string;
}): Promise<CalibrationResult> {
  return recalibrateModel(options);
}

/**
 * Hook for settlement: recalibrate only when a batch of ≥5 picks
 * was settled in the current run. Never throws — settlement must
 * succeed even if calibration fails.
 */
export async function maybeRecalibrateAfterSettlement(
  settledCount: number
): Promise<RecalibrationResult | null> {
  if (settledCount < MIN_SETTLEMENT_CALIBRATION_BATCH) return null;

  try {
    const result = await recalibrateModel();
    return result;
  } catch (err) {
    console.error("[AUTO-CALIBRATION] Failed:", err);
    return null;
  }
}

/** Restore factory-neutral model-weights + Poisson multipliers. */
export function resetCalibration(): {
  weights: ModelWeights;
  config: TuningConfig;
} {
  return {
    weights: resetModelWeights(),
    config: resetTuningConfig(),
  };
}
