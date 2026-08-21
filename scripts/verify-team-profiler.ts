/**
 * Smoke: venue splits, recency, manager cutoff, absence dampening, clamps.
 * Usage: npx tsx scripts/verify-team-profiler.ts
 */
import {
  TEAM_PROFILE_RULES,
  aggregateTeamEvents,
  applyTeamProfileCalibration,
  clampHistoricalBoost,
  findActiveCoachStartDate,
  isTeamProfileCalibrationSuspended,
  keyAbsenceLambdaFactor,
} from "../lib/team-profiler";
import {
  countKeyAbsencesFromLists,
  isRecentManagerStart,
  type TeamProfileSnapshot,
} from "../lib/team-profile-shared";
import type { MarketType } from "../lib/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const base = {
  home: 0.4,
  draw: 0.3,
  away: 0.3,
  "1x": 0.7,
  x2: 0.6,
  over_0_5: 0.9,
  over_1_5: 0.8,
  over_2_5: 0.55,
  under_3_5: 0.7,
  under_4_5: 0.85,
  home_scores: 0.75,
  away_scores: 0.65,
  home_over_1_5: 0.4,
  away_over_1_5: 0.3,
  dnb_home: 0.57,
  dnb_away: 0.43,
} as Record<MarketType, number>;

function blankProfile(
  partial: Partial<TeamProfileSnapshot> &
    Pick<TeamProfileSnapshot, "teamId" | "teamName">
): TeamProfileSnapshot {
  return {
    totalMatchesAnalyzed: 0,
    homeMatchesCount: 0,
    awayMatchesCount: 0,
    avgGoalsScoredHome: 0,
    avgGoalsConcededHome: 0,
    avgGoalsScoredAway: 0,
    avgGoalsConcededAway: 0,
    over15GoalsRate: 0,
    over15GoalsRateHome: 0,
    over15GoalsRateAway: 0,
    over25GoalsRate: 0,
    cleanSheetRate: 0,
    cleanSheetRateHome: 0,
    cleanSheetRateAway: 0,
    lastManagerChangeDate: null,
    keyAbsencesCount: 0,
    ...partial,
  };
}

// --- Rolling window + venue splits ---
const day = 86_400_000;
const manyEvents = Array.from({ length: 14 }, (_, i) => ({
  at: 1_700_000_000_000 - i * day,
  venue: (i % 2 === 0 ? "home" : "away") as "home" | "away",
  scored: i % 2 === 0 ? 2 : 1,
  conceded: i % 3 === 0 ? 0 : 1,
  totalGoals: 3,
  teamName: "Roll",
}));
const agg = aggregateTeamEvents(manyEvents);
assert(agg.totalMatchesAnalyzed === TEAM_PROFILE_RULES.ROLLING_WINDOW, "window=10");
assert(agg.homeMatchesCount + agg.awayMatchesCount === 10, "venue counts sum to window");
assert(agg.homeMatchesCount === 5 && agg.awayMatchesCount === 5, "5 home / 5 away");
assert(agg.over15GoalsRate > 0.9, "weighted over15 from window");

// Manager cutoff drops pre-change matches
const cutoff = 1_700_000_000_000 - 3 * day;
const afterReset = aggregateTeamEvents(manyEvents, {
  managerChangeCutoffMs: cutoff,
  lastManagerChangeDate: new Date(cutoff).toISOString(),
  keyAbsencesCount: 2,
});
assert(afterReset.totalMatchesAnalyzed === 4, "cutoff keeps only post-DT matches");
assert(afterReset.lastManagerChangeDate != null, "preserves manager date");
assert(afterReset.keyAbsencesCount === 2, "preserves keyAbsencesCount");

// Older high-scoring home should weigh less than recent low-scoring home
const recency = aggregateTeamEvents([
  {
    at: 100,
    venue: "home",
    scored: 0,
    conceded: 0,
    totalGoals: 0,
    teamName: "Decay",
  },
  {
    at: 50,
    venue: "home",
    scored: 5,
    conceded: 5,
    totalGoals: 10,
    teamName: "Decay",
  },
]);
assert(
  recency.avgGoalsScoredHome < 2.5,
  "recency decay pulls avg toward newest (0 goals)"
);

// --- Clamp ---
assert(
  Math.abs(
    clampHistoricalBoost(0.8, 0.8 * 1.05) -
      Math.min(0.92, Math.min(0.8 + 0.8 * 0.08, 0.84))
  ) < 1e-12,
  "clamp matches +8% / 0.92 formula"
);
assert(clampHistoricalBoost(0.9, 0.9 * 1.05) === 0.92, "ceiling 0.92");

assert(keyAbsenceLambdaFactor(null) === 1, "no profile → λ 1");
assert(
  keyAbsenceLambdaFactor(
    blankProfile({ teamId: 9, teamName: "Ok", keyAbsencesCount: 0 })
  ) === 1,
  "zero absences → λ 1"
);
assert(
  keyAbsenceLambdaFactor(
    blankProfile({ teamId: 10, teamName: "Out", keyAbsencesCount: 1 })
  ) === TEAM_PROFILE_RULES.KEY_ABSENCE_LAMBDA,
  "key absence → λ 0.85"
);

const hotHome = blankProfile({
  teamId: 1,
  teamName: "Hot Home",
  totalMatchesAnalyzed: 6,
  homeMatchesCount: 5,
  awayMatchesCount: 1,
  over15GoalsRateHome: 0.85,
  over15GoalsRate: 0.8,
});

const thinHome = blankProfile({
  teamId: 2,
  teamName: "Thin Home",
  totalMatchesAnalyzed: 6,
  homeMatchesCount: 3,
  awayMatchesCount: 3,
  over15GoalsRateHome: 0.9,
  cleanSheetRateHome: 0.8,
});

const fortress = blankProfile({
  teamId: 3,
  teamName: "Fortress",
  totalMatchesAnalyzed: 8,
  homeMatchesCount: 5,
  awayMatchesCount: 3,
  cleanSheetRateHome: 0.7,
  cleanSheetRate: 0.55,
});

const awayWall = blankProfile({
  teamId: 4,
  teamName: "Away Wall",
  totalMatchesAnalyzed: 8,
  homeMatchesCount: 2,
  awayMatchesCount: 6,
  cleanSheetRateAway: 0.7,
});

const now = Date.now();
const recentDt = blankProfile({
  teamId: 5,
  teamName: "New DT",
  totalMatchesAnalyzed: 2,
  homeMatchesCount: 5,
  over15GoalsRateHome: 0.9,
  cleanSheetRateHome: 0.8,
  lastManagerChangeDate: new Date(now - 3 * day).toISOString(),
});
assert(
  isTeamProfileCalibrationSuspended(recentDt, now),
  "recent DT + <3 matches suspends"
);
const settledDt = blankProfile({
  ...recentDt,
  teamId: 6,
  totalMatchesAnalyzed: 4,
});
assert(
  !isTeamProfileCalibrationSuspended(settledDt, now),
  "≥3 matches under new DT lifts suspend"
);

const overBoost = applyTeamProfileCalibration(base, hotHome, null);
const expectedOver = clampHistoricalBoost(
  base.over_1_5,
  base.over_1_5 * TEAM_PROFILE_RULES.RELATIVE_BOOST
);
assert(
  Math.abs(overBoost.probs.over_1_5 - expectedOver) < 1e-9,
  "over15 bounded boost"
);
assert(overBoost.flags.includes("TEAM_PROFILE_OVER15"), "over15 flag");

const blocked = applyTeamProfileCalibration(base, thinHome, null);
assert(blocked.probs.over_1_5 === base.over_1_5, "home N<4 blocks over15");
assert(blocked.probs["1x"] === base["1x"], "home N<4 blocks CS");
assert(blocked.flags.length === 0, "no flags under venue sample");

const csBoost = applyTeamProfileCalibration(base, fortress, null);
const expected1x = clampHistoricalBoost(
  base["1x"],
  base["1x"] * TEAM_PROFILE_RULES.RELATIVE_BOOST
);
assert(Math.abs(csBoost.probs["1x"] - expected1x) < 1e-9, "1x home CS boost");
assert(csBoost.flags.includes("TEAM_PROFILE_HOME_CS"), "home CS flag");

const awayBoost = applyTeamProfileCalibration(base, null, awayWall);
const expectedX2 = clampHistoricalBoost(
  base.x2,
  base.x2 * TEAM_PROFILE_RULES.RELATIVE_BOOST
);
assert(Math.abs(awayBoost.probs.x2 - expectedX2) < 1e-9, "x2 away CS boost");
assert(awayBoost.flags.includes("TEAM_PROFILE_AWAY_CS"), "away CS flag");

const managerBlock = applyTeamProfileCalibration(base, recentDt, null, now);
assert(
  managerBlock.probs.over_1_5 === base.over_1_5,
  "manager cooldown forces base Poisson boosts"
);
assert(
  managerBlock.flags.includes("TEAM_PROFILE_MANAGER_RESET_HOME"),
  "manager reset flag"
);

const coachStart = findActiveCoachStartDate(
  [
    {
      career: [
        { team: { id: 33 }, start: "2020-01-01", end: "2024-06-01" },
        { team: { id: 33 }, start: "2026-08-15", end: null },
      ],
    },
  ],
  33
);
assert(coachStart === "2026-08-15", "active coach start");
assert(
  isRecentManagerStart("2026-08-15", Date.parse("2026-08-21T12:00:00Z")),
  "start within 14d"
);
assert(
  !isRecentManagerStart("2026-01-01", Date.parse("2026-08-21T12:00:00Z")),
  "old start not recent"
);
assert(
  countKeyAbsencesFromLists(
    [
      { id: 1, name: "A" },
      { id: 9, name: "B" },
    ],
    [
      { id: 1, name: "A" },
      { id: 2, name: "C" },
    ]
  ) === 1,
  "cross-ref topscorer injury"
);

console.log(
  JSON.stringify({
    ok: true,
    rules: TEAM_PROFILE_RULES,
    window: agg.totalMatchesAnalyzed,
    afterResetN: afterReset.totalMatchesAnalyzed,
    homeN: agg.homeMatchesCount,
    awayN: agg.awayMatchesCount,
    over15: overBoost.probs.over_1_5,
    oneX: csBoost.probs["1x"],
    x2: awayBoost.probs.x2,
    keyAbsenceLambda: TEAM_PROFILE_RULES.KEY_ABSENCE_LAMBDA,
    coachStart,
    ceilingCheck: clampHistoricalBoost(0.9, 0.945),
  })
);
