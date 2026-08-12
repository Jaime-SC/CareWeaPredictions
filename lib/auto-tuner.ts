import { existsSync, readFileSync } from "fs";
import path from "path";
import type { TrainingFeatureRow } from "./bet-types";
import { prisma } from "./db";
import {
  DEFAULT_MODEL_WEIGHTS,
  loadModelWeights,
  saveModelWeights,
  type LeagueWeightConfig,
  type MarketWeightConfig,
  type ModelWeights,
} from "./model-weights";

const MIN_LEAGUE_SAMPLE = 5;
const MIN_MARKET_SAMPLE = 5;
const LOW_WIN_RATE = 0.7;
const HIGH_WIN_RATE = 0.88;

export interface HistoricalPickRow {
  league: string;
  market: string;
  selection?: string;
  modelProbability: number;
  odds: number;
  outcome: "WON" | "LOST" | "PENDING" | "VOID" | string;
}

export interface CalibrationResult {
  weights: ModelWeights;
  message: string;
  leaguesAdjusted: number;
  marketsAdjusted: number;
  sampleSize: number;
  over15MinProbability: number;
}

type Agg = {
  won: number;
  lost: number;
  staked: number;
  returned: number;
  probSum: number;
};

function emptyAgg(): Agg {
  return { won: 0, lost: 0, staked: 0, returned: 0, probSum: 0 };
}

function pushOutcome(agg: Agg, row: HistoricalPickRow): void {
  const outcome = String(row.outcome).toUpperCase();
  if (outcome !== "WON" && outcome !== "LOST") return;

  const odds = row.odds > 1 ? row.odds : 1;
  // Unit stake per pick for ROI
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
    const league = (row.league || "Otros").trim() || "Otros";
    const market = String(row.market || "unknown");

    const lAgg = leagueMap.get(league) ?? emptyAgg();
    pushOutcome(lAgg, row);
    leagueMap.set(league, lAgg);

    const mAgg = marketMap.get(market) ?? emptyAgg();
    pushOutcome(mAgg, row);
    marketMap.set(market, mAgg);
  }

  const leagues: Record<string, LeagueWeightConfig> = {
    ...previous.leagues,
  };
  let leaguesAdjusted = 0;

  for (const [league, agg] of leagueMap) {
    const n = sampleSize(agg);
    if (n < MIN_LEAGUE_SAMPLE) continue;

    const wr = winRate(agg);
    let riskPenalty = 1;
    let probabilityScale = 1;
    let minOdds = previous.global.defaultMinOdds;
    let minProbabilityBoost = 0;

    if (wr < LOW_WIN_RATE) {
      // Underperforming → raise risk penalty / require higher confidence
      const deficit = LOW_WIN_RATE - wr;
      riskPenalty = Number((1 + Math.min(0.25, deficit * 0.8)).toFixed(3));
      probabilityScale = Number(
        (1 - Math.min(0.12, deficit * 0.5)).toFixed(3)
      );
      minProbabilityBoost = Number(
        Math.min(0.08, 0.03 + deficit * 0.2).toFixed(3)
      );
      minOdds = Number((previous.global.defaultMinOdds + 0.03).toFixed(3));
      leaguesAdjusted += 1;
    } else if (wr > HIGH_WIN_RATE) {
      // Highly predictable → ease odds floor slightly
      riskPenalty = 0.97;
      probabilityScale = 1.02;
      minProbabilityBoost = -0.02;
      minOdds = Number(
        Math.max(1.08, previous.global.defaultMinOdds - 0.04).toFixed(3)
      );
      leaguesAdjusted += 1;
    } else {
      // Stable band — keep mild defaults but still record stats
      riskPenalty = 1;
      probabilityScale = 1;
      minProbabilityBoost = 0;
      minOdds = previous.global.defaultMinOdds;
    }

    leagues[league] = {
      riskPenalty,
      probabilityScale,
      minOdds,
      minProbabilityBoost,
      winRate: Number(wr.toFixed(4)),
      sampleSize: n,
    };
  }

  const markets: Record<string, MarketWeightConfig> = {
    ...previous.markets,
  };
  let marketsAdjusted = 0;

  for (const [market, agg] of marketMap) {
    const n = sampleSize(agg);
    if (n < MIN_MARKET_SAMPLE) continue;

    const wr = winRate(agg);
    const marketRoi = roi(agg);
    let weight = 1;
    let minProbability = previous.global.strictMinProbability;
    let disabled = false;

    if (marketRoi < -0.25) {
      weight = 0.35;
      minProbability = Math.min(0.92, previous.global.strictMinProbability + 0.08);
      disabled = marketRoi < -0.45;
      marketsAdjusted += 1;
    } else if (marketRoi < 0) {
      weight = 0.65;
      minProbability = Math.min(0.9, previous.global.strictMinProbability + 0.04);
      marketsAdjusted += 1;
    } else if (marketRoi > 0.15 && wr >= 0.8) {
      weight = 1.15;
      minProbability = Math.max(0.72, previous.global.strictMinProbability - 0.02);
      marketsAdjusted += 1;
    } else {
      weight = 1;
      minProbability = previous.global.strictMinProbability;
    }

    markets[market] = {
      weight: Number(weight.toFixed(3)),
      minProbability: Number(minProbability.toFixed(4)),
      disabled,
      roi: Number((marketRoi * 100).toFixed(2)),
      winRate: Number(wr.toFixed(4)),
      sampleSize: n,
    };
  }

  // Global +1.5 goals threshold from over_1_5 performance
  let over15MinProbability = previous.global.over15MinProbability;
  const overAgg = marketMap.get("over_1_5");
  if (overAgg && sampleSize(overAgg) >= MIN_MARKET_SAMPLE) {
    const wr = winRate(overAgg);
    const r = roi(overAgg);
    if (r < 0 || wr < 0.75) {
      over15MinProbability = Number(
        Math.min(0.9, 0.78 + (0.75 - Math.min(wr, 0.75)) * 0.4 + 0.03).toFixed(
          3
        )
      );
    } else if (wr >= 0.88) {
      over15MinProbability = 0.76;
    } else {
      over15MinProbability = 0.78 + (wr < 0.82 ? 0.03 : 0);
      over15MinProbability = Number(over15MinProbability.toFixed(3));
    }
  }

  // Global strict gate: blend previous with empirical hit rate
  let strictMinProbability = previous.global.strictMinProbability;
  if (evaluated.length >= 15) {
    const overall = emptyAgg();
    for (const row of evaluated) pushOutcome(overall, row);
    const wr = winRate(overall);
    if (wr < 0.72) {
      strictMinProbability = Number(
        Math.min(0.9, 0.78 + (0.72 - wr) * 0.5).toFixed(3)
      );
    } else if (wr > 0.88) {
      strictMinProbability = 0.76;
    }
  }

  const message = buildMessage({
    leaguesAdjusted,
    marketsAdjusted,
    over15MinProbability,
    sampleSize: evaluated.length,
  });

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
  };
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

/** Load training rows from Prisma SQLite (WON/LOST + PENDING for completeness). */
export async function loadHistoricalDataFromDb(): Promise<HistoricalPickRow[]> {
  const predictions = await prisma.prediction.findMany({
    include: { fixture: true },
    orderBy: { createdAt: "desc" },
  });

  return predictions.map((p) => ({
    league: p.fixture.leagueName,
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
      return {
        league: String(r.league ?? "Otros"),
        market: String(r.market ?? "unknown"),
        selection:
          typeof r.selection === "string" ? r.selection : undefined,
        modelProbability: Number.isFinite(modelProbability)
          ? modelProbability
          : 0,
        odds,
        outcome: String(r.outcome ?? "PENDING"),
      } satisfies HistoricalPickRow;
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
 * Full pipeline: load DB (+ optional JSON), calibrate, persist weights.
 */
export async function runAutoCalibration(options?: {
  extraRows?: HistoricalPickRow[] | TrainingFeatureRow[];
  jsonPath?: string;
}): Promise<CalibrationResult> {
  const fromDb = await loadHistoricalDataFromDb();
  const fromJson = loadHistoricalDataFromJsonFile(options?.jsonPath);
  const extra = normalizeTrainingRows(options?.extraRows ?? []);

  // Merge preferring DB ids uniqueness by league|market|odds|outcome|prob
  const merged = [...fromDb, ...fromJson, ...extra];
  const previous =
    loadModelWeights().sampleSize > 0
      ? loadModelWeights()
      : structuredClone(DEFAULT_MODEL_WEIGHTS);

  const result = calibrateModelParameters(merged, previous);
  saveModelWeights(result.weights);
  return result;
}
