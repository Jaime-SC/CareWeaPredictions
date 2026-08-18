/**
 * Smoke: professional readiness metrics (ROI, CLV, PF, p-value, DD, Kelly).
 * Usage: npx tsx scripts/verify-pro-metrics.ts
 */
import {
  beatClosingLine,
  buildReadinessMetrics,
  computeClvRate,
  computeFractionalKelly,
  computeMaxDrawdown,
  computeOneSidedPValue,
  computeProfitFactor,
  computeRoiPct,
  isValidClvSample,
  READINESS_THRESHOLDS,
  standardNormalCdf,
  type ClvLeg,
  type SettledTicketPnL,
} from "../lib/pro-metrics";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(Math.abs(standardNormalCdf(0) - 0.5) < 0.002, "Φ(0) ≈ 0.5");
assert(standardNormalCdf(1.96) > 0.97 && standardNormalCdf(1.96) < 0.978, "Φ(1.96)");
assert(standardNormalCdf(-1.96) < 0.03, "Φ(-1.96)");

const even: SettledTicketPnL[] = [
  { stake: 100, payout: 180, status: "won" },
  { stake: 100, payout: 0, status: "lost" },
];
assert(Math.abs(computeRoiPct(even) - -10) < 1e-9, "ROI even mixed");
assert(Math.abs((computeProfitFactor(even) ?? 0) - 0.8) < 1e-9, "PF 80/100");

const winners: SettledTicketPnL[] = Array.from({ length: 12 }, () => ({
  stake: 10,
  payout: 18,
  status: "won" as const,
}));
assert(computeProfitFactor(winners) === Number.POSITIVE_INFINITY, "PF inf when no losses");
assert(computeRoiPct(winners) === 80, "ROI all wins at 1.80");

const returnsPos = Array.from({ length: 80 }, () => 0.08);
const pWin = computeOneSidedPValue(returnsPos);
assert(pWin != null && pWin < 0.001, `p-value all +8% returns, got ${pWin}`);

const returnsZero = Array.from({ length: 80 }, () => 0);
assert(computeOneSidedPValue(returnsZero) === 1, "p-value zero mean");

const ddTickets: SettledTicketPnL[] = [
  { stake: 100, payout: 200, status: "won" },
  { stake: 100, payout: 0, status: "lost" },
  { stake: 100, payout: 0, status: "lost" },
  { stake: 100, payout: 200, status: "won" },
];
const dd = computeMaxDrawdown(ddTickets, 1000);
assert(dd.pct != null && Math.abs(dd.pct - (200 / 1100) * 100) < 0.05, `DD pct ${dd.pct}`);
assert(dd.amount === 200, `DD amount ${dd.amount}`);

const now = Date.now();
const kickoff = now + 60 * 60 * 1000;
const validBeat: ClvLeg = {
  takenOdds: 1.8,
  closingOdds: 1.62,
  createdAtMs: now - 4 * 60 * 60 * 1000,
  closingOddsAtMs: now,
  kickoffMs: kickoff,
};
const tooEarly: ClvLeg = {
  ...validBeat,
  closingOddsAtMs: kickoff - 5 * 60 * 60 * 1000,
};
const unchanged: ClvLeg = {
  ...validBeat,
  closingOdds: 1.8,
};
assert(beatClosingLine(1.8, 1.62) === true, "1.80 vs 1.62 beats close");
assert(beatClosingLine(1.8, 1.9) === false, "1.80 vs 1.90 misses close");
assert(isValidClvSample(validBeat) === true, "CLV sample in window");
assert(isValidClvSample(tooEarly) === false, "CLV sample outside window");

const clv = computeClvRate([validBeat, unchanged, tooEarly]);
assert(clv.compared === 2, `CLV compared ${clv.compared}`);
assert(clv.beats === 1, `CLV beats ${clv.beats}`);
assert(clv.pushes === 1, `CLV pushes ${clv.pushes}`);
assert(clv.rate != null && Math.abs(clv.rate - 0.5) < 1e-9, `CLV rate ${clv.rate}`);

const kelly = computeFractionalKelly({
  bankroll: 1_000_000,
  odds: 1.8,
  modelProbability: 0.62,
});
// f* = (0.62*1.8 - 1)/(0.8) = 0.116 / 0.8 = 0.145 → 14.5%; 25% → 3.625% capped at 2%
assert(kelly.fullKellyPct > 14 && kelly.fullKellyPct < 15, `full Kelly ${kelly.fullKellyPct}`);
assert(kelly.fractionalKellyPct > 3.5 && kelly.fractionalKellyPct < 3.7, `frac ${kelly.fractionalKellyPct}`);
assert(kelly.recommendedStakePct === 2, `cap ${kelly.recommendedStakePct}`);
assert(kelly.recommendedStake === 20_000, `stake ${kelly.recommendedStake}`);

const noEdge = computeFractionalKelly({
  bankroll: 100_000,
  odds: 1.8,
  modelProbability: 0.5,
});
assert(noEdge.recommendedStake === 0, "no +EV → stake 0");

const exampleStake = computeFractionalKelly({
  bankroll: 1_000_000,
  odds: 1.9,
  modelProbability: 0.6,
});
// f* = (0.6*1.9 - 1)/0.9 = 0.14/0.9 ≈ 0.1556; 25% ≈ 3.89% → cap 2%
assert(exampleStake.recommendedStakePct === 2, "user example +EV still capped");

const thin = buildReadinessMetrics({ tickets: [], clvLegs: [] });
assert(thin.readyForRealCapital === false, "empty is not ready");
assert(thin.metrics.every((m) => m.status === "thin" || m.status === "fail"), "empty metrics not pass");

const clvLegs: ClvLeg[] = Array.from({ length: 40 }, (_, i) => ({
  takenOdds: 1.8,
  closingOdds: i < 24 ? 1.62 : 1.95,
  createdAtMs: now - 5 * 60 * 60 * 1000,
  closingOddsAtMs: now,
  kickoffMs: kickoff,
}));
const report = buildReadinessMetrics({
  tickets: Array.from({ length: 320 }, (_, i) =>
    i % 5 === 0
      ? { stake: 10, payout: 0, status: "lost" as const }
      : { stake: 10, payout: 13.2, status: "won" as const }
  ),
  clvLegs,
  initialBankroll: 50_000,
});
assert(report.settledTickets === 320, "N=320");
assert(report.roiPct > 5 && report.roiPct < 6, `ROI ${report.roiPct}`);
assert(report.metrics.find((m) => m.id === "sample")?.status === "pass", "sample pass");
assert(report.metrics.find((m) => m.id === "clv")?.status === "pass", "CLV 60% pass");
assert(
  (report.profitFactor ?? 0) > READINESS_THRESHOLDS.minProfitFactor,
  `PF ${report.profitFactor}`
);
const quarter = computeFractionalKelly({
  bankroll: 200_000,
  odds: 2,
  modelProbability: 0.52,
});
assert(Math.abs(quarter.fullKellyPct - 4) < 0.05, `full ~4% got ${quarter.fullKellyPct}`);
assert(Math.abs(quarter.fractionalKellyPct - 1) < 0.05, `25% Kelly ~1% got ${quarter.fractionalKellyPct}`);
assert(quarter.recommendedStake === 2000, `1% of 200k = 2000 got ${quarter.recommendedStake}`);

console.log("verify-pro-metrics: all assertions passed");
