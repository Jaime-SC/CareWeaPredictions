/**
 * Shared calibration metrics for backtests (Brier + log loss).
 */
import { brierScore } from "./learning-engine";

const LOG_LOSS_EPS = 1e-15;

export function logLoss(
  predictedProbability: number,
  actualOutcome: 0 | 1
): number {
  const p = Math.min(
    1 - LOG_LOSS_EPS,
    Math.max(LOG_LOSS_EPS, Number.isFinite(predictedProbability) ? predictedProbability : 0.5)
  );
  return -(
    actualOutcome * Math.log(p) +
    (1 - actualOutcome) * Math.log(1 - p)
  );
}

export type MarketMetricBucket = {
  nBets: number;
  wins: number;
  stakeUnits: number;
  returnUnits: number;
  brierSum: number;
  logLossSum: number;
  scoredN: number;
};

export function emptyMarketBucket(): MarketMetricBucket {
  return {
    nBets: 0,
    wins: 0,
    stakeUnits: 0,
    returnUnits: 0,
    brierSum: 0,
    logLossSum: 0,
    scoredN: 0,
  };
}

export function recordScoredBet(
  bucket: MarketMetricBucket,
  modelP: number,
  won: boolean,
  odds: number
): void {
  const y: 0 | 1 = won ? 1 : 0;
  bucket.nBets += 1;
  bucket.stakeUnits += 1;
  bucket.scoredN += 1;
  bucket.brierSum += brierScore(modelP, y);
  bucket.logLossSum += logLoss(modelP, y);
  if (won) {
    bucket.wins += 1;
    bucket.returnUnits += odds;
  }
}

export function recordVoidBet(bucket: MarketMetricBucket): void {
  bucket.nBets += 1;
  bucket.stakeUnits += 1;
  bucket.returnUnits += 1;
}

export type MarketMetricSummary = {
  nBets: number;
  wins: number;
  stakeUnits?: number;
  returnUnits?: number;
  winRate?: number;
  roi?: number;
  meanBrier?: number;
  meanLogLoss?: number;
};

export function finalizeMarketBuckets(
  byMarket: Record<string, MarketMetricBucket>
): Record<string, MarketMetricSummary> {
  const out: Record<string, MarketMetricSummary> = {};
  for (const [key, b] of Object.entries(byMarket)) {
    const stake = b.stakeUnits;
    const roi = stake > 0 ? (b.returnUnits - stake) / stake : 0;
    out[key] = {
      nBets: b.nBets,
      wins: b.wins,
      stakeUnits: b.stakeUnits,
      returnUnits: Number(b.returnUnits.toFixed(2)),
      winRate: b.nBets > 0 ? Number(((b.wins / b.nBets) * 100).toFixed(2)) : 0,
      roi: Number((roi * 100).toFixed(2)),
      meanBrier:
        b.scoredN > 0
          ? Number((b.brierSum / b.scoredN).toFixed(4))
          : undefined,
      meanLogLoss:
        b.scoredN > 0
          ? Number((b.logLossSum / b.scoredN).toFixed(4))
          : undefined,
    };
  }
  return out;
}

export function aggregateCalibration(
  byMarket: Record<string, MarketMetricBucket>
): { meanBrier: number; meanLogLoss: number; scoredN: number } {
  let brierSum = 0;
  let logLossSum = 0;
  let scoredN = 0;
  for (const b of Object.values(byMarket)) {
    brierSum += b.brierSum;
    logLossSum += b.logLossSum;
    scoredN += b.scoredN;
  }
  return {
    scoredN,
    meanBrier: scoredN > 0 ? Number((brierSum / scoredN).toFixed(4)) : 0,
    meanLogLoss: scoredN > 0 ? Number((logLossSum / scoredN).toFixed(4)) : 0,
  };
}
