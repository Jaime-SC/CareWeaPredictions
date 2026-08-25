/**
 * Verify diversified picks + unique odds/probs (no uniform 1.28 / 78.2%).
 * Usage: npx tsx scripts/verify-diversity.ts
 */
import { generateParlay } from "../lib/parlay-generator";
import { STRATEGY_PRESETS } from "../lib/parlay-defaults";
import type { Match, MatchOdds } from "../lib/types";

function oddsVariant(seed: number): MatchOdds {
  // High-prob band 1.18–1.28
  const bump = (seed % 5) * 0.015;
  const home = 1.55 + (seed % 7) * 0.12;
  const draw = 3.1 + (seed % 5) * 0.15;
  const away = 2.4 + (seed % 9) * 0.2;
  return {
    home: Number(home.toFixed(2)),
    draw: Number(draw.toFixed(2)),
    away: Number(away.toFixed(2)),
    doubleChance1X: Number((1.2 + bump).toFixed(2)),
    doubleChanceX2: Number((1.26 + bump).toFixed(2)),
    over05: 1.08,
    over15: Number((1.2 + bump).toFixed(2)),
    over25: 1.55,
    under35: Number((1.22 + bump).toFixed(2)),
    under45: 1.18,
    homeScores: Number((1.19 + bump).toFixed(2)),
    awayScores: Number((1.24 + bump).toFixed(2)),
    dnbHome: Number((1.21 + bump).toFixed(2)),
    dnbAway: Number((1.27 + bump).toFixed(2)),
  };
}

function mockMatch(id: number, dayOffset: number): Match {
  const kick = new Date();
  kick.setUTCDate(kick.getUTCDate() + dayOffset);
  kick.setUTCHours(18 + (id % 4), 0, 0, 0);
  const o = oddsVariant(id);
  return {
    id: `live-${1000 + id}`,
    league: "premier-league",
    leagueName: id % 2 === 0 ? "Premier League" : "La Liga",
    kickoff: kick.toISOString(),
    home: {
      name: `Home${id}`,
      shortName: `H${id}`,
      form: id % 3 === 0 ? ["W", "W", "W", "D", "L"] : ["L", "D", "W", "L", "D"],
      goalsScoredAvg: 1.1 + (id % 6) * 0.15,
      goalsConcededAvg: 0.8 + (id % 5) * 0.12,
      homeGoalsScoredAvg: 1.2 + (id % 6) * 0.18,
      homeGoalsConcededAvg: 0.7 + (id % 5) * 0.1,
    },
    away: {
      name: `Away${id}`,
      shortName: `A${id}`,
      form: ["D", "L", "W", "L", "W"],
      goalsScoredAvg: 0.9 + (id % 5) * 0.14,
      goalsConcededAvg: 1.0 + (id % 6) * 0.11,
      awayGoalsScoredAvg: 0.85 + (id % 5) * 0.16,
      awayGoalsConcededAvg: 1.1 + (id % 6) * 0.13,
    },
    h2h: { homeWins: 2, draws: 1, awayWins: 2, avgGoals: 2.3 + (id % 4) * 0.2 },
    odds: o,
  };
}

// 12 today + 8 tomorrow
const matches = [
  ...Array.from({ length: 12 }, (_, i) => mockMatch(i + 1, 0)),
  ...Array.from({ length: 8 }, (_, i) => mockMatch(i + 50, 1)),
];

const parlay = generateParlay(matches, STRATEGY_PRESETS["daily-fun"]);
const oddsSet = new Set(parlay.legs.map((l) => l.odds.toFixed(2)));
const probSet = new Set(
  parlay.legs.map((l) => (l.modelProbability * 100).toFixed(1))
);
const markets = parlay.legs.reduce<Record<string, number>>((acc, l) => {
  acc[l.market] = (acc[l.market] ?? 0) + 1;
  return acc;
}, {});
const dcCount = (markets["1x"] ?? 0) + (markets["x2"] ?? 0);

console.log(
  JSON.stringify(
    {
      legs: parlay.legs.length,
      exact15: parlay.legs.length === 15,
      uniqueOdds: oddsSet.size,
      uniqueProbs: probSet.size,
      dcCount,
      dcShare: Number((dcCount / Math.max(1, parlay.legs.length)).toFixed(2)),
      // Phase 1: no forced DC ≤40% quota — natural repetition allowed
      probabilityFirst: true,
      allAbove80: parlay.legs.every((l) => l.modelProbability >= 0.8),
      markets,
      sample: parlay.legs.slice(0, 5).map((l) => ({
        market: l.market,
        label: l.marketLabel,
        odds: l.odds,
        prob: Number((l.modelProbability * 100).toFixed(1)),
      })),
    },
    null,
    2
  )
);
