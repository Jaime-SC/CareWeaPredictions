/**
 * Backfill TeamProfile.primaryLeagueId + country; disambiguate Serie A IT vs BR.
 * Usage: npx tsx scripts/fix-serie-a-grouping.ts
 */
import {
  isTeamProfileOriginLeagueId,
  parseLeagueId,
} from "../config/allowed-leagues";
import { prisma } from "../lib/db";
import {
  getLeagueCountry,
  getLeagueDisplayName,
} from "../lib/utils/league-labels";

type CachedFixtureItem = {
  league?: { id?: number };
  teams?: {
    home?: { id?: number; name?: string };
    away?: { id?: number; name?: string };
  };
};

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Prefer top-flight over 2nd when both appear (71/135 over 72/136). */
function preferPrimary(a: number, b: number): number {
  const top = new Set([39, 140, 135, 71, 128, 265, 262, 253]);
  if (top.has(a) && !top.has(b)) return a;
  if (top.has(b) && !top.has(a)) return b;
  return a;
}

async function inferPrimaryLeagueByTeam(): Promise<Map<number, number>> {
  const byTeam = new Map<number, number>();
  const byName = new Map<string, number>();

  const mark = (teamId: number, leagueId: number, name?: string) => {
    if (!isTeamProfileOriginLeagueId(leagueId)) return;
    const prev = byTeam.get(teamId);
    byTeam.set(teamId, prev == null ? leagueId : preferPrimary(prev, leagueId));
    if (name) byName.set(normalizeName(name), teamId);
  };

  const cacheRows = await prisma.cachedApiResponse.findMany({
    where: {
      OR: [
        { id: { startsWith: "fixtures_date_" } },
        { id: { startsWith: "fixtures_team_" } },
        { endpoint: { contains: "fixtures" } },
      ],
    },
    select: { payload: true },
    take: 400,
  });

  for (const row of cacheRows) {
    let parsed: { response?: CachedFixtureItem[] };
    try {
      parsed = JSON.parse(row.payload) as { response?: CachedFixtureItem[] };
    } catch {
      continue;
    }
    for (const item of parsed.response ?? []) {
      const lid = item.league?.id;
      if (lid == null) continue;
      const home = item.teams?.home;
      const away = item.teams?.away;
      if (home?.id != null) mark(home.id, lid, home.name);
      if (away?.id != null) mark(away.id, lid, away.name);
    }
  }

  const fixtures = await prisma.matchFixture.findMany({
    select: { leagueId: true, homeTeam: true, awayTeam: true },
    take: 8_000,
  });
  for (const fx of fixtures) {
    const lid = parseLeagueId(fx.leagueId);
    if (lid == null || !isTeamProfileOriginLeagueId(lid)) continue;
    const homeId = byName.get(normalizeName(fx.homeTeam));
    const awayId = byName.get(normalizeName(fx.awayTeam));
    if (homeId != null) mark(homeId, lid, fx.homeTeam);
    if (awayId != null) mark(awayId, lid, fx.awayTeam);
  }

  return byTeam;
}

async function main(): Promise<void> {
  const inferred = await inferPrimaryLeagueByTeam();
  const profiles = await prisma.teamProfile.findMany({
    select: { id: true, teamId: true, teamName: true, primaryLeagueId: true },
  });

  let updated = 0;
  let italy = 0;
  let brazil = 0;

  for (const p of profiles) {
    const primary =
      (p.primaryLeagueId != null && isTeamProfileOriginLeagueId(p.primaryLeagueId)
        ? p.primaryLeagueId
        : null) ?? inferred.get(p.teamId) ?? null;
    if (primary == null) continue;

    await prisma.teamProfile.update({
      where: { id: p.id },
      data: {
        primaryLeagueId: primary,
        country: getLeagueCountry(primary),
      },
    });
    updated += 1;
    if (primary === 135) {
      italy += 1;
      console.log(`  IT  ${p.teamName} → ${getLeagueDisplayName(primary)} (Italia)`);
    } else if (primary === 71) {
      brazil += 1;
      console.log(`  BR  ${p.teamName} → ${getLeagueDisplayName(primary)} (Brasil)`);
    }
  }

  console.log(
    `[fix-serie-a-grouping] profiles=${profiles.length} updated=${updated} serieA_IT=${italy} brasileirao=${brazil}`
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
