/**
 * Quick check: targetLegCount=15 with ≥80% legs and 1.18–1.28 odds.
 * Usage: npx tsx scripts/verify-leg-count.ts
 */
import { STRATEGY_PRESETS } from "../lib/parlay-defaults";
import {
  DEFAULT_TARGET_LEG_COUNT,
  MIN_LEG_PROBABILITY,
  generateParlay,
} from "../lib/parlay-generator";
import type { Match } from "../lib/types";

function mockMatch(id: number, league: string): Match {
  const bump = (id % 5) * 0.015;
  return {
    id: `live-${id}`,
    league: "premier-league",
    leagueName: league,
    kickoff: new Date().toISOString(),
    home: {
      name: `Home${id}`,
      shortName: `H${id}`,
      form: ["W", "W", "D", "W", "W"],
      goalsScoredAvg: 1.8,
      goalsConcededAvg: 0.7,
      homeGoalsScoredAvg: 1.9,
      homeGoalsConcededAvg: 0.65,
    },
    away: {
      name: `Away${id}`,
      shortName: `A${id}`,
      form: ["L", "D", "L", "W", "L"],
      goalsScoredAvg: 0.9,
      goalsConcededAvg: 1.6,
      awayGoalsScoredAvg: 0.85,
      awayGoalsConcededAvg: 1.7,
    },
    h2h: { homeWins: 3, draws: 1, awayWins: 1, avgGoals: 2.4 },
    odds: {
      home: 1.55,
      draw: 4.2,
      away: 7.5,
      doubleChance1X: Number((1.2 + bump).toFixed(2)),
      doubleChanceX2: 2.1,
      over05: 1.08,
      over15: Number((1.2 + bump).toFixed(2)),
      over25: 1.7,
      under35: Number((1.22 + bump).toFixed(2)),
      under45: 1.18,
      homeScores: Number((1.19 + bump).toFixed(2)),
      awayScores: Number((1.24 + bump).toFixed(2)),
      dnbHome: Number((1.21 + bump).toFixed(2)),
      dnbAway: 3.5,
    },
  };
}

const matches = Array.from({ length: 20 }, (_, i) =>
  mockMatch(i + 1, i < 10 ? "Premier League" : "La Liga")
);

const config = {
  ...STRATEGY_PRESETS["daily-fun"],
  targetLegCount: 15,
};

const parlay = generateParlay(matches, config);
const belowFloor = parlay.legs.filter(
  (l) => l.modelProbability < MIN_LEG_PROBABILITY
);

console.log(
  JSON.stringify(
    {
      defaultTarget: DEFAULT_TARGET_LEG_COUNT,
      minLegProb: MIN_LEG_PROBABILITY,
      legs: parlay.legs.length,
      totalOdds: Number(parlay.totalOdds.toFixed(2)),
      fillNotice: parlay.fillNotice ?? null,
      exact15: parlay.legs.length === 15,
      allAbove80: belowFloor.length === 0,
      minLegSeen:
        parlay.legs.length > 0
          ? Math.min(...parlay.legs.map((l) => l.modelProbability))
          : null,
      oddsBand: parlay.legs.map((l) => l.odds),
    },
    null,
    2
  )
);
