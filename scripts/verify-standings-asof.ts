/**
 * Assert standings ranks ignore post-kickoff fixtures.
 * Usage: npx tsx scripts/verify-standings-asof.ts
 */
import {
  buildStandingsTableFromFixtures,
  standingsContextFromTable,
  type StandingsFixtureRow,
} from "../lib/standings";
import type { Match } from "../lib/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const KICKOFF = "2026-03-15T20:00:00.000Z";
const asOf = new Date(KICKOFF);
const LEAGUE_ID = 39;

const base: StandingsFixtureRow[] = [
  {
    homeTeam: "Alpha FC",
    awayTeam: "Beta United",
    matchDate: new Date("2026-03-01T15:00:00.000Z"),
    homeGoals: 2,
    awayGoals: 0,
  },
  {
    homeTeam: "Gamma City",
    awayTeam: "Delta Rovers",
    matchDate: new Date("2026-03-08T15:00:00.000Z"),
    homeGoals: 1,
    awayGoals: 1,
  },
  {
    homeTeam: "Beta United",
    awayTeam: "Gamma City",
    matchDate: new Date("2026-03-10T18:00:00.000Z"),
    homeGoals: 0,
    awayGoals: 3,
  },
];

const leak: StandingsFixtureRow = {
  homeTeam: "Alpha FC",
  awayTeam: "Future XI",
  matchDate: new Date("2026-03-20T18:00:00.000Z"),
  homeGoals: 5,
  awayGoals: 0,
};

const tableBase = buildStandingsTableFromFixtures(base, {
  leagueId: LEAGUE_ID,
  season: 2025,
  asOf,
});
const tableLeak = buildStandingsTableFromFixtures([...base, leak], {
  leagueId: LEAGUE_ID,
  season: 2025,
  asOf,
});

assert(
  JSON.stringify(tableBase.byName) === JSON.stringify(tableLeak.byName),
  "post-kickoff fixture must not change standings ranks"
);
assert(tableBase.byName["gamma city"] === 1, "Gamma leads on points");
assert(tableBase.byName["alpha fc"] === 2, "Alpha second");

const stubMatch = {
  home: { name: "Alpha FC" },
  away: { name: "Beta United" },
} as Match;

const ctx = standingsContextFromTable(tableBase, stubMatch);
assert(ctx.homeRank === 2, "home rank from name table");
assert(ctx.awayRank != null && ctx.awayRank > 2, "away ranked below home");

console.log("verify-standings-asof: OK", {
  ranks: tableBase.byName,
  awayRankGap: ctx.awayRankGap,
});
