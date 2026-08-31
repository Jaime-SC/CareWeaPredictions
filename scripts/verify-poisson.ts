/**
 * Smoke: Poisson PMF recurrence + single-pass market aggregation.
 * Usage: npx tsx scripts/verify-poisson.ts
 */
import {
  buildScoreMatrix,
  poissonPmf,
  predictMatchMarkets,
} from "../lib/poisson";
import type { Match } from "../lib/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(Math.abs(poissonPmf(0, 0) - 1) < 1e-12, "λ=0 → P(0)=1");
assert(poissonPmf(1, 0) === 0, "λ=0 → P(k>0)=0");

const lambda = 1.4;
let sum = 0;
for (let k = 0; k <= 20; k++) sum += poissonPmf(k, lambda);
assert(Math.abs(sum - 1) < 1e-9, "PMF sums to ~1");

const matrix = buildScoreMatrix(1.5, 1.1);
let total = 0;
for (const row of matrix) for (const p of row) total += p;
assert(Math.abs(total - 1) < 1e-9, "score matrix normalized");

const match: Match = {
  id: "poisson-1",
  league: "premier-league",
  leagueName: "Premier League",
  kickoff: "2026-08-20T19:00:00.000Z",
  home: {
    id: 1,
    name: "Home",
    shortName: "HOM",
    form: ["W", "W", "D"],
    goalsScoredAvg: 1.6,
    goalsConcededAvg: 0.9,
  },
  away: {
    id: 2,
    name: "Away",
    shortName: "AWY",
    form: ["L", "D", "W"],
    goalsScoredAvg: 1.1,
    goalsConcededAvg: 1.3,
  },
  h2h: { homeWins: 2, draws: 1, awayWins: 1, avgGoals: 2.4 },
  odds: {
    home: 1.9,
    draw: 3.4,
    away: 4.0,
    doubleChance1X: 1.22,
    doubleChanceX2: 1.7,
    over05: 1.08,
    over15: 1.25,
    over25: 1.7,
    under35: 1.35,
    under45: 1.15,
    homeScores: 1.2,
    awayScores: 1.55,
    homeOver15: 2.1,
    awayOver15: 2.8,
    dnbHome: 1.45,
    dnbAway: 2.6,
  },
};

const pred = predictMatchMarkets(match, { minSafeProbability: 0.5 });
assert(pred.markets.length > 0, "produces markets with real odds");
assert(pred.expectedGoals.home > 0 && pred.expectedGoals.away > 0, "xg positive");

console.log(
  JSON.stringify(
    {
      ok: true,
      pmfSum: Number(sum.toFixed(6)),
      matrixSum: Number(total.toFixed(6)),
      xg: pred.expectedGoals,
      markets: pred.markets.length,
    },
    null,
    2
  )
);
