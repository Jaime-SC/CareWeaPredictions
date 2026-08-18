/**
 * Smoke: bankroll stake engine (quarter Kelly, caps, CLP rounding).
 * Usage: npx tsx scripts/verify-stake-engine.ts
 */
import {
  calculateParlayStake,
  calculateSingleStake,
  clampStakeAmount,
  fullKellyFraction,
  roundToCleanCLP,
} from "../lib/stake-engine";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(roundToCleanCLP(640) === 600, "round 640 → 600");
assert(roundToCleanCLP(650) === 700, "round 650 → 700");
assert(roundToCleanCLP(0) === 0, "round 0");

assert(clampStakeAmount(30, 3_000, 75) === 75, "always floor to bookmaker min");
assert(clampStakeAmount(300, 30_000, 75) === 300, "keep 1% when above min");
assert(clampStakeAmount(0, 30_000, 75) === 0, "zero stays zero");
assert(clampStakeAmount(40, 3_000, 75) === 75, "small bankroll still gets min ticket");

const capped = calculateSingleStake(30_000, 0.85, 1.22);
assert(capped.amountCLP === 600, `single cap 2% got ${capped.amountCLP}`);
assert(capped.percentageOfBankroll === 2, `single % got ${capped.percentageOfBankroll}`);

const full = fullKellyFraction(0.62, 1.8);
assert(full > 0.14 && full < 0.15, `full Kelly ${full}`);

const noEdge = calculateSingleStake(30_000, 0.5, 1.8);
assert(noEdge.amountCLP === 0, "no +EV → stake 0");

const tinyEdge = calculateSingleStake(30_000, 0.505, 2);
assert(tinyEdge.amountCLP >= 75, `tiny +EV at least min got ${tinyEdge.amountCLP}`);

const parlayLow = calculateParlayStake(30_000, 2.5, 0.868);
assert(parlayLow.amountCLP === 300, `parlay 1% of 30k = 300 got ${parlayLow.amountCLP}`);
assert(parlayLow.amountCLP > 0, "parlay never suggests $0 with a bankroll");

const smallBankParlay = calculateParlayStake(3_000, 2.2, 0.868);
assert(smallBankParlay.amountCLP === 75, `small bankroll floors to $75 got ${smallBankParlay.amountCLP}`);

const parlayHigh = calculateParlayStake(30_000, 25, 0.02);
assert(parlayHigh.amountCLP >= 75, `parlay 0.5% at least min got ${parlayHigh.amountCLP}`);

const bigBank = calculateParlayStake(200_000, 2.4, 0.35);
assert(bigBank.amountCLP === 2_000, `1% of 200k = 2000 got ${bigBank.amountCLP}`);

const bigHighOdds = calculateParlayStake(200_000, 8, 0.08);
assert(bigHighOdds.amountCLP === 1_000, `0.5% of 200k = 1000 got ${bigHighOdds.amountCLP}`);

const customCap = calculateSingleStake(50_000, 0.85, 1.3, { maxRiskSingle: 0.01 });
assert(customCap.amountCLP === 500, `custom 1% cap got ${customCap.amountCLP}`);

console.log("verify-stake-engine: all assertions passed");
