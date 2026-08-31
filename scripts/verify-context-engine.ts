/**
 * Context Engine checks: venue, injuries, friendlies, H2H.
 * Usage: npx tsx scripts/verify-context-engine.ts
 */
import {
  applyContextModifiers,
  applyContextToMarkets,
  resolveContextMinProbability,
} from "../lib/context-engine";
import { predictMatchMarkets } from "../lib/poisson";
import type { Match, MarketType } from "../lib/types";

const odds = {
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
};

const base: Match = {
  id: "live-ctx-1",
  league: "laliga",
  leagueName: "La Liga",
  kickoff: "2026-08-12T20:00:00.000Z",
  home: {
    name: "Real Sociedad",
    shortName: "RSO",
    form: ["W", "W", "W", "D", "L"],
    goalsScoredAvg: 1.4,
    goalsConcededAvg: 1.1,
    homeGoalsScoredAvg: 2.2,
    homeGoalsConcededAvg: 0.7,
    lastMatchAt: "2026-07-01T20:00:00.000Z",
  },
  away: {
    name: "Getafe",
    shortName: "GET",
    form: ["L", "D", "L", "W", "L"],
    goalsScoredAvg: 1.2,
    goalsConcededAvg: 1.3,
    awayGoalsScoredAvg: 0.8,
    awayGoalsConcededAvg: 1.7,
    lastMatchAt: "2026-07-01T20:00:00.000Z",
  },
  h2h: {
    homeWins: 3,
    draws: 0,
    awayWins: 1,
    avgGoals: 3.2,
    last4HomeWins: 3,
    last4AwayWins: 1,
    last4Draws: 0,
  },
  odds,
};

const friendly: Match = {
  ...base,
  id: "live-ctx-friendly",
  league: "club-friendlies",
  leagueName: "Friendlies Clubs",
  kickoff: "2026-07-20T18:00:00.000Z",
  home: {
    name: "Osasuna",
    shortName: "OSA",
    form: ["D", "L", "W", "D", "L"],
    goalsScoredAvg: 1.3,
    goalsConcededAvg: 1.2,
    homeGoalsScoredAvg: 1.3,
    homeGoalsConcededAvg: 1.2,
    lastMatchAt: "2026-07-01T18:00:00.000Z",
  },
  away: {
    name: "Alaves",
    shortName: "ALA",
    form: ["D", "D", "L", "W", "L"],
    goalsScoredAvg: 1.2,
    goalsConcededAvg: 1.2,
    awayGoalsScoredAvg: 1.2,
    awayGoalsConcededAvg: 1.2,
    lastMatchAt: "2026-07-01T18:00:00.000Z",
  },
  h2h: { homeWins: 0, draws: 0, awayWins: 0, avgGoals: 2.4 },
};

const injured: Match = {
  ...base,
  id: "live-ctx-inj",
  home: {
    ...base.home,
    injuries: [
      { player: "A. Striker", role: "striker", status: "out" },
      { player: "B. CB", role: "defender", status: "out" },
    ],
  },
  away: {
    ...base.away,
    injuries: [{ player: "C. GK", role: "goalkeeper", status: "out" }],
  },
};

const homeDom = applyContextModifiers(0.62, base, "home");
const friendlyHome = applyContextModifiers(0.9, friendly, "1x");
const injuryOver = applyContextModifiers(0.7, injured, "over_2_5");
const h2hOver = applyContextModifiers(0.55, base, "over_2_5");
const { contextFlags, perMarket } = applyContextToMarkets(base, {
  home: 0.45,
  draw: 0.28,
  away: 0.27,
  "1x": 0.73,
  x2: 0.55,
  over_0_5: 0.92,
  over_1_5: 0.78,
  over_2_5: 0.55,
  under_3_5: 0.72,
  under_4_5: 0.88,
  home_scores: 0.8,
  away_scores: 0.7,
  home_over_1_5: 0.62,
  away_over_1_5: 0.48,
  dnb_home: 0.62,
  dnb_away: 0.38,
} as Record<MarketType, number>);

const { markets, contextNotes } = predictMatchMarkets(base);
const underDerby = predictMatchMarkets({
  ...base,
  home: { ...base.home, name: "Real Madrid", shortName: "RMA" },
  away: { ...base.away, name: "Barcelona", shortName: "BAR" },
});

const checks = {
  homeDominantFlag: homeDom.contextFlags.includes("HOME_DOMINANT"),
  homeBoosted: homeDom.finalProbability > 0.62,
  modifierInBand:
    homeDom.confidenceModifier >= 0.92 && homeDom.confidenceModifier <= 1.12,
  friendlyFlag: friendlyHome.contextFlags.includes("FRIENDLY_HIGH_VARIANCE"),
  friendlyHaircut: friendlyHome.finalProbability < 0.9,
  preSeasonFlag: friendlyHome.contextFlags.includes("PRE_SEASON"),
  noFalseDerby: !friendlyHome.contextFlags.includes("HIGH_RISK_DERBY"),
  injuryStriker: injuryOver.contextFlags.includes("KEY_INJURY_STRIKER"),
  injuryGk: injuryOver.contextFlags.includes("KEY_INJURY_GOALKEEPER"),
  injuryCluster: injuryOver.contextFlags.includes("KEY_INJURY_CLUSTER"),
  h2hHome: homeDom.contextFlags.includes("H2H_HOME_DOMINANT"),
  h2hBoost: homeDom.confidenceModifier >= 1.04 || homeDom.finalProbability > 0.62 * 1.03,
  h2hHighScoring: h2hOver.contextFlags.includes("H2H_HIGH_SCORING"),
  friendlyMin: resolveContextMinProbability(0.8, friendly) >= 0.85,
  awayLeaky: contextFlags.includes("AWAY_LEAKY"),
  awayMuted: contextFlags.includes("AWAY_MUTED"),
  notesNonEmpty: contextNotes.length > 0,
  derbyUnderBlocked:
    underDerby.markets.find((m) => m.market === "under_3_5")?.isSafePick ===
    false,
  perMarket1xBoost: (perMarket["1x"].finalProbability ?? 0) >= 0.73,
};

const failed = Object.entries(checks).filter(([, ok]) => !ok);

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      failed: failed.map(([k]) => k),
      homeDom,
      friendlyHome: {
        finalProbability: friendlyHome.finalProbability,
        confidenceModifier: friendlyHome.confidenceModifier,
        contextFlags: friendlyHome.contextFlags,
        contextNotes: friendlyHome.contextNotes,
      },
      injuryOver: {
        finalProbability: injuryOver.finalProbability,
        contextFlags: injuryOver.contextFlags,
      },
      contextFlags,
      contextNotes,
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 1;
}
