/**
 * Purge TeamProfile rows for clubs that never appear in an active domestic
 * 1ª/2ª whitelist league (CO/EC/FR/DE, 3rd tiers, friendlies, etc.).
 *
 * TeamProfile has no primaryLeagueId — origin is inferred from MatchFixture
 * + CachedApiResponse fixtures. There is no TeamContextOverride model.
 *
 * Usage: npx tsx scripts/purge-unanalyzed-teams.ts
 * Dry-run:  npx tsx scripts/purge-unanalyzed-teams.ts --dry-run
 */
import {
  DENIED_LEAGUE_IDS,
  isTeamProfileOriginLeagueId,
  parseLeagueId,
} from "../config/allowed-leagues";
import { prisma } from "../lib/db";

type CachedFixtureItem = {
  fixture?: { id?: number };
  league?: { id?: number; name?: string };
  teams?: {
    home?: { id?: number; name?: string };
    away?: { id?: number; name?: string };
  };
};

type CachedEnvelope = { response?: CachedFixtureItem[] };

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function loadAnalyzableTeamIds(): Promise<{
  analyzable: Set<number>;
  byName: Map<string, number>;
  seenLeaguesByTeam: Map<number, Set<number>>;
}> {
  const analyzable = new Set<number>();
  const byName = new Map<string, number>();
  const seenLeaguesByTeam = new Map<number, Set<number>>();

  const mark = (teamId: number, leagueId: number, name?: string) => {
    if (!Number.isFinite(teamId) || teamId <= 0) return;
    let set = seenLeaguesByTeam.get(teamId);
    if (!set) {
      set = new Set();
      seenLeaguesByTeam.set(teamId, set);
    }
    set.add(leagueId);
    if (isTeamProfileOriginLeagueId(leagueId)) analyzable.add(teamId);
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
    let parsed: CachedEnvelope;
    try {
      parsed = JSON.parse(row.payload) as CachedEnvelope;
    } catch {
      continue;
    }
    for (const item of parsed.response ?? []) {
      const leagueId = item.league?.id;
      if (leagueId == null || !Number.isFinite(leagueId)) continue;
      const home = item.teams?.home;
      const away = item.teams?.away;
      if (home?.id != null) mark(home.id, leagueId, home.name);
      if (away?.id != null) mark(away.id, leagueId, away.name);
    }
  }

  const fixtures = await prisma.matchFixture.findMany({
    select: {
      apiFixtureId: true,
      leagueId: true,
      homeTeam: true,
      awayTeam: true,
    },
    take: 8_000,
  });

  for (const fx of fixtures) {
    const leagueId = parseLeagueId(fx.leagueId);
    if (leagueId == null) continue;
    const homeId = byName.get(normalizeName(fx.homeTeam));
    const awayId = byName.get(normalizeName(fx.awayTeam));
    if (homeId != null) mark(homeId, leagueId, fx.homeTeam);
    if (awayId != null) mark(awayId, leagueId, fx.awayTeam);
  }

  return { analyzable, byName, seenLeaguesByTeam };
}

function purgeReason(
  teamId: number,
  leagues: Set<number> | undefined
): string {
  if (!leagues || leagues.size === 0) return "no-known-league";
  const denied = [...leagues].filter((id) => DENIED_LEAGUE_IDS.has(id));
  if (denied.length > 0 && denied.length === leagues.size) {
    return `denied-only (${denied.join(",")})`;
  }
  return `outside-origin (${[...leagues].join(",")})`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const { analyzable, seenLeaguesByTeam } = await loadAnalyzableTeamIds();

  const profiles = await prisma.teamProfile.findMany({
    select: { id: true, teamId: true, teamName: true },
  });

  const toDelete = profiles.filter((p) => !analyzable.has(p.teamId));
  const keep = profiles.length - toDelete.length;

  console.log(
    `[purge-unanalyzed-teams] profiles=${profiles.length} analyzableOriginTeams=${analyzable.size} keep=${keep} purge=${toDelete.length}${dryRun ? " (dry-run)" : ""}`
  );

  for (const row of toDelete.slice(0, 40)) {
    console.log(
      `  DROP ${row.teamName} (teamId=${row.teamId}) — ${purgeReason(row.teamId, seenLeaguesByTeam.get(row.teamId))}`
    );
  }
  if (toDelete.length > 40) {
    console.log(`  … +${toDelete.length - 40} more`);
  }

  if (dryRun || toDelete.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.teamProfile.deleteMany({
    where: { teamId: { in: toDelete.map((p) => p.teamId) } },
  });
  console.log(`[purge-unanalyzed-teams] deleted=${result.count}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
