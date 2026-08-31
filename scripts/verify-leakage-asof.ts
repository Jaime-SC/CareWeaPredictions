/**
 * Assert temporal cutoff: post-kickoff fixtures must not alter form or xG.
 * Usage: npx tsx scripts/verify-leakage-asof.ts
 */
import {
  buildTeamIndexAtCutoff,
  teamFormAtCutoff,
  type LocalFixtureRowForTest,
} from "../lib/fixture-context";
import { estimateExpectedGoals } from "../lib/poisson";
import type { Match } from "../lib/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const KICKOFF = "2026-03-15T20:00:00.000Z";
const asOf = new Date(KICKOFF);

const preKickoff: LocalFixtureRowForTest[] = [
  {
    homeTeam: "Alpha FC",
    awayTeam: "Beta United",
    matchDate: new Date("2026-03-10T18:00:00.000Z"),
    homeGoals: 2,
    awayGoals: 0,
  },
  {
    homeTeam: "Gamma City",
    awayTeam: "Alpha FC",
    matchDate: new Date("2026-03-01T15:00:00.000Z"),
    homeGoals: 1,
    awayGoals: 1,
  },
  {
    homeTeam: "Alpha FC",
    awayTeam: "Delta Rovers",
    matchDate: new Date("2026-02-20T19:00:00.000Z"),
    homeGoals: 3,
    awayGoals: 1,
  },
  {
    homeTeam: "Epsilon Town",
    awayTeam: "Alpha FC",
    matchDate: new Date("2026-02-05T17:00:00.000Z"),
    homeGoals: 0,
    awayGoals: 2,
  },
  {
    homeTeam: "Alpha FC",
    awayTeam: "Zeta Athletic",
    matchDate: new Date("2026-01-28T20:00:00.000Z"),
    homeGoals: 1,
    awayGoals: 2,
  },
];

/** Would flip Alpha form if included (future leakage). */
const postKickoffLeak: LocalFixtureRowForTest = {
  homeTeam: "Alpha FC",
  awayTeam: "Future XI",
  matchDate: new Date("2026-03-20T18:00:00.000Z"),
  homeGoals: 5,
  awayGoals: 0,
};

const formBase = teamFormAtCutoff(preKickoff, "Alpha FC", asOf);
const formWithLeak = teamFormAtCutoff(
  [postKickoffLeak, ...preKickoff],
  "Alpha FC",
  asOf
);

assert(
  JSON.stringify(formBase) === JSON.stringify(formWithLeak),
  "post-kickoff fixture must not change team form at cutoff T"
);
assert(formBase.length === 5, "form uses up to 5 pre-cutoff matches");
assert(formBase[0] === "W", "most recent pre-cutoff result is W for Alpha");

const indexBase = buildTeamIndexAtCutoff(preKickoff, asOf);
const indexLeak = buildTeamIndexAtCutoff(
  [postKickoffLeak, ...preKickoff],
  asOf
);

function snapshot(
  index: ReturnType<typeof buildTeamIndexAtCutoff>,
  team: string
) {
  for (const [key, hist] of index) {
    if (key.includes("alpha") || team.toLowerCase().includes(key)) {
      return hist;
    }
  }
  return null;
}

const histBase = snapshot(indexBase, "Alpha FC");
const histLeak = snapshot(indexLeak, "Alpha FC");

assert(
  histBase?.lastMatchAt === histLeak?.lastMatchAt,
  "lastMatchAt must ignore post-kickoff fixtures"
);
assert(
  JSON.stringify(histBase?.allScored) === JSON.stringify(histLeak?.allScored),
  "goal averages must ignore post-kickoff fixtures"
);

function matchFromHist(hist: typeof histBase): Match {
  return {
    id: "live-leak-test",
    league: "other-domestic",
    leagueName: "Test League",
    kickoff: KICKOFF,
    home: {
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

const xgBase = estimateExpectedGoals(matchFromHist(histBase));
const xgLeak = estimateExpectedGoals(matchFromHist(histLeak));
assert(
  Math.abs(xgBase.home - xgLeak.home) < 1e-9 &&
    Math.abs(xgBase.away - xgLeak.away) < 1e-9,
  "estimateExpectedGoals must be unchanged when post-kickoff rows are injected"
);

console.log("verify-leakage-asof: OK", {
  form: formBase,
  xgHome: xgBase.home,
  xgAway: xgBase.away,
  lastMatchAt: histBase?.lastMatchAt,
});
