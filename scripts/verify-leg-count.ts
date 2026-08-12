/**
 * Quick check: targetLegCount=15 with backfill.
 * Usage: npx tsx scripts/verify-leg-count.ts
 */
import { STRATEGY_PRESETS } from "../lib/parlay-defaults";
import {
  DEFAULT_TARGET_LEG_COUNT,
  STRICT_MIN_PROBABILITY,
  generateParlay,
} from "../lib/parlay-generator";
import type { Match } from "../lib/types";

function mockMatch(id: number, league: string): Match {
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
    },
    away: {
      name: `Away${id}`,
      shortName: `A${id}`,
      form: ["L", "D", "L", "W", "L"],
      goalsScoredAvg: 0.9,
      goalsConcededAvg: 1.6,
    },
    h2h: { homeWins: 3, draws: 1, awayWins: 1, avgGoals: 2.4 },
    odds: {
      home: 1.45,
      draw: 4.2,
      away: 7.5,
      doubleChance1X: 1.2,
      doubleChanceX2: 2.1,
      over05: 1.08,
      over15: 1.25,
      over25: 1.7,
      under35: 1.35,
      under45: 1.15,
      homeScores: 1.2,
      awayScores: 1.55,
      dnbHome: 1.22,
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

console.log(
  JSON.stringify(
    {
      defaultTarget: DEFAULT_TARGET_LEG_COUNT,
      strictMin: STRICT_MIN_PROBABILITY,
      legs: parlay.legs.length,
      totalOdds: Number(parlay.totalOdds.toFixed(2)),
      fillNotice: parlay.fillNotice ?? null,
      exact15: parlay.legs.length === 15,
    },
    null,
    2
  )
);
