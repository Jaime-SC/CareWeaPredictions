import { chileDateApiWindow, chileDateString } from "../lib/utils";
import { chileCivilDateFromKickoff } from "../lib/api-football";
import { ensureMatchOdds, predictMatchMarkets } from "../lib/poisson";
import type { Match } from "../lib/types";

const today = chileDateString();
const lateConmebol = "2026-08-13T01:00:00.000Z"; // ~21:00 Chile Aug 12 (winter)

const bare: Match = {
  id: "live-1",
  league: "copa-libertadores",
  leagueName: "Copa Libertadores",
  kickoff: lateConmebol,
  home: {
    name: "A",
    shortName: "A",
    form: [],
    goalsScoredAvg: 1.4,
    goalsConcededAvg: 1.1,
  },
  away: {
    name: "B",
    shortName: "B",
    form: [],
    goalsScoredAvg: 1.2,
    goalsConcededAvg: 1.3,
  },
  h2h: { homeWins: 1, draws: 1, awayWins: 1, avgGoals: 2.5 },
  odds: {
    home: 0,
    draw: 0,
    away: 0,
    doubleChance1X: 0,
    doubleChanceX2: 0,
    over05: 0,
    over15: 0,
    over25: 0,
    under35: 0,
    under45: 0,
    homeScores: 0,
    awayScores: 0,
    dnbHome: 0,
    dnbAway: 0,
  },
};

const filled = ensureMatchOdds(bare);
const { markets } = predictMatchMarkets(filled, {
  minSafeProbability: 0.7,
  minSafeOdds: 1.35,
  maxSafeOdds: 1.55,
});
const ok = markets.filter((m) => m.odds > 1);

console.log(
  JSON.stringify(
    {
      today,
      window: chileDateApiWindow(today),
      civilOfLateKickoff: chileCivilDateFromKickoff(lateConmebol),
      fair1x: filled.odds.doubleChance1X,
      marketsWithOdds: ok.length,
    },
    null,
    2
  )
);
