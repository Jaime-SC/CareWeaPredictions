/**
 * API-Football league standings → rank context for Poisson sanity.
 * Cache TTL 12h (standings move slowly). Soft-fail / budget-aware.
 */
import { apiFootballGet } from "./api-football";
import {
  buildCacheKey,
  CACHE_TTL_MINUTES,
  getCachedPayload,
  upsertCachedPayload,
} from "./api-cache";
import type { Match, MarketType } from "./types";

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

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function currentSeasonYear(kickoffIso?: string): number {
  const t = kickoffIso ? Date.parse(kickoffIso) : Date.now();
  const d = new Date(Number.isFinite(t) ? t : Date.now());
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based; European seasons flip ~July
  return m >= 6 ? y : y - 1;
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

export async function fetchLeagueStandings(
  leagueId: number,
  season?: number
): Promise<LeagueStandingsTable | null> {
  if (!Number.isFinite(leagueId) || leagueId <= 0) return null;
  const seasonYear = season ?? currentSeasonYear();
  const cacheKey = buildCacheKey("standings", {
    league: leagueId,
    season: seasonYear,
  });

  const cached = await getCachedPayload<LeagueStandingsTable>(cacheKey);
  if (cached) return cached;

  try {
    const json = await apiFootballGet<StandingsEnvelope>(
      `/standings?league=${leagueId}&season=${seasonYear}`,
      {
        ttlMinutes: CACHE_TTL_MINUTES.ESPN, // 12h
        cacheKey,
      }
    );
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

function rankForTeam(
  table: LeagueStandingsTable,
  teamId: number | undefined,
  teamName: string
): number | null {
  if (teamId != null && teamId > 0 && table.byTeamId[teamId] != null) {
    return table.byTeamId[teamId];
  }
  const byName = table.byName[normalizeName(teamName)];
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

/** Max live standings fetches per enrich pass. */
const STANDINGS_LIVE_BUDGET = 3;

/**
 * Attach standings ranks to matches (cache-first, small live budget).
 */
export async function attachStandingsToMatches(
  matches: Match[]
): Promise<Match[]> {
  if (matches.length === 0) return matches;

  const byLeague = new Map<number, Match[]>();
  for (const m of matches) {
    const id = Number(m.leagueId);
    if (!Number.isFinite(id) || id <= 0) continue;
    const list = byLeague.get(id) ?? [];
    list.push(m);
    byLeague.set(id, list);
  }

  const tables = new Map<number, LeagueStandingsTable>();
  let liveLeft = STANDINGS_LIVE_BUDGET;
  for (const leagueId of byLeague.keys()) {
    const season = currentSeasonYear(byLeague.get(leagueId)?.[0]?.kickoff);
    const cacheKey = buildCacheKey("standings", {
      league: leagueId,
      season,
    });
    const cached = await getCachedPayload<LeagueStandingsTable>(cacheKey);
    if (cached) {
      tables.set(leagueId, cached);
      continue;
    }
    if (liveLeft <= 0) continue;
    liveLeft -= 1;
    const table = await fetchLeagueStandings(leagueId, season);
    if (table) tables.set(leagueId, table);
  }

  return matches.map((m) => {
    const id = Number(m.leagueId);
    const table = tables.get(id);
    if (!table) return m;
    return { ...m, standings: standingsContextFromTable(table, m) };
  });
}
