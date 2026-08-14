import { prisma } from "./db";
import {
  clampTuningMultiplier,
  NEUTRAL_TUNING_MULTIPLIER,
  saveTuningConfig,
  type TuningConfig,
} from "./tuning-config";

/** Require at least this many settled bets before any non-neutral multiplier. */
export const MIN_TUNING_SAMPLE_SIZE = 20;

const LOW_WIN_RATE = 0.65;
const HIGH_WIN_RATE = 0.85;

export interface TuningBucketStat {
  key: string;
  sampleSize: number;
  won: number;
  lost: number;
  winRate: number;
  multiplier: number;
}

export interface RecalibrationResult {
  config: TuningConfig;
  totalBetsAnalyzed: number;
  leaguesAdjusted: number;
  marketsAdjusted: number;
  skippedLowSample: number;
  leagues: TuningBucketStat[];
  markets: TuningBucketStat[];
}

type SettledRow = {
  leagueId: string;
  market: string;
  outcome: string;
};

type Agg = { won: number; lost: number };

function emptyAgg(): Agg {
  return { won: 0, lost: 0 };
}

function sampleSize(agg: Agg): number {
  return agg.won + agg.lost;
}

function winRate(agg: Agg): number {
  const n = sampleSize(agg);
  return n > 0 ? agg.won / n : 0;
}

/**
 * Linear map WR∈[65%, 85%] → [0.95, 1.05], saturated at the bounds.
 * WR < 65% → 0.95; WR > 85% → 1.05.
 */
export function multiplierFromWinRate(historicalWinRate: number): number {
  if (!Number.isFinite(historicalWinRate)) return NEUTRAL_TUNING_MULTIPLIER;
  const t = (historicalWinRate - LOW_WIN_RATE) / (HIGH_WIN_RATE - LOW_WIN_RATE);
  const scaled =
    0.95 + t * (1.05 - 0.95);
  return clampTuningMultiplier(scaled);
}

export function multiplierForSample(
  historicalWinRate: number,
  n: number
): number {
  if (n < MIN_TUNING_SAMPLE_SIZE) return NEUTRAL_TUNING_MULTIPLIER;
  return multiplierFromWinRate(historicalWinRate);
}

function pushOutcome(agg: Agg, outcome: string): void {
  const o = outcome.toUpperCase();
  if (o === "WON") agg.won += 1;
  else if (o === "LOST") agg.lost += 1;
}

function leagueKey(row: SettledRow): string {
  const id = String(row.leagueId ?? "").trim();
  if (id && id.toLowerCase() !== "unknown") return id;
  return "unknown";
}

function marketKey(row: SettledRow): string {
  return String(row.market || "unknown").trim() || "unknown";
}

function toStats(
  map: Map<string, Agg>
): { stats: TuningBucketStat[]; multipliers: Record<string, number>; adjusted: number; skipped: number } {
  const stats: TuningBucketStat[] = [];
  const multipliers: Record<string, number> = {};
  let adjusted = 0;
  let skipped = 0;

  for (const [key, agg] of map) {
    const n = sampleSize(agg);
    const wr = winRate(agg);
    const multiplier = multiplierForSample(wr, n);
    if (n < MIN_TUNING_SAMPLE_SIZE) skipped += 1;
    else if (multiplier !== NEUTRAL_TUNING_MULTIPLIER) adjusted += 1;

    multipliers[key] = Number(multiplier.toFixed(4));
    stats.push({
      key,
      sampleSize: n,
      won: agg.won,
      lost: agg.lost,
      winRate: Number(wr.toFixed(4)),
      multiplier: multipliers[key],
    });
  }

  stats.sort((a, b) => b.sampleSize - a.sampleSize);
  return { stats, multipliers, adjusted, skipped };
}

async function loadSettledBetsFromDb(): Promise<SettledRow[]> {
  const predictions = await prisma.prediction.findMany({
    where: { outcome: { in: ["WON", "LOST"] } },
    include: { fixture: true },
  });

  return predictions
    .filter((p) => {
      const o = p.outcome.toUpperCase();
      return o === "WON" || o === "LOST";
    })
    .map((p) => ({
      leagueId: p.fixture.leagueId,
      market: p.market,
      outcome: p.outcome,
    }));
}

/**
 * Recalibrate ultra-conservative league/market multipliers from settled
 * SQLite history and persist them to `/data/tuning-config.json`.
 * Never writes source files.
 */
export async function recalibrateModel(): Promise<RecalibrationResult> {
  const settled = await loadSettledBetsFromDb();

  const leagueMap = new Map<string, Agg>();
  const marketMap = new Map<string, Agg>();

  for (const row of settled) {
    const lk = leagueKey(row);
    const mk = marketKey(row);

    const lAgg = leagueMap.get(lk) ?? emptyAgg();
    pushOutcome(lAgg, row.outcome);
    leagueMap.set(lk, lAgg);

    const mAgg = marketMap.get(mk) ?? emptyAgg();
    pushOutcome(mAgg, row.outcome);
    marketMap.set(mk, mAgg);
  }

  const leagues = toStats(leagueMap);
  const markets = toStats(marketMap);

  const config = saveTuningConfig({
    lastCalibratedAt: new Date().toISOString(),
    totalBetsAnalyzed: settled.length,
    leagueMultipliers: leagues.multipliers,
    marketMultipliers: markets.multipliers,
  });

  return {
    config,
    totalBetsAnalyzed: settled.length,
    leaguesAdjusted: leagues.adjusted,
    marketsAdjusted: markets.adjusted,
    skippedLowSample: leagues.skipped + markets.skipped,
    leagues: leagues.stats,
    markets: markets.stats,
  };
}
