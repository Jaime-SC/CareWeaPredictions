import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import path from "path";
import type { MarketType } from "./types";

export interface LeagueWeightConfig {
  /** Multiplies required min probability (>1 = stricter). */
  riskPenalty: number;
  /** Scales model probability for ranking/eligibility (<1 = more conservative). */
  probabilityScale: number;
  /** League-specific floor for bookmaker odds. */
  minOdds: number;
  /** Additive boost to min probability for this league. */
  minProbabilityBoost: number;
  winRate?: number;
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

function normalizeWeights(raw: Partial<ModelWeights> | null): ModelWeights {
  if (!raw || typeof raw !== "object") {
    return structuredClone(DEFAULT_MODEL_WEIGHTS);
  }

  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    calibratedAt:
      typeof raw.calibratedAt === "string" ? raw.calibratedAt : null,
    sampleSize: typeof raw.sampleSize === "number" ? raw.sampleSize : 0,
    global: {
      ...DEFAULT_MODEL_WEIGHTS.global,
      ...(raw.global ?? {}),
    },
    leagues: raw.leagues ?? {},
    markets: raw.markets ?? {},
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

export function getLeagueWeight(
  leagueName: string,
  weights = loadModelWeights()
): LeagueWeightConfig {
  const key = leagueName?.trim() || "Otros";
  const found =
    weights.leagues[key] ??
    weights.leagues[key.toLowerCase()] ??
    Object.entries(weights.leagues).find(
      ([k]) => k.toLowerCase() === key.toLowerCase()
    )?.[1];

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
  weights = loadModelWeights()
): number {
  const league = getLeagueWeight(leagueName, weights);
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
    m.startsWith("over_")
  );
}
