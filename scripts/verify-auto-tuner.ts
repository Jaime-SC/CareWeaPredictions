/**
 * Smoke: unified auto-tuner — sample guardrails, EMA, clamps, disable rules.
 * Usage: npx tsx scripts/verify-auto-tuner.ts
 */
import {
  LEARNING_RATE,
  calibrateModelParameters,
  clampMinOdds,
  clampProbabilityScale,
  clampRiskPenalty,
  deriveTuningConfig,
  emaBlend,
  sampleAdjustmentAlpha,
  type HistoricalPickRow,
} from "../lib/auto-tuner";
import {
  DEFAULT_MODEL_WEIGHTS,
  MIN_ODDS_CEILING,
  MIN_ODDS_FLOOR,
  PROBABILITY_SCALE_MAX,
  PROBABILITY_SCALE_MIN,
  RISK_PENALTY_MAX,
  RISK_PENALTY_MIN,
  invalidateModelWeightsCache,
  loadModelWeights,
  saveModelWeights,
} from "../lib/model-weights";
import {
  invalidateTuningConfigCache,
  resetTuningConfig,
} from "../lib/tuning-config";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(sampleAdjustmentAlpha(4) === 0, "n<5 => alpha 0");
assert(sampleAdjustmentAlpha(5) === 0.5, "n=5 => alpha 0.5");
assert(sampleAdjustmentAlpha(14) === 0.5, "n=14 => alpha 0.5");
assert(sampleAdjustmentAlpha(15) === 1, "n=15 => alpha 1");
assert(emaBlend(1, 1.25, 0.25) === 1.0625, "EMA 0.25 toward 1.25");
assert(LEARNING_RATE === 0.25, "learning rate");
assert(clampRiskPenalty(2) === RISK_PENALTY_MAX, "risk clamp high");
assert(clampRiskPenalty(0.1) === RISK_PENALTY_MIN, "risk clamp low");
assert(clampProbabilityScale(2) === PROBABILITY_SCALE_MAX, "scale clamp high");
assert(clampProbabilityScale(0.1) === PROBABILITY_SCALE_MIN, "scale clamp low");
assert(clampMinOdds(1) === MIN_ODDS_FLOOR, "odds floor");
assert(clampMinOdds(2) === MIN_ODDS_CEILING, "odds ceiling");

function rowsFor(
  league: string,
  leagueId: string,
  market: string,
  count: number,
  wins: number,
  odds: number
): HistoricalPickRow[] {
  return Array.from({ length: count }, (_, i) => ({
    league,
    leagueId,
    market,
    modelProbability: 0.82,
    odds,
    outcome: i < wins ? ("WON" as const) : ("LOST" as const),
  }));
}

const tiny = rowsFor("Ligue 1", "61", "1x", 4, 1, 1.22);
const tinyResult = calibrateModelParameters(
  tiny,
  structuredClone(DEFAULT_MODEL_WEIGHTS)
);
assert(
  tinyResult.weights.leagues["61"] == null,
  "N<5 does not write a league entry"
);
assert(tinyResult.skippedLowSample >= 1, "N<5 counted as skipped");

const lowPartial = rowsFor("Serie A", "135", "over_1_5", 8, 3, 1.28);
const lowResult = calibrateModelParameters(
  lowPartial,
  structuredClone(DEFAULT_MODEL_WEIGHTS)
);
const serieA = lowResult.weights.leagues["135"];
assert(serieA != null, "N=8 writes league by id");
assert(lowResult.weights.leagues["Serie A"] != null, "alias by name");
assert(serieA.riskPenalty > 1, "low WR raises riskPenalty");
assert(serieA.riskPenalty < 1.1, "partial+EMA dampens first step");
assert(serieA.probabilityScale < 1, "low WR lowers probabilityScale");
assert(serieA.probabilityScale >= PROBABILITY_SCALE_MIN, "scale floor");
assert(serieA.minOdds > DEFAULT_MODEL_WEIGHTS.global.defaultMinOdds, "minOdds up");

const highFull = rowsFor("Premier League", "39", "1x", 16, 15, 1.22);
const highResult = calibrateModelParameters(
  highFull,
  structuredClone(DEFAULT_MODEL_WEIGHTS)
);
const premier = highResult.weights.leagues["39"];
assert(premier != null, "high WR league present");
assert(premier.riskPenalty < 1, "high WR relaxes riskPenalty");
assert(premier.probabilityScale > 1, "high WR boosts scale");
assert(premier.minOdds < DEFAULT_MODEL_WEIGHTS.global.defaultMinOdds, "minOdds down");
assert(premier.minOdds >= MIN_ODDS_FLOOR, "minOdds floor");

const toxic = rowsFor("Bundesliga", "78", "dnb_away", 16, 2, 1.35);
const toxicResult = calibrateModelParameters(
  toxic,
  structuredClone(DEFAULT_MODEL_WEIGHTS)
);
const dnb = toxicResult.weights.markets["dnb_away"];
assert(dnb != null, "toxic market present");
assert(dnb.disabled === true, "ROI < -45% and N>=15 disables market");
assert(dnb.weight < 1, "weight pulled toward 0.35 via EMA");
assert(dnb.minProbability > DEFAULT_MODEL_WEIGHTS.global.strictMinProbability, "threshold up");

const tuned = deriveTuningConfig(lowResult.weights);
const leagueMul = tuned.leagueMultipliers["135"];
assert(leagueMul != null, "tuning multiplier synced");
assert(leagueMul >= 0.95 && leagueMul <= 1.05, "poisson multiplier ±5%");

async function persistSmoke(): Promise<void> {
  await saveModelWeights(lowResult.weights);
  invalidateModelWeightsCache();
  const loaded = loadModelWeights();
  assert(loaded.leagues["135"]?.sampleSize === 8, "persisted by league id");

  await saveModelWeights(structuredClone(DEFAULT_MODEL_WEIGHTS));
  resetTuningConfig();
  invalidateModelWeightsCache();
  invalidateTuningConfigCache();

  console.log(
    JSON.stringify(
      {
        ok: true,
        serieA,
        premier,
        dnbAway: dnb,
        leagueMul,
        persisted: loaded.calibratedAt != null,
      },
      null,
      2
    )
  );
}

await persistSmoke();
