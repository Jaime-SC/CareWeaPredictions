/**
 * Algorithm health & bias analytics: calibration / win-rate by market & league.
 */
import { prisma } from "./db";
import { marketGroupLabel } from "./history-tracker";
import { impliedProbability } from "./poisson";

export type BiasBucket = {
  key: string;
  label: string;
  total: number;
  won: number;
  lost: number;
  voided: number;
  winRate: number;
  /** Average model probability on evaluated legs */
  avgModelProb: number;
  /** Average bookmaker implied probability */
  avgImpliedProb: number;
  /** avgModel − avgImplied (positive = model optimistic vs book) */
  avgEdge: number;
  /**
   * Calibration gap: avgModelProb − empirical winRate.
   * Positive ⇒ model over-confident; negative ⇒ under-confident.
   */
  calibrationGap: number;
  /** Rough health: "healthy" | "overconfident" | "underconfident" | "thin" */
  health: "healthy" | "overconfident" | "underconfident" | "thin";
};

export type AlgorithmHealthReport = {
  evaluatedLegs: number;
  overallWinRate: number;
  overallAvgModelProb: number;
  overallCalibrationGap: number;
  byMarket: BiasBucket[];
  byLeague: BiasBucket[];
  generatedAt: string;
};

function classifyHealth(
  total: number,
  calibrationGap: number
): BiasBucket["health"] {
  if (total < 8) return "thin";
  if (calibrationGap >= 0.08) return "overconfident";
  if (calibrationGap <= -0.08) return "underconfident";
  return "healthy";
}

function buildBuckets(
  rows: Array<{
    key: string;
    label: string;
    outcome: string;
    modelProbability: number;
    odds: number;
  }>
): BiasBucket[] {
  type Acc = {
    label: string;
    won: number;
    lost: number;
    voided: number;
    modelSum: number;
    impliedSum: number;
    edgeSum: number;
    nEval: number;
  };

  const map = new Map<string, Acc>();

  for (const row of rows) {
    const cur = map.get(row.key) ?? {
      label: row.label,
      won: 0,
      lost: 0,
      voided: 0,
      modelSum: 0,
      impliedSum: 0,
      edgeSum: 0,
      nEval: 0,
    };

    const outcome = row.outcome.toUpperCase();
    if (outcome === "WON") cur.won += 1;
    else if (outcome === "LOST") cur.lost += 1;
    else if (outcome === "VOID" || outcome === "PUSH") cur.voided += 1;
    else continue;

    if (outcome === "WON" || outcome === "LOST") {
      const implied = impliedProbability(row.odds);
      cur.modelSum += row.modelProbability;
      cur.impliedSum += implied;
      cur.edgeSum += row.modelProbability - implied;
      cur.nEval += 1;
    }

    map.set(row.key, cur);
  }

  return Array.from(map.entries())
    .map(([key, v]) => {
      const decided = v.won + v.lost;
      const winRate = decided > 0 ? v.won / decided : 0;
      const avgModelProb = v.nEval > 0 ? v.modelSum / v.nEval : 0;
      const avgImpliedProb = v.nEval > 0 ? v.impliedSum / v.nEval : 0;
      const avgEdge = v.nEval > 0 ? v.edgeSum / v.nEval : 0;
      const calibrationGap = avgModelProb - winRate;
      return {
        key,
        label: v.label,
        total: decided + v.voided,
        won: v.won,
        lost: v.lost,
        voided: v.voided,
        winRate,
        avgModelProb,
        avgImpliedProb,
        avgEdge,
        calibrationGap,
        health: classifyHealth(decided, calibrationGap),
      };
    })
    .sort((a, b) => b.total - a.total);
}

export async function buildAlgorithmHealthReport(): Promise<AlgorithmHealthReport> {
  const predictions = await prisma.prediction.findMany({
    where: {
      outcome: { in: ["WON", "LOST", "VOID"] },
    },
    include: { fixture: true },
  });

  const marketRows = predictions.map((p) => ({
    key: p.market,
    label: marketGroupLabel(p.market, p.selection),
    outcome: p.outcome,
    modelProbability: p.modelProbability,
    odds: p.odds,
  }));

  const leagueRows = predictions.map((p) => ({
    key: p.fixture.leagueName || "Otros",
    label: p.fixture.leagueName || "Otros",
    outcome: p.outcome,
    modelProbability: p.modelProbability,
    odds: p.odds,
  }));

  const byMarket = buildBuckets(marketRows);
  const byLeague = buildBuckets(leagueRows);

  let won = 0;
  let lost = 0;
  let modelSum = 0;
  let n = 0;
  for (const p of predictions) {
    const o = p.outcome.toUpperCase();
    if (o === "WON") {
      won += 1;
      modelSum += p.modelProbability;
      n += 1;
    } else if (o === "LOST") {
      lost += 1;
      modelSum += p.modelProbability;
      n += 1;
    }
  }

  const evaluatedLegs = won + lost;
  const overallWinRate = evaluatedLegs > 0 ? won / evaluatedLegs : 0;
  const overallAvgModelProb = n > 0 ? modelSum / n : 0;
  const overallCalibrationGap = overallAvgModelProb - overallWinRate;

  return {
    evaluatedLegs,
    overallWinRate,
    overallAvgModelProb,
    overallCalibrationGap,
    byMarket,
    byLeague,
    generatedAt: new Date().toISOString(),
  };
}
