/**
 * Smoke: Brier Score learning engine — score, targets, EMA, clamps.
 * Usage: npx tsx scripts/verify-learning-engine.ts
 */
import {
  BRIER_EMA,
  BRIER_FACTOR_MAX,
  BRIER_FACTOR_MIN,
  BRIER_OVERCONFIDENT,
  BRIER_UNDERCONFIDENT,
  applyBrierLearningToWeights,
  blendBrierFactor,
  brierScore,
  clampBrierFactor,
  combineBrierFactors,
  meanBrier,
  targetBrierFactor,
  teamPairBrierFactor,
  type BrierPickRow,
} from "../lib/learning-engine";
import { DEFAULT_MODEL_WEIGHTS } from "../lib/model-weights";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(Math.abs(brierScore(0.8, 1) - 0.04) < 1e-12, "brier win");
assert(Math.abs(brierScore(0.8, 0) - 0.64) < 1e-12, "brier loss");
assert(Math.abs(meanBrier([0.04, 0.64]) - 0.34) < 1e-12, "mean brier");
assert(BRIER_EMA === 0.2, "ema alpha");
assert(clampBrierFactor(0.5) === BRIER_FACTOR_MIN, "factor floor");
assert(clampBrierFactor(2) === BRIER_FACTOR_MAX, "factor ceiling");

const overTarget = targetBrierFactor(0.4, -0.1, 1, 20);
assert(overTarget < 1, "overconfident shrinks");
assert(overTarget >= 1 * (1 - 0.08) - 1e-9, "shrink ≤8%");
assert(overTarget <= 1 * (1 - 0.03) + 1e-9, "shrink ≥3%");

const underTarget = targetBrierFactor(0.1, 0.05, 1, 20);
assert(Math.abs(underTarget - 1.03) < 1e-9, "underconfident +3%");

const noBoost = targetBrierFactor(0.1, -0.05, 1, 20);
assert(noBoost === 1 || Math.abs(noBoost - 1) < 0.01, "no boost without ROI");

const tiny = targetBrierFactor(0.5, -0.2, 1, 3);
assert(tiny === 1, "N<5 no change");

const blended = blendBrierFactor(1, 0.92);
assert(
  Math.abs(blended - (0.8 * 1 + 0.2 * 0.92)) < 1e-9,
  "EMA 0.20 blend"
);

assert(
  Math.abs(teamPairBrierFactor(0.9, 1) - Math.sqrt(0.9)) < 1e-9,
  "geo mean team pair"
);

const combined = combineBrierFactors(0.95, 0.97, 1.0);
assert(combined < 1 && combined > 0.9, "combined stack");

function rows(
  league: string,
  market: string,
  n: number,
  wins: number,
  p: number,
  odds: number
): BrierPickRow[] {
  return Array.from({ length: n }, (_, i) => ({
    league,
    leagueId: "39",
    market,
    modelProbability: p,
    odds,
    outcome: i < wins ? ("WON" as const) : ("LOST" as const),
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
  }));
}

// Overconfident: p=0.9 but only 50% WR → high Brier
const overRows = rows("Premier League", "over_1_5", 20, 10, 0.9, 1.2);
const overMean = meanBrier(
  overRows.map((r) => brierScore(r.modelProbability, r.outcome === "WON" ? 1 : 0))
);
assert(overMean > BRIER_OVERCONFIDENT, "synthetic overconfident BS");

const learned = applyBrierLearningToWeights(
  overRows,
  structuredClone(DEFAULT_MODEL_WEIGHTS)
);
assert(learned.sampleSize === 20, "sample size");
assert(learned.overallMeanBrier > BRIER_OVERCONFIDENT, "overall BS");
const leagueFactor =
  learned.weights.leagues["39"]?.brierCalibrationFactor ??
  learned.weights.leagues["Premier League"]?.brierCalibrationFactor ??
  1;
assert(leagueFactor < 1, "league factor shrunk");
assert(
  (learned.weights.markets.over_1_5?.brierCalibrationFactor ?? 1) < 1,
  "market factor shrunk"
);
assert(
  (learned.weights.teams?.Arsenal?.brierCalibrationFactor ?? 1) < 1,
  "team factor shrunk"
);

// Well-calibrated high WR + low Brier + positive ROI → mild boost path
const goodRows = rows("La Liga", "1x", 20, 18, 0.82, 1.25);
const goodMean = meanBrier(
  goodRows.map((r) => brierScore(r.modelProbability, r.outcome === "WON" ? 1 : 0))
);
assert(goodMean < BRIER_UNDERCONFIDENT, "synthetic underconfident BS");
const good = applyBrierLearningToWeights(
  goodRows,
  structuredClone(DEFAULT_MODEL_WEIGHTS)
);
const goodMkt = good.weights.markets["1x"]?.brierCalibrationFactor ?? 1;
assert(goodMkt > 1, "good market boosted");

console.log("verify-learning-engine: OK");
