/**
 * Brier Score feedback → continuous calibration factors for league / market / team.
 * Complements ROI auto-tuner with probability-error learning (EMA α=0.20).
 */
import { prisma } from "./db";
import {
  MIN_SETTLEMENT_CALIBRATION_BATCH,
  clamp,
  emaBlend,
} from "./auto-tuner";
import {
  loadModelWeights,
  saveModelWeights,
  type LeagueWeightConfig,
  type MarketWeightConfig,
  type ModelWeights,
  type TeamBrierWeightConfig,
} from "./model-weights";
import { patchCachedBrierFactor } from "./team-profiler";

export const BRIER_EMA = 0.2;
export const BRIER_OVERCONFIDENT = 0.25;
export const BRIER_UNDERCONFIDENT = 0.15;
export const BRIER_MIN_SAMPLE = 5;
export const BRIER_FACTOR_MIN = 0.85;
export const BRIER_FACTOR_MAX = 1.08;
/** Combined league × market × team multiplier clamp. */
export const BRIER_COMBINED_MIN = 0.82;
export const BRIER_COMBINED_MAX = 1.12;

export type BrierPickRow = {
  league: string;
  leagueId?: string;
  market: string;
  modelProbability: number;
  odds: number;
  outcome: "WON" | "LOST";
  homeTeam: string;
  awayTeam: string;
};

export type BrierBucketStat = {
  key: string;
  sampleSize: number;
  meanBrier: number;
  roi: number;
  winRate: number;
  previousFactor: number;
  nextFactor: number;
  adjusted: boolean;
};

export type BrierLearningResult = {
  sampleSize: number;
  leaguesAdjusted: number;
  marketsAdjusted: number;
  teamsAdjusted: number;
  overallMeanBrier: number;
  leagues: BrierBucketStat[];
  markets: BrierBucketStat[];
  teams: BrierBucketStat[];
  weights: ModelWeights;
  message: string;
};

type Acc = {
  brierSum: number;
  won: number;
  lost: number;
  staked: number;
  returned: number;
};

function emptyAcc(): Acc {
  return { brierSum: 0, won: 0, lost: 0, staked: 0, returned: 0 };
}

function pushPick(acc: Acc, row: BrierPickRow): void {
  const y = row.outcome === "WON" ? 1 : 0;
  const p = clamp(row.modelProbability, 0, 1);
  acc.brierSum += brierScore(p, y);
  acc.staked += 1;
  if (y === 1) {
    acc.won += 1;
    acc.returned += row.odds > 1 ? row.odds : 1;
  } else {
    acc.lost += 1;
  }
}

function sampleSize(acc: Acc): number {
  return acc.won + acc.lost;
}

function meanBrierOf(acc: Acc): number {
  const n = sampleSize(acc);
  return n > 0 ? acc.brierSum / n : 0;
}

function roiOf(acc: Acc): number {
  return acc.staked > 0 ? (acc.returned - acc.staked) / acc.staked : 0;
}

function winRateOf(acc: Acc): number {
  const n = sampleSize(acc);
  return n > 0 ? acc.won / n : 0;
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function round3(n: number): number {
  return Number(n.toFixed(3));
}

/** Single-pick Brier: (p − y)² */
export function brierScore(predictedProbability: number, actualOutcome: 0 | 1): number {
  const p = Number.isFinite(predictedProbability) ? predictedProbability : 0;
  return Math.pow(p - actualOutcome, 2);
}

export function meanBrier(scores: number[]): number {
  if (scores.length === 0) return 0;
  let s = 0;
  for (const x of scores) s += x;
  return s / scores.length;
}

export function clampBrierFactor(value: number): number {
  return clamp(value, BRIER_FACTOR_MIN, BRIER_FACTOR_MAX);
}

/**
 * Target factor from mean Brier (+ ROI for underconfidence boost).
 * Overconfident (BS>0.25): shrink 3–8%. Underconfident (BS<0.15 & ROI>0): +3%.
 */
export function targetBrierFactor(
  meanBs: number,
  roi: number,
  previousFactor: number,
  n: number
): number {
  if (n < BRIER_MIN_SAMPLE) return previousFactor;

  const prev = clampBrierFactor(
    Number.isFinite(previousFactor) ? previousFactor : 1
  );

  if (meanBs > BRIER_OVERCONFIDENT) {
    const severity = clamp((meanBs - BRIER_OVERCONFIDENT) / 0.15, 0, 1);
    const shrink = 0.03 + 0.05 * severity; // 3% … 8%
    return clampBrierFactor(prev * (1 - shrink));
  }

  if (meanBs < BRIER_UNDERCONFIDENT && roi > 0) {
    return clampBrierFactor(prev * 1.03);
  }

  // Mild pull toward neutral when already well-calibrated
  if (meanBs <= 0.2) {
    return clampBrierFactor(emaBlend(prev, 1, 0.05));
  }

  return prev;
}

/** EMA α=0.20 toward target. */
export function blendBrierFactor(previous: number, target: number): number {
  return clampBrierFactor(emaBlend(previous, target, BRIER_EMA));
}

export function combineBrierFactors(
  leagueFactor: number,
  marketFactor: number,
  teamFactor: number
): number {
  const raw =
    clampBrierFactor(leagueFactor) *
    clampBrierFactor(marketFactor) *
    clampBrierFactor(teamFactor);
  return clamp(raw, BRIER_COMBINED_MIN, BRIER_COMBINED_MAX);
}

/** Geometric mean of home/away factors (milder than product). */
export function teamPairBrierFactor(home: number, away: number): number {
  const h = clampBrierFactor(Number.isFinite(home) ? home : 1);
  const a = clampBrierFactor(Number.isFinite(away) ? away : 1);
  return clampBrierFactor(Math.sqrt(h * a));
}

function leagueKey(row: BrierPickRow): string {
  const id = String(row.leagueId ?? "").trim();
  if (id && id.toLowerCase() !== "unknown") return id;
  return (row.league || "Otros").trim() || "Otros";
}

function updateBucket(
  map: Map<string, Acc>,
  key: string,
  row: BrierPickRow
): void {
  const acc = map.get(key) ?? emptyAcc();
  pushPick(acc, row);
  map.set(key, acc);
}

function resolveBucket(
  key: string,
  acc: Acc,
  previousFactor: number
): BrierBucketStat {
  const n = sampleSize(acc);
  const mean = meanBrierOf(acc);
  const roi = roiOf(acc);
  const wr = winRateOf(acc);
  const prev = clampBrierFactor(previousFactor);
  const target = targetBrierFactor(mean, roi, prev, n);
  const next = n >= BRIER_MIN_SAMPLE ? blendBrierFactor(prev, target) : prev;
  return {
    key,
    sampleSize: n,
    meanBrier: round4(mean),
    roi: round4(roi),
    winRate: round4(wr),
    previousFactor: round3(prev),
    nextFactor: round3(next),
    adjusted: n >= BRIER_MIN_SAMPLE && Math.abs(next - prev) >= 0.001,
  };
}

/**
 * Aggregate mean Brier by league, market, and team name (both sides of fixture).
 */
export function aggregateBrierBuckets(
  rows: BrierPickRow[],
  previous: ModelWeights
): {
  leagues: BrierBucketStat[];
  markets: BrierBucketStat[];
  teams: BrierBucketStat[];
  overallMeanBrier: number;
} {
  const leagueMap = new Map<string, Acc>();
  const marketMap = new Map<string, Acc>();
  const teamMap = new Map<string, Acc>();
  const overall = emptyAcc();

  for (const row of rows) {
    pushPick(overall, row);
    updateBucket(leagueMap, leagueKey(row), row);
    updateBucket(marketMap, String(row.market || "unknown").trim() || "unknown", row);
    const home = row.homeTeam.trim();
    const away = row.awayTeam.trim();
    if (home) updateBucket(teamMap, home, row);
    if (away) updateBucket(teamMap, away, row);
  }

  const prevLeagueFactor = (key: string): number => {
    const cfg =
      previous.leagues[key] ??
      Object.values(previous.leagues).find(
        (c) => c.leagueId === key || c.leagueName === key
      );
    return cfg?.brierCalibrationFactor ?? 1;
  };

  const prevMarketFactor = (key: string): number =>
    previous.markets[key]?.brierCalibrationFactor ?? 1;

  const prevTeamFactor = (name: string): number => {
    const direct = previous.teams?.[name]?.brierCalibrationFactor;
    if (direct != null) return direct;
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(previous.teams ?? {})) {
      if (k.toLowerCase() === lower) return v.brierCalibrationFactor ?? 1;
    }
    return 1;
  };

  const leagues = [...leagueMap.entries()]
    .map(([key, acc]) => resolveBucket(key, acc, prevLeagueFactor(key)))
    .sort((a, b) => b.sampleSize - a.sampleSize);

  const markets = [...marketMap.entries()]
    .map(([key, acc]) => resolveBucket(key, acc, prevMarketFactor(key)))
    .sort((a, b) => b.sampleSize - a.sampleSize);

  const teams = [...teamMap.entries()]
    .map(([key, acc]) => resolveBucket(key, acc, prevTeamFactor(key)))
    .sort((a, b) => b.sampleSize - a.sampleSize);

  return {
    leagues,
    markets,
    teams,
    overallMeanBrier: round4(meanBrierOf(overall)),
  };
}

function applyLeagueBrier(
  prev: LeagueWeightConfig | undefined,
  stat: BrierBucketStat,
  defaultMinOdds: number
): LeagueWeightConfig {
  return {
    riskPenalty: prev?.riskPenalty ?? 1,
    probabilityScale: prev?.probabilityScale ?? 1,
    minOdds: prev?.minOdds ?? defaultMinOdds,
    minProbabilityBoost: prev?.minProbabilityBoost ?? 0,
    leagueId: prev?.leagueId ?? ( /^\d+$/.test(stat.key) ? stat.key : undefined),
    leagueName: prev?.leagueName ?? (!/^\d+$/.test(stat.key) ? stat.key : undefined),
    winRate: prev?.winRate,
    roi: prev?.roi,
    sampleSize: prev?.sampleSize,
    brierCalibrationFactor: stat.nextFactor,
    meanBrierScore: stat.meanBrier,
  };
}

function applyMarketBrier(
  prev: MarketWeightConfig | undefined,
  stat: BrierBucketStat
): MarketWeightConfig {
  return {
    weight: prev?.weight ?? 1,
    minProbability: prev?.minProbability ?? 0,
    disabled: prev?.disabled ?? false,
    roi: prev?.roi,
    winRate: prev?.winRate,
    sampleSize: prev?.sampleSize,
    brierCalibrationFactor: stat.nextFactor,
    meanBrierScore: stat.meanBrier,
  };
}

/** Pure: merge Brier factors into a weights snapshot. */
export function applyBrierLearningToWeights(
  rows: BrierPickRow[],
  previous: ModelWeights = loadModelWeights()
): BrierLearningResult {
  const buckets = aggregateBrierBuckets(rows, previous);
  const leagues: Record<string, LeagueWeightConfig> = { ...previous.leagues };
  const markets: Record<string, MarketWeightConfig> = { ...previous.markets };
  const teams: Record<string, TeamBrierWeightConfig> = {
    ...(previous.teams ?? {}),
  };

  let leaguesAdjusted = 0;
  let marketsAdjusted = 0;
  let teamsAdjusted = 0;

  for (const stat of buckets.leagues) {
    if (stat.sampleSize < BRIER_MIN_SAMPLE) continue;
    const prev = leagues[stat.key];
    const next = applyLeagueBrier(prev, stat, previous.global.defaultMinOdds);
    leagues[stat.key] = next;
    if (next.leagueName && next.leagueName !== stat.key) {
      leagues[next.leagueName] = next;
    }
    if (stat.adjusted) leaguesAdjusted += 1;
  }

  for (const stat of buckets.markets) {
    if (stat.sampleSize < BRIER_MIN_SAMPLE) continue;
    markets[stat.key] = applyMarketBrier(markets[stat.key], stat);
    if (stat.adjusted) marketsAdjusted += 1;
  }

  for (const stat of buckets.teams) {
    if (stat.sampleSize < BRIER_MIN_SAMPLE) continue;
    const prev = teams[stat.key];
    teams[stat.key] = {
      brierCalibrationFactor: stat.nextFactor,
      meanBrierScore: stat.meanBrier,
      sampleSize: stat.sampleSize,
      teamName: stat.key,
      teamId: prev?.teamId,
    };
    if (stat.adjusted) teamsAdjusted += 1;
  }

  const message =
    rows.length === 0
      ? "Sin picks liquidados: factores Brier sin cambios."
      : `Brier learning: BS̄=${(buckets.overallMeanBrier * 100).toFixed(1)}% · ${leaguesAdjusted} ligas · ${marketsAdjusted} mercados · ${teamsAdjusted} equipos`;

  const weights: ModelWeights = {
    ...previous,
    leagues,
    markets,
    teams,
    calibratedAt: previous.calibratedAt ?? new Date().toISOString(),
    summary: previous.summary,
  };

  return {
    sampleSize: rows.length,
    leaguesAdjusted,
    marketsAdjusted,
    teamsAdjusted,
    overallMeanBrier: buckets.overallMeanBrier,
    leagues: buckets.leagues,
    markets: buckets.markets,
    teams: buckets.teams,
    weights,
    message,
  };
}

export async function loadSettledPicksForBrier(): Promise<BrierPickRow[]> {
  const predictions = await prisma.prediction.findMany({
    where: { outcome: { in: ["WON", "LOST"] } },
    select: {
      market: true,
      modelProbability: true,
      odds: true,
      outcome: true,
      fixture: {
        select: {
          leagueName: true,
          leagueId: true,
          homeTeam: true,
          awayTeam: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return predictions.map((p) => ({
    league: p.fixture.leagueName,
    leagueId: p.fixture.leagueId,
    market: p.market,
    modelProbability: p.modelProbability,
    odds: p.odds,
    outcome: p.outcome === "WON" ? ("WON" as const) : ("LOST" as const),
    homeTeam: p.fixture.homeTeam,
    awayTeam: p.fixture.awayTeam,
  }));
}

function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Persist team Brier factors onto matching TeamProfile rows (by name). */
export async function persistTeamBrierFactors(
  teams: BrierBucketStat[]
): Promise<number> {
  const eligible = teams.filter((t) => t.sampleSize >= BRIER_MIN_SAMPLE);
  if (eligible.length === 0) return 0;

  const profiles = await prisma.teamProfile.findMany({
    select: { id: true, teamId: true, teamName: true },
  });
  const byName = new Map(
    profiles.map((p) => [normalizeTeamName(p.teamName), p])
  );

  let updated = 0;
  for (const stat of eligible) {
    const profile = byName.get(normalizeTeamName(stat.key));
    if (!profile) continue;
    try {
      await prisma.teamProfile.update({
        where: { id: profile.id },
        data: { brierCalibrationFactor: stat.nextFactor },
      });
      patchCachedBrierFactor(profile.teamId, stat.nextFactor);
      updated += 1;
    } catch (err) {
      console.warn(
        `[learning-engine] TeamProfile Brier update failed for ${stat.key}:`,
        err
      );
    }
  }
  return updated;
}

/**
 * Full pipeline: load settled picks → Brier factors → model-weights + TeamProfile.
 */
export async function runBrierLearning(): Promise<BrierLearningResult> {
  const rows = await loadSettledPicksForBrier();
  const result = applyBrierLearningToWeights(rows, loadModelWeights());
  await saveModelWeights(result.weights);
  await persistTeamBrierFactors(result.teams);
  return result;
}

/**
 * Settlement hook: run when a batch of ≥5 legs settled. Never throws.
 */
export async function maybeUpdateBrierLearning(
  settledCount: number
): Promise<BrierLearningResult | null> {
  if (settledCount < MIN_SETTLEMENT_CALIBRATION_BATCH) return null;
  try {
    return await runBrierLearning();
  } catch (err) {
    console.error("[BRIER-LEARNING] Failed:", err);
    return null;
  }
}
