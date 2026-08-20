/**
 * Smoke: bankroll stake engine (quarter Kelly, caps, CLP rounding, leg/pick scale).
 * Usage: npx tsx scripts/verify-stake-engine.ts
 */
import {
  calculateParlayStake,
  calculateSingleStake,
  clampStakeAmount,
  fullKellyFraction,
  PARLAY_REFERENCE_LEGS,
  roundToCleanCLP,
  selectionRiskScale,
  SINGLE_REFERENCE_PICKS,
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

assert(selectionRiskScale(5, 5) === 1, "5 vs 5 = full risk");
assert(Math.abs(selectionRiskScale(15, 5) - 5 / 15) < 1e-9, "15 legs = 1/3 risk");
assert(selectionRiskScale(3, 5) === 1, "fewer than reference still full risk");

const capped = calculateSingleStake(30_000, 0.85, 1.22);
assert(capped.amountCLP === 600, `single cap 2% got ${capped.amountCLP}`);

const fivePicks = calculateSingleStake(30_000, 0.85, 1.22, { pickCount: 5 });
const fifteenPicks = calculateSingleStake(30_000, 0.85, 1.22, {
  pickCount: 15,
});
assert(fivePicks.amountCLP === 600, `5 picks keep full stake got ${fivePicks.amountCLP}`);
assert(
  fifteenPicks.amountCLP < fivePicks.amountCLP,
  `15 picks must stake less than 5 (${fifteenPicks.amountCLP} vs ${fivePicks.amountCLP})`
);
assert(
  fifteenPicks.amountCLP === 200,
  `15 picks → 2% * 5/15 = 0.667% → $200 got ${fifteenPicks.amountCLP}`
);

const full = fullKellyFraction(0.62, 1.8);
assert(full > 0.14 && full < 0.15, `full Kelly ${full}`);

const noEdge = calculateSingleStake(30_000, 0.5, 1.8);
assert(noEdge.amountCLP === 0, "no +EV → stake 0");

const parlay5 = calculateParlayStake(30_000, 2.5, 0.868, { legCount: 5 });
const parlay15 = calculateParlayStake(30_000, 2.5, 0.868, { legCount: 15 });
assert(parlay5.amountCLP === 300, `5 legs 1% = 300 got ${parlay5.amountCLP}`);
assert(
  parlay15.amountCLP < parlay5.amountCLP,
  `15 legs must stake less (${parlay15.amountCLP} vs ${parlay5.amountCLP})`
);
// 1% * 5/15 = 0.333% of 30k = 100
assert(parlay15.amountCLP === 100, `15 legs → $100 got ${parlay15.amountCLP}`);

const smallBankParlay = calculateParlayStake(3_000, 2.2, 0.868, {
  legCount: 15,
});
assert(
  smallBankParlay.amountCLP === 75,
  `small bankroll floors to $75 got ${smallBankParlay.amountCLP}`
);

assert(PARLAY_REFERENCE_LEGS === 5, "parlay reference");
assert(SINGLE_REFERENCE_PICKS === 5, "single reference");

console.log("verify-stake-engine: all assertions passed");
