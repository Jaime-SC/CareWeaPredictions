import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import path from "path";
import { prisma } from "./db";
import type { MarketType } from "./types";

/** Hard clamps for calibrated league parameters. */
export const PROBABILITY_SCALE_MIN = 0.82;
export const PROBABILITY_SCALE_MAX = 1.12;
export const RISK_PENALTY_MIN = 0.85;
export const RISK_PENALTY_MAX = 1.3;
export const MIN_ODDS_FLOOR = 1.08;
export const MIN_ODDS_CEILING = 1.35;

export interface LeagueWeightConfig {
  /** Multiplies required min probability (>1 = stricter). */
  riskPenalty: number;
  /** Scales model probability for ranking/eligibility (<1 = more conservative). */
  probabilityScale: number;
  /** League-specific floor for bookmaker odds. */
  minOdds: number;
  /** Additive boost to min probability for this league. */
  minProbabilityBoost: number;
  /** Brier-driven multiplier on Poisson probs (1 = neutral). */
  brierCalibrationFactor?: number;
  /** Running mean Brier Score for this league. */
  meanBrierScore?: number;
  leagueId?: string;
  leagueName?: string;
  winRate?: number;
  roi?: number;
  sampleSize?: number;
}

export interface MarketWeightConfig {
  /** Ranking weight (1 = neutral). Lower → deprioritized. */
  weight: number;
  /** Extra minimum model probability for this market. */
  minProbability: number;
  disabled: boolean;
  /** Brier-driven multiplier on Poisson probs (1 = neutral). */
  brierCalibrationFactor?: number;
  meanBrierScore?: number;
  roi?: number;
  winRate?: number;
  sampleSize?: number;
}

/** Per-team Brier calibration (also mirrored on TeamProfile when matched). */
export interface TeamBrierWeightConfig {
  brierCalibrationFactor: number;
  meanBrierScore?: number;
  sampleSize?: number;
  teamId?: number;
  teamName?: string;
}

export interface ModelWeights {
  version: number;
  calibratedAt: string | null;
  sampleSize: number;
  global: {
    strictMinProbability: number;
    backfillMinProbability: number;
    /** Calibrated cutoff for +1.5 goals market family */
    over15MinProbability: number;
    defaultMinOdds: number;
    /** Multiplier applied to home λ (default 1.12). */
    homeAdvantage: number;
    /** Fallback per-side league average when home/away splits missing. */
    leagueAvgGoals: number;
    /** League average goals scored by home sides. */
    leagueAvgHomeGoals: number;
    /** League average goals scored by away sides. */
    leagueAvgAwayGoals: number;
  };
  leagues: Record<string, LeagueWeightConfig>;
  markets: Record<string, MarketWeightConfig>;
  /** Team-name keyed Brier factors from learning-engine. */
  teams?: Record<string, TeamBrierWeightConfig>;
  summary: {
    leaguesAdjusted: number;
    marketsAdjusted: number;
    message: string;
  };
}

/** Hard clamps for Brier calibration factors. */
export const BRIER_CALIBRATION_MIN = 0.85;
export const BRIER_CALIBRATION_MAX = 1.08;

export const DEFAULT_MODEL_WEIGHTS: ModelWeights = {
  version: 1,
  calibratedAt: null,
  sampleSize: 0,
  global: {
    strictMinProbability: 0.8,
    backfillMinProbability: 0.8,
    over15MinProbability: 0.8,
    defaultMinOdds: 1.12,
    homeAdvantage: 1.12,
    leagueAvgGoals: 1.35,
    leagueAvgHomeGoals: 1.45,
    leagueAvgAwayGoals: 1.15,
  },
  leagues: {},
  markets: {},
  teams: {},
  summary: {
    leaguesAdjusted: 0,
    marketsAdjusted: 0,
    message: "Pesos por defecto (sin calibración).",
  },
};

const WEIGHTS_RELATIVE = path.join("config", "model-weights.json");
const WEIGHTS_ROW_ID = "default";

let cached: ModelWeights | null = null;
let cachedMtimeMs = 0;
let dbHydrated = false;

export function getModelWeightsPath(): string {
  return path.join(process.cwd(), WEIGHTS_RELATIVE);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeLeagueConfig(
  raw: LeagueWeightConfig,
  defaultMinOdds: number
): LeagueWeightConfig {
  return {
    riskPenalty: clampNumber(raw.riskPenalty, RISK_PENALTY_MIN, RISK_PENALTY_MAX, 1),
    probabilityScale: clampNumber(
      raw.probabilityScale,
      PROBABILITY_SCALE_MIN,
      PROBABILITY_SCALE_MAX,
      1
    ),
    minOdds: clampNumber(raw.minOdds, MIN_ODDS_FLOOR, MIN_ODDS_CEILING, defaultMinOdds),
    minProbabilityBoost: clampNumber(raw.minProbabilityBoost, -0.08, 0.12, 0),
    brierCalibrationFactor: clampNumber(
      raw.brierCalibrationFactor,
      BRIER_CALIBRATION_MIN,
      BRIER_CALIBRATION_MAX,
      1
    ),
    meanBrierScore:
      typeof raw.meanBrierScore === "number" && Number.isFinite(raw.meanBrierScore)
        ? raw.meanBrierScore
        : undefined,
    leagueId: typeof raw.leagueId === "string" ? raw.leagueId : undefined,
    leagueName: typeof raw.leagueName === "string" ? raw.leagueName : undefined,
    winRate: typeof raw.winRate === "number" ? raw.winRate : undefined,
    roi: typeof raw.roi === "number" ? raw.roi : undefined,
    sampleSize: typeof raw.sampleSize === "number" ? raw.sampleSize : undefined,
  };
}

function normalizeMarketConfig(raw: MarketWeightConfig): MarketWeightConfig {
  return {
    weight: clampNumber(raw.weight, 0.2, 1.3, 1),
    minProbability: clampNumber(raw.minProbability, 0, 0.95, 0),
    disabled: Boolean(raw.disabled),
    brierCalibrationFactor: clampNumber(
      raw.brierCalibrationFactor,
      BRIER_CALIBRATION_MIN,
      BRIER_CALIBRATION_MAX,
      1
    ),
    meanBrierScore:
      typeof raw.meanBrierScore === "number" && Number.isFinite(raw.meanBrierScore)
        ? raw.meanBrierScore
        : undefined,
    roi: typeof raw.roi === "number" ? raw.roi : undefined,
    winRate: typeof raw.winRate === "number" ? raw.winRate : undefined,
    sampleSize: typeof raw.sampleSize === "number" ? raw.sampleSize : undefined,
  };
}

function normalizeTeamBrierConfig(
  raw: TeamBrierWeightConfig
): TeamBrierWeightConfig {
  return {
    brierCalibrationFactor: clampNumber(
      raw.brierCalibrationFactor,
      BRIER_CALIBRATION_MIN,
      BRIER_CALIBRATION_MAX,
      1
    ),
    meanBrierScore:
      typeof raw.meanBrierScore === "number" && Number.isFinite(raw.meanBrierScore)
        ? raw.meanBrierScore
        : undefined,
    sampleSize: typeof raw.sampleSize === "number" ? raw.sampleSize : undefined,
    teamId: typeof raw.teamId === "number" ? raw.teamId : undefined,
    teamName: typeof raw.teamName === "string" ? raw.teamName : undefined,
  };
}

function normalizeWeights(raw: Partial<ModelWeights> | null): ModelWeights {
  if (!raw || typeof raw !== "object") {
    return structuredClone(DEFAULT_MODEL_WEIGHTS);
  }

  const global = {
    ...DEFAULT_MODEL_WEIGHTS.global,
    ...(raw.global ?? {}),
  };
  global.defaultMinOdds = clampNumber(
    global.defaultMinOdds,
    MIN_ODDS_FLOOR,
    MIN_ODDS_CEILING,
    DEFAULT_MODEL_WEIGHTS.global.defaultMinOdds
  );
  global.strictMinProbability = clampNumber(
    global.strictMinProbability,
    0.5,
    0.95,
    DEFAULT_MODEL_WEIGHTS.global.strictMinProbability
  );
  global.over15MinProbability = clampNumber(
    global.over15MinProbability,
    0.7,
    0.92,
    DEFAULT_MODEL_WEIGHTS.global.over15MinProbability
  );

  const leagues: Record<string, LeagueWeightConfig> = {};
  for (const [key, cfg] of Object.entries(raw.leagues ?? {})) {
    if (!key || !cfg) continue;
    leagues[key] = normalizeLeagueConfig(cfg, global.defaultMinOdds);
  }

  const markets: Record<string, MarketWeightConfig> = {};
  for (const [key, cfg] of Object.entries(raw.markets ?? {})) {
    if (!key || !cfg) continue;
    markets[key] = normalizeMarketConfig(cfg);
  }

  const teams: Record<string, TeamBrierWeightConfig> = {};
  for (const [key, cfg] of Object.entries(raw.teams ?? {})) {
    if (!key || !cfg) continue;
    teams[key] = normalizeTeamBrierConfig(cfg);
  }

  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    calibratedAt:
      typeof raw.calibratedAt === "string" ? raw.calibratedAt : null,
    sampleSize: typeof raw.sampleSize === "number" ? raw.sampleSize : 0,
    global,
    leagues,
    markets,
    teams,
    summary: {
      ...DEFAULT_MODEL_WEIGHTS.summary,
      ...(raw.summary ?? {}),
    },
  };
}

function loadWeightsFromFileSync(): ModelWeights {
  const filePath = getModelWeightsPath();
  try {
    if (!existsSync(filePath)) {
      return structuredClone(DEFAULT_MODEL_WEIGHTS);
    }
    const stat = statSync(filePath);
    const parsed = JSON.parse(
      readFileSync(filePath, "utf8")
    ) as Partial<ModelWeights>;
    cachedMtimeMs = stat.mtimeMs;
    return normalizeWeights(parsed);
  } catch (err) {
    console.warn("[model-weights] file load failed, using defaults:", err);
    return structuredClone(DEFAULT_MODEL_WEIGHTS);
  }
}

async function persistWeightsToDb(weights: ModelWeights): Promise<void> {
  const payload = normalizeWeights(weights);
  await prisma.modelWeightsConfig.upsert({
    where: { id: WEIGHTS_ROW_ID },
    create: { id: WEIGHTS_ROW_ID, weights: payload as object },
    update: { weights: payload as object },
  });
}

async function seedDbFromFileIfEmpty(weights: ModelWeights): Promise<void> {
  try {
    const existing = await prisma.modelWeightsConfig.findUnique({
      where: { id: WEIGHTS_ROW_ID },
    });
    if (!existing) {
      await persistWeightsToDb(weights);
    }
  } catch (err) {
    console.warn("[model-weights] DB seed skipped:", err);
  }
}

/** Load from Neon (primary); seeds DB from config/model-weights.json when empty. */
export async function hydrateModelWeightsFromDb(): Promise<ModelWeights> {
  if (cached && dbHydrated) return cached;
  try {
    const row = await prisma.modelWeightsConfig.findUnique({
      where: { id: WEIGHTS_ROW_ID },
    });
    if (row?.weights && typeof row.weights === "object") {
      cached = normalizeWeights(row.weights as Partial<ModelWeights>);
      dbHydrated = true;
      return cached;
    }
  } catch (err) {
    console.warn("[model-weights] DB read failed, falling back to file:", err);
  }

  const fromFile = loadWeightsFromFileSync();
  cached = fromFile;
  dbHydrated = true;
  await seedDbFromFileIfEmpty(fromFile);
  return cached;
}

/** Load calibrated weights (sync cache → file seed → defaults). Call hydrateModelWeightsFromDb() in API handlers. */
export function loadModelWeights(): ModelWeights {
  if (cached) return cached;
  cached = loadWeightsFromFileSync();
  return cached;
}

/** Persist weights to Neon; config/model-weights.json is best-effort local mirror. */
export async function saveModelWeights(weights: ModelWeights): Promise<void> {
  const payload = normalizeWeights(weights);
  cached = payload;
  dbHydrated = true;

  try {
    await persistWeightsToDb(payload);
  } catch (err) {
    console.warn("[model-weights] DB write failed:", err);
  }

  const filePath = getModelWeightsPath();
  try {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    cachedMtimeMs = statSync(filePath).mtimeMs;
  } catch {
    // read-only serverless — Neon is source of truth
  }
}

export function invalidateModelWeightsCache(): void {
  cached = null;
  cachedMtimeMs = 0;
  dbHydrated = false;
}

/** Emergency wipe: restore factory-neutral weights in Neon (+ file when writable). */
export async function resetModelWeights(): Promise<ModelWeights> {
  const config = structuredClone(DEFAULT_MODEL_WEIGHTS);
  config.calibratedAt = new Date().toISOString();
  config.summary = {
    leaguesAdjusted: 0,
    marketsAdjusted: 0,
    message: "Pesos restaurados a valores de fábrica.",
  };
  try {
    await saveModelWeights(config);
    return loadModelWeights();
  } catch (err) {
    console.warn("[model-weights] reset write failed; in-memory defaults:", err);
    cached = config;
    cachedMtimeMs = 0;
    dbHydrated = true;
    return config;
  }
}

function lookupLeagueConfig(
  weights: ModelWeights,
  candidates: Array<string | number | undefined | null>
): LeagueWeightConfig | undefined {
  const index = new Map<string, LeagueWeightConfig>();
  for (const [key, value] of Object.entries(weights.leagues)) {
    index.set(key, value);
    index.set(key.trim().toLowerCase(), value);
    if (value.leagueId) {
      index.set(String(value.leagueId), value);
      index.set(String(value.leagueId).toLowerCase(), value);
    }
    if (value.leagueName) {
      index.set(value.leagueName, value);
      index.set(value.leagueName.trim().toLowerCase(), value);
    }
  }

  for (const candidate of candidates) {
    if (candidate == null) continue;
    const raw = String(candidate).trim();
    if (!raw || raw.toLowerCase() === "unknown") continue;
    const hit = index.get(raw) ?? index.get(raw.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

export function getLeagueWeight(
  leagueName: string,
  weights = loadModelWeights(),
  leagueId?: string | number
): LeagueWeightConfig {
  const found = lookupLeagueConfig(weights, [leagueId, leagueName]);

  return (
    found ?? {
      riskPenalty: 1,
      probabilityScale: 1,
      minOdds: weights.global.defaultMinOdds,
      minProbabilityBoost: 0,
      brierCalibrationFactor: 1,
    }
  );
}

export function getMarketWeight(
  market: MarketType | string,
  weights = loadModelWeights()
): MarketWeightConfig {
  const key = String(market);
  return (
    weights.markets[key] ?? {
      weight: 1,
      minProbability: 0,
      disabled: false,
      brierCalibrationFactor: 1,
    }
  );
}

/** Team Brier factor from model-weights (name or id); 1 if unknown. */
export function getTeamBrierFactor(
  teamNameOrId: string | number | undefined | null,
  weights = loadModelWeights()
): number {
  if (teamNameOrId == null) return 1;
  const teams = weights.teams ?? {};
  const raw = String(teamNameOrId).trim();
  if (!raw) return 1;
  const direct = teams[raw];
  if (direct) return direct.brierCalibrationFactor ?? 1;
  const lower = raw.toLowerCase();
  for (const [key, cfg] of Object.entries(teams)) {
    if (key.toLowerCase() === lower) return cfg.brierCalibrationFactor ?? 1;
    if (cfg.teamId != null && String(cfg.teamId) === raw) {
      return cfg.brierCalibrationFactor ?? 1;
    }
  }
  return 1;
}

/** Effective minimum probability for a market in a league. */
export function resolveMinProbability(
  baseMin: number,
  market: MarketType | string,
  leagueName: string,
  weights = loadModelWeights(),
  leagueId?: string | number
): number {
  const league = getLeagueWeight(leagueName, weights, leagueId);
  const mkt = getMarketWeight(market, weights);

  let min = baseMin * league.riskPenalty + league.minProbabilityBoost;

  if (mkt.minProbability > 0) {
    min = Math.max(min, mkt.minProbability);
  }

  // Goals market family uses calibrated over15 threshold when higher
  if (keyIsGoalsMarket(market)) {
    min = Math.max(min, weights.global.over15MinProbability * 0.95);
  }

  return Math.min(0.95, Math.max(0.5, Number(min.toFixed(4))));
}

function keyIsGoalsMarket(market: MarketType | string): boolean {
  const m = String(market);
  return (
    m === "over_1_5" ||
    m === "over_0_5" ||
    m === "over_2_5" ||
    m === "home_over_1_5" ||
    m === "away_over_1_5" ||
    m === "btts_yes" ||
    m === "btts_no" ||
    m.startsWith("over_")
  );
}
