/**
 * Quick check for home/away + form/derby/fatigue context rules.
 * Usage: npx tsx scripts/verify-context-rules.ts
 */
import {
  estimateExpectedGoals,
  predictMatchMarkets,
} from "../lib/poisson";
import {
  hasWinStreak,
  isFatigued,
  isHighRiskDerby,
  isMarketBlockedByDerby,
} from "../lib/context-engine";
import type { Match } from "../lib/types";

const base: Match = {
  id: "live-1",
  league: "laliga",
  leagueName: "La Liga",
  kickoff: "2026-08-12T20:00:00.000Z",
  home: {
    name: "Real Madrid",
    shortName: "RMA",
    form: ["W", "W", "W", "D", "L"],
    goalsScoredAvg: 1.8,
    goalsConcededAvg: 0.9,
    homeGoalsScoredAvg: 2.1,
    homeGoalsConcededAvg: 0.7,
    lastMatchAt: "2026-08-10T20:00:00.000Z",
  },
  away: {
    name: "Barcelona",
    shortName: "BAR",
    form: ["L", "D", "L", "W", "L"],
    goalsScoredAvg: 1.5,
    goalsConcededAvg: 1.1,
    awayGoalsScoredAvg: 1.3,
    awayGoalsConcededAvg: 1.4,
    lastMatchAt: "2026-07-01T20:00:00.000Z",
  },
  h2h: { homeWins: 4, draws: 2, awayWins: 4, avgGoals: 3.1 },
  odds: {
    home: 2.1,
    draw: 3.4,
    away: 3.2,
    doubleChance1X: 1.28,
    doubleChanceX2: 1.55,
    over05: 1.1,
    over15: 1.25,
    over25: 1.6,
    under35: 1.35,
    under45: 1.15,
    homeScores: 1.2,
    awayScores: 1.28,
    dnbHome: 1.4,
    dnbAway: 1.7,
  },
};

const freshHome: Match = {
  ...base,
  home: { ...base.home, lastMatchAt: "2026-07-01T20:00:00.000Z" },
};

const xgFatigue = estimateExpectedGoals(base);
const xgFresh = estimateExpectedGoals(freshHome);
const { markets, isDerby, contextFlags } = predictMatchMarkets(base);
const under = markets.find((m) => m.market === "under_3_5");
const over = markets.find((m) => m.market === "over_1_5");

console.log(
  JSON.stringify(
    {
      isDerby: isDerby && isHighRiskDerby(base),
      hasHomeStreak: hasWinStreak(base.home.form),
      homeFatigued: isFatigued(base.home.lastMatchAt, base.kickoff),
      awayFatigued: isFatigued(base.away.lastMatchAt, base.kickoff),
      underBlocked: isMarketBlockedByDerby(base, "under_3_5"),
      underSafe: under?.isSafePick ?? null,
      overProb: Number((over?.modelProbability ?? 0).toFixed(3)),
      contextFlags,
      xgFatigue,
      xgFresh,
      fatigueReducedHomeXg: xgFatigue.home < xgFresh.home,
    },
    null,
    2
  )
);
