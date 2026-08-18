import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import path from "path";
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
  roi?: number;
  winRate?: number;
  sampleSize?: number;
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
  summary: {
    leaguesAdjusted: number;
    marketsAdjusted: number;
    message: string;
  };
}

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
  summary: {
    leaguesAdjusted: 0,
    marketsAdjusted: 0,
    message: "Pesos por defecto (sin calibración).",
  },
};

const WEIGHTS_RELATIVE = path.join("config", "model-weights.json");

let cached: ModelWeights | null = null;
let cachedMtimeMs = 0;

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
    roi: typeof raw.roi === "number" ? raw.roi : undefined,
    winRate: typeof raw.winRate === "number" ? raw.winRate : undefined,
    sampleSize: typeof raw.sampleSize === "number" ? raw.sampleSize : undefined,
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

  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    calibratedAt:
      typeof raw.calibratedAt === "string" ? raw.calibratedAt : null,
    sampleSize: typeof raw.sampleSize === "number" ? raw.sampleSize : 0,
    global,
    leagues,
    markets,
    summary: {
      ...DEFAULT_MODEL_WEIGHTS.summary,
      ...(raw.summary ?? {}),
    },
  };
}

/** Load calibrated weights from disk (cached; refreshes on file mtime change). */
export function loadModelWeights(): ModelWeights {
  const filePath = getModelWeightsPath();

  try {
    if (!existsSync(filePath)) {
      cached = structuredClone(DEFAULT_MODEL_WEIGHTS);
      return cached;
    }

    const stat = statSync(filePath);
    if (cached && stat.mtimeMs === cachedMtimeMs) {
      return cached;
    }

    const parsed = JSON.parse(
      readFileSync(filePath, "utf8")
    ) as Partial<ModelWeights>;
    cached = normalizeWeights(parsed);
    cachedMtimeMs = stat.mtimeMs;
    return cached;
  } catch (err) {
    console.warn("[model-weights] Failed to load, using defaults:", err);
    cached = structuredClone(DEFAULT_MODEL_WEIGHTS);
    return cached;
  }
}

/** Persist weights and invalidate in-memory cache. */
export function saveModelWeights(weights: ModelWeights): void {
  const filePath = getModelWeightsPath();
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const payload: ModelWeights = normalizeWeights(weights);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  cached = payload;
  try {
    cachedMtimeMs = statSync(filePath).mtimeMs;
  } catch {
    cachedMtimeMs = Date.now();
  }
}

export function invalidateModelWeightsCache(): void {
  cached = null;
  cachedMtimeMs = 0;
}

/** Emergency wipe: restore factory-neutral weights on disk. */
export function resetModelWeights(): ModelWeights {
  const config = structuredClone(DEFAULT_MODEL_WEIGHTS);
  config.calibratedAt = new Date().toISOString();
  config.summary = {
    leaguesAdjusted: 0,
    marketsAdjusted: 0,
    message: "Pesos restaurados a valores de fábrica.",
  };
  try {
    saveModelWeights(config);
    return loadModelWeights();
  } catch (err) {
    console.warn("[model-weights] reset write failed; in-memory defaults:", err);
    cached = config;
    cachedMtimeMs = 0;
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
    }
  );
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
    m.startsWith("over_")
  );
}
