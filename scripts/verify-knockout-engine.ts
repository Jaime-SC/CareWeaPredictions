/**
 * Knockout engine checks: 1st/2nd/single legs, λ dampen, market boosts, 90-min tag.
 * Usage: npx tsx scripts/verify-knockout-engine.ts
 */
import {
  detectKnockoutLeg,
  evaluateKnockoutContext,
  favoriteNeedsComeback,
  applyKnockoutLambdaAdjustments,
  applyKnockoutMarketAdjustments,
  KNOCKOUT_90_MIN_NOTE,
  LEG_1_LAMBDA_SCALE,
  LEG_1_HOME_PROB_BOOST,
  LEG_2_COMEBACK_OVER_BOOST,
} from "../lib/knockout-engine";
import { estimateExpectedGoals, predictMatchMarkets } from "../lib/poisson";
import type { MarketType, Match } from "../lib/types";

const odds = {
  home: 1.55,
  draw: 3.8,
  away: 6.5,
  doubleChance1X: 1.18,
  doubleChanceX2: 2.4,
  over05: 1.08,
  over15: 1.28,
  over25: 1.72,
  under35: 1.32,
  under45: 1.12,
  homeScores: 1.18,
  awayScores: 1.55,
  dnbHome: 1.22,
  dnbAway: 2.1,
};

const leagueBase: Match = {
  id: "ko-league",
  league: "laliga",
  leagueName: "La Liga",
  kickoff: "2026-08-18T20:00:00.000Z",
  home: {
    name: "Real Madrid",
    shortName: "RMA",
    form: ["W", "W", "D", "W", "W"],
    goalsScoredAvg: 2.1,
    goalsConcededAvg: 0.8,
    homeGoalsScoredAvg: 2.3,
    homeGoalsConcededAvg: 0.6,
    lastMatchAt: "2026-07-01T20:00:00.000Z",
  },
  away: {
    name: "Getafe",
    shortName: "GET",
    form: ["L", "D", "L", "W", "L"],
    goalsScoredAvg: 1.0,
    goalsConcededAvg: 1.4,
    awayGoalsScoredAvg: 0.8,
    awayGoalsConcededAvg: 1.6,
    lastMatchAt: "2026-07-01T20:00:00.000Z",
  },
  h2h: { homeWins: 3, draws: 1, awayWins: 0, avgGoals: 2.4 },
  odds,
};

const leg1: Match = {
  ...leagueBase,
  id: "ko-leg1",
  league: "champions-league",
  leagueName: "UEFA Champions League",
  round: "Play-offs - 1st Leg",
};

const leg2Comeback: Match = {
  ...leagueBase,
  id: "ko-leg2",
  league: "champions-league",
  leagueName: "UEFA Champions League",
  round: "Quarter-finals - 2nd Leg",
  firstLegScore: { currentHome: 0, currentAway: 1 },
};

const singleKo: Match = {
  ...leagueBase,
  id: "ko-single",
  league: "premier-league",
  leagueName: "FA Cup",
  round: "Semi-finals",
};

const emptyProbs = {
  home: 0.55,
  draw: 0.25,
  away: 0.2,
  "1x": 0.8,
  x2: 0.45,
  over_0_5: 0.92,
  over_1_5: 0.74,
  over_2_5: 0.52,
  under_3_5: 0.7,
  under_4_5: 0.86,
  home_scores: 0.82,
  away_scores: 0.62,
  home_over_1_5: 0.48,
  away_over_1_5: 0.3,
  dnb_home: 0.73,
  dnb_away: 0.27,
} as Record<MarketType, number>;

const ctx1 = evaluateKnockoutContext(leg1);
const ctx2 = evaluateKnockoutContext(leg2Comeback);
const ctxSingle = evaluateKnockoutContext(singleKo);
const ctxLeague = evaluateKnockoutContext(leagueBase);

const xgLeague = estimateExpectedGoals(leagueBase);
const xgLeg1 = estimateExpectedGoals(leg1);

const boosted = applyKnockoutMarketAdjustments(leg1, { ...emptyProbs });
const overs = applyKnockoutMarketAdjustments(leg2Comeback, { ...emptyProbs });
const lambda = applyKnockoutLambdaAdjustments(leg1, { home: 1.6, away: 1.0 });

const predicted = predictMatchMarkets(leg1);
const homeMarket = predicted.markets.find((m) => m.market === "home");
const dcMarket = predicted.markets.find((m) => m.market === "1x");

const checks = {
  leagueIgnored: detectKnockoutLeg(leagueBase) === null && !ctxLeague.isKnockout,
  leg1Detected: detectKnockoutLeg(leg1) === "LEG_1" && ctx1.leg === "1st Leg",
  leg2Detected: detectKnockoutLeg(leg2Comeback) === "LEG_2" && ctx2.leg === "2nd Leg",
  singleDetected:
    detectKnockoutLeg(singleKo) === "SINGLE_KNOCKOUT" &&
    ctxSingle.leg === "Single",
  ninetyMinNote: ctx1.note === KNOCKOUT_90_MIN_NOTE && ctx2.isKnockout,
  lambdaDampen:
    Math.abs(lambda.home - 1.6 * LEG_1_LAMBDA_SCALE) < 1e-9 &&
    Math.abs(lambda.away - 1.0 * LEG_1_LAMBDA_SCALE) < 1e-9,
  xgDampen: xgLeg1.home + xgLeg1.away < xgLeague.home + xgLeague.away,
  homeBoost: Math.abs((boosted.home ?? 0) - emptyProbs.home * LEG_1_HOME_PROB_BOOST) < 1e-9,
  dcBoost: Math.abs((boosted["1x"] ?? 0) - emptyProbs["1x"] * LEG_1_HOME_PROB_BOOST) < 1e-9,
  noOverBoostOnLeg1: boosted.over_1_5 === emptyProbs.over_1_5,
  comebackFlag: ctx2.comebackRequired === true && favoriteNeedsComeback(leg2Comeback),
  overBoost:
    Math.abs((overs.over_1_5 ?? 0) - emptyProbs.over_1_5 * LEG_2_COMEBACK_OVER_BOOST) <
      1e-9 &&
    Math.abs((overs.over_2_5 ?? 0) - emptyProbs.over_2_5 * LEG_2_COMEBACK_OVER_BOOST) <
      1e-9,
  metadataOnMarkets:
    homeMarket?.knockoutContext?.isKnockout === true &&
    homeMarket.knockoutContext.leg === "1st Leg" &&
    /90 min/i.test(homeMarket.label) &&
    dcMarket?.knockoutContext?.note === KNOCKOUT_90_MIN_NOTE,
};

const failed = Object.entries(checks).filter(([, ok]) => !ok);

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      failed: failed.map(([k]) => k),
      ctx1,
      ctx2,
      ctxSingle,
      lambda,
      xgLeague,
      xgLeg1,
      boostedHome: boosted.home,
      over15: overs.over_1_5,
      homeLabel: homeMarket?.label,
      knockoutContext: homeMarket?.knockoutContext,
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 1;
}
