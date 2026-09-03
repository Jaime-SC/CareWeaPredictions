/**
 * League standings ranks for Poisson sanity.
 * Hot path builds tables from MatchFixture with matchDate < kickoff (no live API).
 * fetchLeagueStandings remains for scripts / manual use.
 */
import { apiFootballGet } from "./api-football";
import {
  buildCacheKey,
  CACHE_TTL_MINUTES,
  getCachedPayload,
  upsertCachedPayload,
} from "./api-cache";
import { prisma } from "./db";
import type { Match, MarketType } from "./types";
import { getTargetSeason } from "./utils/season-mapper";

/** Away rank this many places worse than home → dampen away win / DNB. */
export const STANDINGS_RANK_GAP = 10;
/** Multiplier on away / dnb_away when gap ≥ STANDINGS_RANK_GAP. */
export const STANDINGS_AWAY_PENALTY = 0.75;

export type TeamStandingRank = {
  teamId: number;
  teamName: string;
  rank: number;
};

export type LeagueStandingsTable = {
  leagueId: number;
  season: number;
  byTeamId: Record<number, number>;
  byName: Record<string, number>;
};

export type StandingsFixtureRow = {
  homeTeam: string;
  awayTeam: string;
  matchDate: Date;
  homeGoals: number;
  awayGoals: number;
};

type StandingRow = {
  rank?: number;
  team?: { id?: number; name?: string };
};

type StandingsEnvelope = Array<{
  league?: {
    id?: number;
    season?: number;
    standings?: StandingRow[][];
  };
}>;

type TeamAgg = {
  pts: number;
  gd: number;
  gf: number;
};

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function seasonForLeague(leagueId: number, kickoffIso?: string): number {
  const t = kickoffIso ? Date.parse(kickoffIso) : Date.now();
  const d = new Date(Number.isFinite(t) ? t : Date.now());
  return getTargetSeason(leagueId, d);
}

function parseScore(finalScore: string | null): { home: number; away: number } | null {
  const parts = (finalScore ?? "").split(/\s*-\s*/).map((p) => Number(p.trim()));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return null;
  }
  return { home: parts[0]!, away: parts[1]! };
}

function parseTable(
  leagueId: number,
  season: number,
  envelope: StandingsEnvelope
): LeagueStandingsTable {
  const byTeamId: Record<number, number> = {};
  const byName: Record<string, number> = {};
  const groups = envelope[0]?.league?.standings ?? [];
  for (const group of groups) {
    for (const row of group) {
      const rank = row.rank;
      const id = row.team?.id;
      const name = row.team?.name;
      if (typeof rank !== "number" || !Number.isFinite(rank)) continue;
      if (typeof id === "number" && id > 0) byTeamId[id] = rank;
      if (name) byName[normalizeName(name)] = rank;
    }
  }
  return { leagueId, season, byTeamId, byName };
}

/**
 * Point-in-time table from finished fixtures strictly before `asOf`.
 * Ranking: points desc, then GD, then GF. Name-keyed (no team ids in fixtures).
 */
export function buildStandingsTableFromFixtures(
  rows: StandingsFixtureRow[],
  opts: { leagueId: number; season: number; asOf: Date }
): LeagueStandingsTable {
  const asOfMs = opts.asOf.getTime();
  const aggs = new Map<string, TeamAgg>();

  const bump = (name: string, pts: number, gf: number, ga: number) => {
    const key = normalizeName(name);
    if (!key) return;
    const cur = aggs.get(key) ?? { pts: 0, gd: 0, gf: 0 };
    cur.pts += pts;
    cur.gf += gf;
    cur.gd += gf - ga;
    aggs.set(key, cur);
  };

  for (const r of rows) {
    if (!(r.matchDate.getTime() < asOfMs)) continue;
    bump(r.homeTeam, r.homeGoals > r.awayGoals ? 3 : r.homeGoals === r.awayGoals ? 1 : 0, r.homeGoals, r.awayGoals);
    bump(r.awayTeam, r.awayGoals > r.homeGoals ? 3 : r.awayGoals === r.homeGoals ? 1 : 0, r.awayGoals, r.homeGoals);
  }

  const ordered = [...aggs.entries()].sort((a, b) => {
    const [na, aa] = a;
    const [nb, bb] = b;
    if (bb.pts !== aa.pts) return bb.pts - aa.pts;
    if (bb.gd !== aa.gd) return bb.gd - aa.gd;
    if (bb.gf !== aa.gf) return bb.gf - aa.gf;
    return na.localeCompare(nb);
  });

  const byName: Record<string, number> = {};
  ordered.forEach(([name], i) => {
    byName[name] = i + 1;
  });

  return {
    leagueId: opts.leagueId,
    season: opts.season,
    byTeamId: {},
    byName,
  };
}

/** Scripts / manual — not used on predict/parlay hot path. */
export async function fetchLeagueStandings(
  leagueId: number,
  season?: number
): Promise<LeagueStandingsTable | null> {
  if (!Number.isFinite(leagueId) || leagueId <= 0) return null;
  const seasonYear = season ?? seasonForLeague(leagueId);
  const cacheKey = buildCacheKey("standings", {
    league: leagueId,
    season: seasonYear,
  });

  const cached = await getCachedPayload<LeagueStandingsTable>(cacheKey);
  if (isLeagueStandingsTable(cached)) return cached;

  try {
    const json = await apiFootballGet<StandingsEnvelope>(
      `/standings?league=${leagueId}&season=${seasonYear}`,
      {
        ttlMinutes: CACHE_TTL_MINUTES.ESPN, // 12h
        // Separate key so raw envelope never shadows the parsed table.
        cacheKey: `${cacheKey}_envelope`,
      }
    );
    if (!json) return null;
    const table = parseTable(leagueId, seasonYear, json.response ?? []);
    if (Object.keys(table.byTeamId).length === 0) return null;
    await upsertCachedPayload(
      cacheKey,
      "standings",
      table,
      CACHE_TTL_MINUTES.ESPN
    );
    return table;
  } catch (err) {
    console.warn(`[standings] league=${leagueId} season=${seasonYear}:`, err);
    return null;
  }
}

function isLeagueStandingsTable(v: unknown): v is LeagueStandingsTable {
  if (!v || typeof v !== "object") return false;
  const t = v as LeagueStandingsTable;
  return (
    t.byTeamId != null &&
    typeof t.byTeamId === "object" &&
    t.byName != null &&
    typeof t.byName === "object"
  );
}

function rankForTeam(
  table: LeagueStandingsTable,
  teamId: number | undefined,
  teamName: string
): number | null {
  if (teamId != null && teamId > 0 && table.byTeamId?.[teamId] != null) {
    return table.byTeamId[teamId];
  }
  const byName = table.byName?.[normalizeName(teamName)];
  return byName ?? null;
}

export type MatchStandingsContext = {
  homeRank: number | null;
  awayRank: number | null;
  /** awayRank − homeRank (positive = away lower in table). */
  awayRankGap: number | null;
};

export function standingsContextFromTable(
  table: LeagueStandingsTable,
  match: Match
): MatchStandingsContext {
  const homeRank = rankForTeam(table, match.home.id, match.home.name);
  const awayRank = rankForTeam(table, match.away.id, match.away.name);
  const awayRankGap =
    homeRank != null && awayRank != null ? awayRank - homeRank : null;
  return { homeRank, awayRank, awayRankGap };
}

/** True when away sits ≥10 places below home (e.g. 1st vs 14th). */
export function isAwayHeavyUnderdogByStandings(
  ctx: MatchStandingsContext | undefined | null
): boolean {
  return (
    ctx?.awayRankGap != null && ctx.awayRankGap >= STANDINGS_RANK_GAP
  );
}

/**
 * Dampen away win / away DNB when standings gap is extreme.
 * Returns adjusted probs + flags/notes (does not renormalize full board).
 */
export function applyStandingsAwayPenalty(
  probs: Record<MarketType, number>,
  ctx: MatchStandingsContext | undefined | null
): { probs: Record<MarketType, number>; flags: string[]; notes: string[] } {
  if (!isAwayHeavyUnderdogByStandings(ctx)) {
    return { probs, flags: [], notes: [] };
  }
  const out = { ...probs };
  out.away = Math.max(0.01, out.away * STANDINGS_AWAY_PENALTY);
  out.dnb_away = Math.max(0.01, out.dnb_away * STANDINGS_AWAY_PENALTY);
  return {
    probs: out,
    flags: ["STANDINGS_AWAY_WEAK"],
    notes: [
      `Tabla: visitante ${ctx!.awayRank}º vs local ${ctx!.homeRank}º (gap ≥${STANDINGS_RANK_GAP}) → Away/DNB Away ×${STANDINGS_AWAY_PENALTY}`,
    ],
  };
}

/**
 * Attach standings ranks from local fixtures (matchDate < kickoff).
 * No live /standings API on this path.
 */
export async function attachStandingsToMatches(
  matches: Match[]
): Promise<Match[]> {
  if (matches.length === 0) return matches;

  const leagueIds = [
    ...new Set(
      matches
        .map((m) => Number(m.leagueId))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  if (leagueIds.length === 0) return matches;

  let maxKickoff = 0;
  for (const m of matches) {
    const t = Date.parse(m.kickoff);
    if (Number.isFinite(t) && t > maxKickoff) maxKickoff = t;
  }
  if (maxKickoff <= 0) return matches;

  const leagueIdStrs = leagueIds.map(String);
  let raw: Array<{
    leagueId: string;
    homeTeam: string;
    awayTeam: string;
    matchDate: Date;
    finalScore: string | null;
  }> = [];

  try {
    raw = await prisma.matchFixture.findMany({
      where: {
        leagueId: { in: leagueIdStrs },
        finalScore: { not: null },
        matchDate: { lt: new Date(maxKickoff) },
      },
      select: {
        leagueId: true,
        homeTeam: true,
        awayTeam: true,
        matchDate: true,
        finalScore: true,
      },
      orderBy: { matchDate: "asc" },
    });
  } catch (err) {
    console.warn("[standings] fixture load failed:", err);
    return matches;
  }

  const byLeague = new Map<number, StandingsFixtureRow[]>();
  for (const r of raw) {
    const lid = Number(r.leagueId);
    if (!Number.isFinite(lid)) continue;
    const score = parseScore(r.finalScore);
    if (!score) continue;
    const list = byLeague.get(lid) ?? [];
    list.push({
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      matchDate: r.matchDate,
      homeGoals: score.home,
      awayGoals: score.away,
    });
    byLeague.set(lid, list);
  }

  return matches.map((m) => {
    const leagueId = Number(m.leagueId);
    const asOf = new Date(m.kickoff);
    if (!Number.isFinite(leagueId) || !Number.isFinite(asOf.getTime())) return m;
    const rows = byLeague.get(leagueId);
    if (!rows?.length) return m;
    const table = buildStandingsTableFromFixtures(rows, {
      leagueId,
      season: seasonForLeague(leagueId, m.kickoff),
      asOf,
    });
    if (Object.keys(table.byName).length === 0) return m;
    return { ...m, standings: standingsContextFromTable(table, m) };
  });
}
