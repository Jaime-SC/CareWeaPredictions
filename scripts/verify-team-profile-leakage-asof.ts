/**
 * Assert TeamProfile point-in-time cutoff: post-asOf fixtures must not alter profiles or preds.
 * Usage: npx tsx scripts/verify-team-profile-leakage-asof.ts
 */
import { buildTeamIndexAtCutoff } from "../lib/fixture-context";
import {
  applyBrierLearningToWeightsAsOf,
  type BrierPickRow,
} from "../lib/learning-engine";
import { loadModelWeights } from "../lib/model-weights";
import { predictMatchMarkets } from "../lib/poisson";
import {
  aggregateTeamEvents,
  buildTeamEventsFromFixtures,
  peekTeamProfileAt,
  primeTeamProfileAt,
  type MatchFixtureRowForProfile,
} from "../lib/team-profiler";
import type { Match } from "../lib/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const KICKOFF = "2026-03-15T20:00:00.000Z";
const asOf = new Date(KICKOFF);
const TEAM_ID = 9001;

const baseRows: MatchFixtureRowForProfile[] = [
  {
    apiFixtureId: 1,
    homeTeam: "Alpha FC",
    awayTeam: "Beta United",
    matchDate: new Date("2026-03-10T18:00:00.000Z"),
    finalScore: "2 - 0",
    status: "FT",
    leagueId: 39,
  },
  {
    apiFixtureId: 2,
    homeTeam: "Gamma City",
    awayTeam: "Alpha FC",
    matchDate: new Date("2026-03-01T15:00:00.000Z"),
    finalScore: "1 - 1",
    status: "FT",
    leagueId: 39,
  },
  {
    apiFixtureId: 3,
    homeTeam: "Alpha FC",
    awayTeam: "Delta Rovers",
    matchDate: new Date("2026-02-20T19:00:00.000Z"),
    finalScore: "3 - 1",
    status: "FT",
    leagueId: 39,
  },
];

const leakRow: MatchFixtureRowForProfile = {
  apiFixtureId: 99,
  homeTeam: "Alpha FC",
  awayTeam: "Future XI",
  matchDate: new Date("2026-03-20T18:00:00.000Z"),
  finalScore: "5 - 0",
  status: "FT",
  leagueId: 39,
};

const byName = new Map<string, number>([["alpha fc", TEAM_ID]]);

const eventsBase = buildTeamEventsFromFixtures(baseRows, {
  asOf,
  byFixture: new Map(),
  byName,
});
const eventsLeak = buildTeamEventsFromFixtures([leakRow, ...baseRows], {
  asOf,
  byFixture: new Map(),
  byName,
});

const aggBase = aggregateTeamEvents(eventsBase.eventsByTeam.get(TEAM_ID) ?? []);
const aggLeak = aggregateTeamEvents(eventsLeak.eventsByTeam.get(TEAM_ID) ?? []);

assert(
  JSON.stringify(aggBase) === JSON.stringify(aggLeak),
  "buildTeamEventsFromFixtures must ignore post-asOf fixtures"
);

const profileBase = { teamId: TEAM_ID, ...aggBase, keyAbsencesCount: 0 };
primeTeamProfileAt(profileBase, asOf);

const cached = peekTeamProfileAt(TEAM_ID, asOf);
assert(cached != null, "peekTeamProfileAt should return primed profile");
assert(
  cached!.avgGoalsScoredHome === aggBase.avgGoalsScoredHome,
  "primed profile matches aggregate"
);

const fixturesForForm = baseRows.map((r) => {
  const score = r.finalScore!.split(/\s*-\s*/).map((p) => Number(p.trim()));
  return {
    homeTeam: r.homeTeam,
    awayTeam: r.awayTeam,
    matchDate:
      r.matchDate instanceof Date ? r.matchDate : new Date(String(r.matchDate)),
    homeGoals: score[0]!,
    awayGoals: score[1]!,
  };
});

const indexBase = buildTeamIndexAtCutoff(fixturesForForm, asOf);
const indexLeak = buildTeamIndexAtCutoff(
  [
    {
      homeTeam: leakRow.homeTeam,
      awayTeam: leakRow.awayTeam,
      matchDate: leakRow.matchDate as Date,
      homeGoals: 5,
      awayGoals: 0,
    },
    ...fixturesForForm,
  ],
  asOf
);

function histFor(index: ReturnType<typeof buildTeamIndexAtCutoff>) {
  for (const [k, h] of index) {
    if (k.includes("alpha")) return h;
  }
  return null;
}

const histBase = histFor(indexBase);
const histLeak = histFor(indexLeak);
assert(
  JSON.stringify(histBase?.form) === JSON.stringify(histLeak?.form),
  "form at cutoff unchanged by future fixture injection"
);

function matchFromHist(hist: typeof histBase): Match {
  return {
    id: "profile-leak-test",
    league: "premier-league",
    leagueName: "Premier League",
    leagueId: "39",
    kickoff: KICKOFF,
    home: {
      id: TEAM_ID,
      name: "Alpha FC",
      shortName: "ALP",
      form: hist?.form ?? [],
      goalsScoredAvg: 1.5,
      goalsConcededAvg: 1.0,
      homeGoalsScoredAvg: 1.8,
      homeGoalsConcededAvg: 0.9,
      awayGoalsScoredAvg: 1.2,
      awayGoalsConcededAvg: 1.1,
      lastMatchAt: hist?.lastMatchAt ?? null,
    },
    away: {
      name: "Beta United",
      shortName: "BET",
      form: ["L", "D", "W"],
      goalsScoredAvg: 1.1,
      goalsConcededAvg: 1.3,
      lastMatchAt: "2026-03-08T18:00:00.000Z",
    },
    h2h: { homeWins: 2, draws: 1, awayWins: 2, avgGoals: 2.4 },
    odds: {
      home: 2.1,
      draw: 3.4,
      away: 3.5,
      doubleChance1X: 1.28,
      doubleChanceX2: 1.55,
      over05: 1.08,
      over15: 1.3,
      over25: 1.9,
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

primeTeamProfileAt(profileBase, asOf);
const predBase = predictMatchMarkets(matchFromHist(histBase), { asOf });
primeTeamProfileAt(profileBase, asOf);
const predLeak = predictMatchMarkets(matchFromHist(histLeak), { asOf });

const homePBase = predBase.markets.find((m) => m.market === "home");
const homePLeak = predLeak.markets.find((m) => m.market === "home");
assert(homePBase != null && homePLeak != null, "home market present");
assert(
  Math.abs(homePBase!.modelProbability - homePLeak!.modelProbability) < 1e-9,
  "predictMatchMarkets(asOf) unchanged when post-cutoff rows injected"
);

const brierRows: BrierPickRow[] = [
  {
    league: "Test",
    market: "home",
    modelProbability: 0.7,
    odds: 1.5,
    outcome: "WON",
    homeTeam: "A",
    awayTeam: "B",
    kickoff: new Date("2026-03-01T12:00:00.000Z"),
  },
  {
    league: "Test",
    market: "home",
    modelProbability: 0.8,
    odds: 1.4,
    outcome: "LOST",
    homeTeam: "C",
    awayTeam: "D",
    kickoff: new Date("2026-03-20T12:00:00.000Z"),
  },
];

const asOfMid = new Date("2026-03-15T12:00:00.000Z");
const trainOnly = applyBrierLearningToWeightsAsOf(
  brierRows,
  asOfMid,
  loadModelWeights()
);
const allRows = applyBrierLearningToWeightsAsOf(
  brierRows,
  new Date("2026-04-01T00:00:00.000Z"),
  loadModelWeights()
);

assert(
  trainOnly.sampleSize <= allRows.sampleSize,
  "Brier asOf filter excludes future kickoffs from training window"
);

console.log("verify-team-profile-leakage-asof: OK", {
  matchesAnalyzed: aggBase.totalMatchesAnalyzed,
  homeP: homePBase?.modelProbability,
  brierTrainN: trainOnly.sampleSize,
});
