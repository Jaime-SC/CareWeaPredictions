/**
 * Resolve each team's domestic origin league (1ª/2ª whitelist) from cache + MatchFixture.
 * Used by TeamProfile grouping and re-group scripts.
 */
import {
  isTeamProfileOriginLeagueId,
  parseLeagueId,
} from "../config/allowed-leagues";
import { prisma } from "./db";

type CachedFixtureItem = {
  league?: { id?: number };
  teams?: {
    home?: { id?: number; name?: string };
    away?: { id?: number; name?: string };
  };
};

const TOP_FLIGHT = new Set([39, 140, 135, 71, 128, 265, 262, 253]);

export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Prefer top-flight over 2nd when both appear. */
export function preferDomesticLeague(a: number, b: number): number {
  if (TOP_FLIGHT.has(a) && !TOP_FLIGHT.has(b)) return a;
  if (TOP_FLIGHT.has(b) && !TOP_FLIGHT.has(a)) return b;
  return a;
}

/** True when primaryLeagueId must be remapped to a domestic origin league. */
export function needsDomesticLeagueRemap(
  leagueId: number | null | undefined
): boolean {
  if (leagueId == null || !Number.isFinite(leagueId)) return true;
  return !isTeamProfileOriginLeagueId(leagueId);
}

/**
 * teamId → domestic origin league id (ELITE 1ª/2ª only).
 */
export async function resolveDomesticLeagueByTeamId(): Promise<
  Map<number, number>
> {
  const byTeam = new Map<number, number>();
  const byName = new Map<string, number>();

  const mark = (teamId: number, leagueId: number, name?: string) => {
    if (!isTeamProfileOriginLeagueId(leagueId)) return;
    const prev = byTeam.get(teamId);
    byTeam.set(
      teamId,
      prev == null ? leagueId : preferDomesticLeague(prev, leagueId)
    );
    if (name) byName.set(normalizeTeamName(name), teamId);
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
    orderBy: { matchDate: "desc" },
    take: 8_000,
  });

  for (const fx of fixtures) {
    const lid = parseLeagueId(fx.leagueId);
    if (lid == null || !isTeamProfileOriginLeagueId(lid)) continue;
    const homeId = byName.get(normalizeTeamName(fx.homeTeam));
    const awayId = byName.get(normalizeTeamName(fx.awayTeam));
    if (homeId != null) mark(homeId, lid, fx.homeTeam);
    if (awayId != null) mark(awayId, lid, fx.awayTeam);
  }

  return byTeam;
}

/** Resolve one team: keep valid domestic id, else look up map / name. */
export function pickDomesticLeagueId(
  teamId: number,
  teamName: string,
  current: number | null | undefined,
  byTeamId: ReadonlyMap<number, number>,
  byName?: ReadonlyMap<string, number>
): number | null {
  if (current != null && isTeamProfileOriginLeagueId(current)) return current;
  const fromId = byTeamId.get(teamId);
  if (fromId != null) return fromId;
  if (byName) {
    const named = byName.get(normalizeTeamName(teamName));
    if (named != null) {
      const lid = byTeamId.get(named);
      if (lid != null) return lid;
    }
  }
  return null;
}
