import { materializeMatchdaySnapshots } from "../lib/team-profiler";
import { prisma } from "../lib/db";
import {
  buildTeamEventsFromFixtures,
  loadTeamIdMaps,
} from "../lib/team-profiler";
import { isFixtureFinished } from "../lib/match-status";

async function main() {
  const asOf = new Date("2026-10-01T00:00:00.000Z");
  const fixtures = await prisma.matchFixture.findMany({
    where: { finalScore: { not: null }, matchDate: { lt: asOf } },
    select: {
      apiFixtureId: true,
      homeTeam: true,
      awayTeam: true,
      finalScore: true,
      status: true,
      matchDate: true,
      leagueId: true,
    },
    orderBy: { matchDate: "desc" },
    take: 5000,
  });
  const rows = fixtures.filter(
    (r) => isFixtureFinished(r.status) || Boolean(r.finalScore)
  );
  const maps = await loadTeamIdMaps();
  const { eventsByTeam } = buildTeamEventsFromFixtures(rows, {
    asOf,
    byFixture: maps.byFixture,
    byName: maps.byName,
    leagueFilter: false,
  });
  console.log(
    JSON.stringify({
      fixtures: fixtures.length,
      rows: rows.length,
      byFixture: maps.byFixture.size,
      byName: maps.byName.size,
      teamsWithEvents: eventsByTeam.size,
      sampleTeamIds: [...eventsByTeam.keys()].slice(0, 5),
    })
  );
  const result = await materializeMatchdaySnapshots(asOf);
  console.log(JSON.stringify({ materialize: result }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
