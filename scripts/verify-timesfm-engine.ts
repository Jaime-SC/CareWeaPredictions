/**
 * TimesFM engine verification (mock forecasts, no GPU/DB required).
 * Usage: npx tsx scripts/verify-timesfm-engine.ts
 */
import { estimateExpectedGoals } from "../lib/poisson";
import { computeXCard } from "../lib/friction-engine";
import {
  buildXgboostFeaturesForVerify,
  predictSecondaryMarkets,
} from "../lib/xgboost-runner";
import {
  clearTimesfmForecastCache,
  peekTimesfmForecastAt,
  primeTimesfmForecastAt,
  type TimesfmForecastSnapshot,
} from "../lib/timesfm-forecast";
import type { TeamProfileSnapshot } from "../lib/team-profile-shared";
import type { Match } from "../lib/types";
import { isValueBet } from "../lib/value-finder";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const KICKOFF = "2026-04-10T18:00:00.000Z";
const asOf = new Date(KICKOFF);
const asOfEarlier = new Date("2026-04-01T00:00:00.000Z");

const homeProfile: TeamProfileSnapshot = {
  teamId: 101,
  teamName: "TimesFM Home",
  primaryLeagueId: 39,
  totalMatchesAnalyzed: 12,
  homeMatchesCount: 6,
  awayMatchesCount: 6,
  avgGoalsScoredHome: 1.6,
  avgGoalsConcededHome: 1.0,
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
  avgNpxGScored: 1.5,
  avgNpxGConceded: 1.1,
  avgPPDA: 10,
  avgCornersFor: 5.0,
  avgCornersAgainst: 4.5,
  avgCardsFor: 2.0,
  avgCardsAgainst: 1.8,
};

const awayProfile: TeamProfileSnapshot = {
  teamId: 202,
  teamName: "TimesFM Away",
  primaryLeagueId: 39,
  totalMatchesAnalyzed: 12,
  homeMatchesCount: 6,
  awayMatchesCount: 6,
  avgGoalsScoredHome: 1.4,
  avgGoalsConcededHome: 1.1,
  avgGoalsScoredAway: 1.1,
  avgGoalsConcededAway: 1.4,
  over15GoalsRate: 0.65,
  over15GoalsRateHome: 0.7,
  over15GoalsRateAway: 0.6,
  over25GoalsRate: 0.4,
  cleanSheetRate: 0.25,
  cleanSheetRateHome: 0.3,
  cleanSheetRateAway: 0.2,
  keyAbsencesCount: 0,
  avgNpxGScored: 1.3,
  avgNpxGConceded: 1.2,
  avgPPDA: 11,
  avgCornersFor: 4.8,
  avgCornersAgainst: 5.0,
  avgCardsFor: 2.2,
  avgCardsAgainst: 2.0,
};

function baseMatch(): Match {
  return {
    id: "timesfm-verify",
    league: "other-domestic",
    leagueName: "Test League",
    leagueId: "39",
    kickoff: KICKOFF,
    home: {
      id: 101,
      name: "TimesFM Home",
      shortName: "TFH",
      form: ["W", "W", "D", "W", "L"],
      goalsScoredAvg: 1.4,
      goalsConcededAvg: 1.15,
      homeGoalsScoredAvg: 1.6,
      homeGoalsConcededAvg: 1.0,
      awayGoalsScoredAvg: 1.2,
      awayGoalsConcededAvg: 1.3,
      lastMatchAt: "2026-04-05T18:00:00.000Z",
    },
    away: {
      id: 202,
      name: "TimesFM Away",
      shortName: "TFA",
      form: ["L", "D", "W", "L", "D"],
      goalsScoredAvg: 1.25,
      goalsConcededAvg: 1.25,
      homeGoalsScoredAvg: 1.4,
      homeGoalsConcededAvg: 1.1,
      awayGoalsScoredAvg: 1.1,
      awayGoalsConcededAvg: 1.4,
      lastMatchAt: "2026-04-04T18:00:00.000Z",
    },
    h2h: { homeWins: 2, draws: 1, awayWins: 1, avgGoals: 2.5 },
    odds: {
      home: 2.1,
      draw: 3.3,
      away: 3.6,
      doubleChance1X: 1.28,
      doubleChanceX2: 1.6,
      over05: 1.08,
      over15: 1.3,
      over25: 1.85,
      under35: 1.4,
      under45: 1.15,
      bttsYes: 1.75,
      bttsNo: 2.0,
      dnbHome: 1.55,
      dnbAway: 2.2,
      homeScores: 1.35,
      awayScores: 1.42,
    },
  };
}

function mockForecast(
  teamId: number,
  asOfDate: string,
  overrides: Partial<TimesfmForecastSnapshot> = {}
): TimesfmForecastSnapshot {
  return {
    teamId,
    asOfDate,
    timesfmXgScored: 1.6,
    timesfmXgConceded: 1.0,
    timesfmNpxGScored: 1.5,
    timesfmNpxGConceded: 1.0,
    timesfmCornersFor: 5.5,
    timesfmCornersAgainst: 4.2,
    timesfmCardsFor: 2.8,
    timesfmCardsAgainst: 2.0,
    timesfmFormScore: 0.7,
    ...overrides,
  };
}

clearTimesfmForecastCache();

// ─── 1. Fail-open: no TimesFM → identical λ ─────────────────────────────────
const match = baseMatch();
const baseline = estimateExpectedGoals(match, undefined, { asOf });
clearTimesfmForecastCache();
const baselineAgain = estimateExpectedGoals(match, undefined, { asOf });
assert(
  baseline.home === baselineAgain.home && baseline.away === baselineAgain.away,
  "without TimesFM, λ must be stable"
);

// ─── 2. High TimesFM xG scored → λ home rises (within ±8%) ──────────────────
primeTimesfmForecastAt(
  mockForecast(101, "2026-04-10", {
    timesfmXgScored: 2.4, // vs baseline homeGoalsScoredAvg 1.6 → ratio capped 1.08
    timesfmXgConceded: 1.0,
  }),
  asOf
);
primeTimesfmForecastAt(
  mockForecast(202, "2026-04-10", {
    timesfmXgScored: 1.1,
    timesfmXgConceded: 1.8, // high conceded → helps home λ
  }),
  asOf
);
const boosted = estimateExpectedGoals(match, undefined, { asOf });
assert(
  boosted.home > baseline.home,
  `TimesFM high attack/defense weakness should lift λ home (${boosted.home} > ${baseline.home})`
);
assert(
  boosted.home <= Number((baseline.home * 1.08 * 1.08).toFixed(3)) + 0.002,
  `λ home bump must respect ±8% per multiplier (got ${boosted.home} vs cap ${Number((baseline.home * 1.08 * 1.08).toFixed(3))})`
);

clearTimesfmForecastCache();
primeTimesfmForecastAt(
  mockForecast(101, "2026-04-10", {
    timesfmXgScored: 0.8,
    timesfmXgConceded: 1.0,
  }),
  asOf
);
primeTimesfmForecastAt(
  mockForecast(202, "2026-04-10", {
    timesfmXgScored: 1.1,
    timesfmXgConceded: 0.5,
  }),
  asOf
);
const dampened = estimateExpectedGoals(match, undefined, { asOf });
assert(
  dampened.home < baseline.home,
  `TimesFM low attack should reduce λ home (${dampened.home} < ${baseline.home})`
);

// ─── 3. XGBoost features + friction cards ───────────────────────────────────
clearTimesfmForecastCache();
const featsBase = buildXgboostFeaturesForVerify({
  homeProfile,
  awayProfile,
});
assert(
  featsBase.timesfm_corner_trend_diff === 0,
  "corner trend diff is 0 without TimesFM"
);
assert(
  featsBase.timesfm_card_intensity_index === 1,
  "card intensity is neutral without TimesFM"
);

const homeTf = mockForecast(101, "2026-04-10", {
  timesfmCornersFor: 6.5,
  timesfmCornersAgainst: 3.5,
  timesfmCardsFor: 3.2,
});
const awayTf = mockForecast(202, "2026-04-10", {
  timesfmCornersFor: 4.0,
  timesfmCornersAgainst: 5.5,
  timesfmCardsFor: 2.6,
});
const featsTf = buildXgboostFeaturesForVerify({
  homeProfile,
  awayProfile,
  homeTimesfm: homeTf,
  awayTimesfm: awayTf,
});
assert(
  featsTf.timesfm_corner_trend_diff !== 0,
  "corner trend diff changes with TimesFM"
);
assert(
  featsTf.timesfm_card_intensity_index > 1,
  "card intensity rises with high TimesFM cards"
);

const xCardBase = computeXCard({
  homeAvgCardsFor: 2.0,
  awayAvgCardsFor: 2.2,
  refereeStrictness: 1.0,
});
const xCardTf = computeXCard({
  homeAvgCardsFor: 2.0,
  awayAvgCardsFor: 2.2,
  homeTimesfmCardsFor: 3.5,
  awayTimesfmCardsFor: 3.0,
  refereeStrictness: 1.0,
});
assert(
  xCardTf.xCardTotal > xCardBase.xCardTotal,
  "TimesFM card blend must raise xCard when forecasts are higher"
);

const secondary = predictSecondaryMarkets({
  homeProfile,
  awayProfile,
  homeTimesfm: homeTf,
  awayTimesfm: awayTf,
  refereeStrictness: 1.1,
});
assert(
  Object.keys(secondary).length > 0,
  "secondary markets should return probs with advanced metrics"
);

// ─── 4. Point-in-time isolation ─────────────────────────────────────────────
clearTimesfmForecastCache();
primeTimesfmForecastAt(
  mockForecast(101, "2026-04-10", { timesfmXgScored: 3.0 }),
  asOf
);
assert(
  peekTimesfmForecastAt(101, asOf)?.timesfmXgScored === 3.0,
  "forecast visible at matching asOf"
);
assert(
  peekTimesfmForecastAt(101, asOfEarlier) == null,
  "forecast keyed at later asOf must not leak into earlier peek"
);

// ─── 5. Value overlay ───────────────────────────────────────────────────────
const p = 0.55;
const odds = 2.0; // value% ≈ 10
assert(isValueBet(p, odds, 5), "baseline value without form");
assert(
  isValueBet(p, odds, 5, 0.7),
  "bullish form + positive edge → easier threshold"
);
assert(
  !isValueBet(p, odds, 10, 0.3),
  "bearish form + positive edge → harder threshold can reject"
);

console.log("OK verify-timesfm-engine");
