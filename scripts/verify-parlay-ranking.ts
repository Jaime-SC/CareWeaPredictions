/**
 * Phase 1: probability-first ranking (no DC family quota).
 * Usage: npx tsx scripts/verify-parlay-ranking.ts
 */
import { collectSafePicks } from "../lib/parlay-generator";
import { evaluateMarket } from "../lib/result-checker";
import { jugaBetMarketLabel } from "../lib/poisson";
import type { Match, MatchOdds } from "../lib/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function board(seed: number): MatchOdds {
  const bump = (seed % 5) * 0.01;
  return {
    home: 1.9,
    draw: 3.4,
    away: 4.0,
    doubleChance1X: Number((1.22 + bump).toFixed(2)),
    doubleChanceX2: 1.35,
    over05: 1.06,
    over15: Number((1.18 + bump).toFixed(2)),
    over25: 1.7,
    under35: 1.25,
    under45: 1.12,
    homeScores: 1.2,
    awayScores: 1.35,
    homeOver15: 1.55,
    awayOver15: 2.1,
    dnbHome: 1.4,
    dnbAway: 2.0,
    bttsYes: 1.65,
    bttsNo: 2.1,
  };
}

function mockMatch(id: number): Match {
  return {
    id: `live-${2000 + id}`,
    league: "premier-league",
    leagueName: "Premier League",
    kickoff: new Date(Date.now() + id * 3600_000).toISOString(),
    home: {
      name: `Cardiff${id}`,
      shortName: `C${id}`,
      form: ["W", "W", "D", "W", "L"],
      goalsScoredAvg: 1.8,
      goalsConcededAvg: 0.7,
      homeGoalsScoredAvg: 2.0,
      homeGoalsConcededAvg: 0.6,
    },
    away: {
      name: `Norwich${id}`,
      shortName: `N${id}`,
      form: ["L", "D", "L", "W", "L"],
      goalsScoredAvg: 0.9,
      goalsConcededAvg: 1.5,
      awayGoalsScoredAvg: 0.8,
      awayGoalsConcededAvg: 1.6,
    },
    h2h: { homeWins: 3, draws: 1, awayWins: 1, avgGoals: 2.6 },
    odds: board(id),
  };
}

const matches = Array.from({ length: 8 }, (_, i) => mockMatch(i + 1));
const legs = collectSafePicks(
  matches,
  {
    minOdds: 1.1,
    maxOdds: 1.45,
    minProbability: 0.8,
    strategyMode: "daily-safe",
    targetLegCount: 8,
  },
  "probability"
);

assert(legs.length >= 1, "at least one leg");
assert(
  legs.every((l) => l.modelProbability >= 0.8),
  "all legs ≥80%"
);

// Natural repetition allowed: no DC ≤40% assert
const dcShare =
  legs.filter((l) => l.market === "1x" || l.market === "x2").length /
  Math.max(1, legs.length);
assert(dcShare <= 1, "dc share computed");

const label = jugaBetMarketLabel("home_over_1_5", "Cardiff", "Norwich");
assert(
  label === "Cardiff total → Más de 1.5 goles",
  `jugaBet label got ${label}`
);
assert(
  jugaBetMarketLabel("btts_yes", "A", "B") === "Ambos equipos marcan → Sí",
  "btts label"
);
assert(
  jugaBetMarketLabel("over_1_5", "A", "B") === "Total de goles → Más de 1.5",
  "ft total goles label"
);

assert(evaluateMarket("btts_yes", 1, 1) === "won", "btts yes won");
assert(evaluateMarket("btts_yes", 2, 0) === "lost", "btts yes lost");
assert(evaluateMarket("btts_no", 1, 0) === "won", "btts no won");
assert(evaluateMarket("btts_no", 2, 2) === "lost", "btts no lost");

console.log(
  JSON.stringify({
    ok: true,
    legs: legs.length,
    markets: legs.reduce<Record<string, number>>((acc, l) => {
      acc[l.market] = (acc[l.market] ?? 0) + 1;
      return acc;
    }, {}),
    sampleLabels: legs.slice(0, 3).map((l) => l.marketLabel),
    dcShare: Number(dcShare.toFixed(2)),
  })
);
