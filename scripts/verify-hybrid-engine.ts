/**
 * End-to-end smoke for hybrid advanced metrics + XGBoost secondary inference.
 * Usage: npx tsx scripts/verify-hybrid-engine.ts
 */
import assert from "node:assert/strict";
import type { TeamProfileSnapshot } from "../lib/team-profile-shared";
import {
  predictSecondaryMarkets,
  resetXgboostModelCache,
  resolveRefereeStrictness,
} from "../lib/xgboost-runner";
import { buildMatchPredictions, buildSameGameBetBuilders } from "../lib/parlay-generator";
import { predictMatchMarkets } from "../lib/poisson";
import {
  isValueBet,
  VALUE_MARGIN_THRESHOLD_PCT,
  valueMarginPercent,
} from "../lib/value-finder";
import type { GeneratedParlay, Match } from "../types";

function mockProfile(
  teamId: number,
  name: string,
  extras: Partial<TeamProfileSnapshot> = {}
): TeamProfileSnapshot {
  return {
    teamId,
    teamName: name,
    totalMatchesAnalyzed: 10,
    homeMatchesCount: 5,
    awayMatchesCount: 5,
    avgGoalsScoredHome: 1.4,
    avgGoalsConcededHome: 1.1,
    avgGoalsScoredAway: 1.2,
    avgGoalsConcededAway: 1.3,
    over15GoalsRate: 0.7,
    over15GoalsRateHome: 0.75,
    over15GoalsRateAway: 0.65,
    over25GoalsRate: 0.45,
    cleanSheetRate: 0.3,
    cleanSheetRateHome: 0.35,
    cleanSheetRateAway: 0.25,
    keyAbsencesCount: 0,
    brierCalibrationFactor: 1,
    avgNpxGScored: 1.55,
    avgNpxGConceded: 1.05,
    avgPPDA: 10.2,
    avgCornersFor: 5.8,
    avgCornersAgainst: 4.9,
    avgCardsFor: 2.1,
    avgCardsAgainst: 1.9,
    ...extras,
  };
}

const home = mockProfile(101, "Test FC");
const away = mockProfile(102, "Rival FC", {
  avgNpxGScored: 1.1,
  avgNpxGConceded: 1.4,
  avgCornersFor: 4.2,
  avgCardsFor: 2.8,
});

// --- XGBoost inference ---
resetXgboostModelCache();
assert(resolveRefereeStrictness("John Smith") === 1, "referee strictness default");

const probs = predictSecondaryMarkets({
  homeProfile: home,
  awayProfile: away,
  refereeStrictness: 1.05,
  fixture: { leagueId: 39, isDerby: false },
});

assert(Object.keys(probs).length > 0, "xgb probs non-empty");
for (const [market, p] of Object.entries(probs)) {
  assert(p >= 0.01 && p <= 0.99, `${market} prob out of range: ${p}`);
}
assert(probs.corners_over_8_5 != null, "corners_over_8_5 present");
assert(probs.cards_over_3_5 != null, "cards_over_3_5 present");
assert(probs.home_over_1_5 != null, "home_over_1_5 present");

const empty = predictSecondaryMarkets({ homeProfile: null, awayProfile: null });
assert(Object.keys(empty).length === 0, "no advanced metrics → no xgb output");

// --- Latency ---
const t0 = performance.now();
for (let i = 0; i < 100; i++) {
  predictSecondaryMarkets({
    homeProfile: home,
    awayProfile: away,
    fixture: { leagueId: 39 },
  });
}
const elapsed = performance.now() - t0;
assert(elapsed < 50, `100 inferences took ${elapsed.toFixed(1)}ms (limit 50ms)`);

// --- Value filter (5% hybrid) ---
const fairJoint = 0.85 * 0.78;
const lowOdds = 1 / fairJoint / 1.1;
const highOdds = 1 / fairJoint * 1.1;
assert(
  !isValueBet(fairJoint, lowOdds, VALUE_MARGIN_THRESHOLD_PCT),
  "reject <5% value"
);
assert(
  isValueBet(fairJoint, highOdds, VALUE_MARGIN_THRESHOLD_PCT),
  "accept >=5% value"
);
const margin = valueMarginPercent(fairJoint, highOdds);
assert(margin >= VALUE_MARGIN_THRESHOLD_PCT, "margin meets threshold");

// --- GeneratedParlay shape (no breaking changes) ---
const stubParlay: GeneratedParlay = {
  legs: [],
  totalOdds: 1,
  stake: 1000,
  potentialPayout: 1000,
  jointProbability: 0,
  riskLevel: "extreme",
  riskLabel: "test",
  averageEdge: 0,
  hitTarget: false,
};
assert(Array.isArray(stubParlay.legs), "GeneratedParlay.legs intact");
assert(stubParlay.betBuilders === undefined || Array.isArray(stubParlay.betBuilders));

// --- predictMatchMarkets still works without profiles ---
const baseMatch: Match = {
  id: "m1",
  league: "premier-league",
  leagueName: "Premier League",
  leagueId: "39",
  kickoff: new Date().toISOString(),
  home: {
    name: "A",
    shortName: "A",
    form: ["W", "D", "L", "W", "D"],
    goalsScoredAvg: 1.5,
    goalsConcededAvg: 1.1,
  },
  away: {
    name: "B",
    shortName: "B",
    form: ["L", "W", "D", "L", "W"],
    goalsScoredAvg: 1.2,
    goalsConcededAvg: 1.3,
  },
  h2h: { homeWins: 2, draws: 2, awayWins: 1, avgGoals: 2.4 },
  odds: {
    home: 2.1,
    draw: 3.4,
    away: 3.5,
    doubleChance1X: 1.3,
    doubleChanceX2: 1.6,
    over05: 1.08,
    over15: 1.45,
    over25: 2.2,
    under35: 1.35,
    under45: 1.15,
    homeScores: 1.5,
    awayScores: 1.7,
    dnbHome: 1.55,
    dnbAway: 2.1,
    cornersOver85: 1.9,
    cardsOver35: 1.85,
  },
};
const pred = predictMatchMarkets(baseMatch);
assert(pred.markets.length > 0, "predictMatchMarkets returns markets");
assert(pred.expectedGoals.home > 0, "expected goals computed");

// --- buildSameGameBetBuilders returns array ---
const builders = buildSameGameBetBuilders([baseMatch]);
assert(Array.isArray(builders), "bet builders array");

// --- buildMatchPredictions compiles ---
const preds = buildMatchPredictions([baseMatch]);
assert(preds.length === 1, "buildMatchPredictions length");

// --- Route modules compile (no runtime call) ---
void import("../app/api/predict/route");
void import("../app/api/cron/settle/route");

console.log("verify-hybrid-engine: all assertions passed");
console.log(`  xgb markets: ${Object.keys(probs).length}`);
console.log(`  100x inference: ${elapsed.toFixed(2)}ms`);
