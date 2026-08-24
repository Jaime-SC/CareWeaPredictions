/**
 * Cache-first fixture injuries → keyAbsencesCount on TeamProfile.
 * Shared cache key with context-enrichment: injuries_fixture_{id}.
 * Live miss TTL = 12h (720 min). Never throws.
 */
import {
  CACHE_TTL_MINUTES,
  getCachedPayload,
} from "./api-cache";
import { classifyInjuryRole } from "./context-engine";
import { fixtureIdFromMatchId } from "./odds-mapper";
import { countKeyAbsencesFromLists } from "./team-profile-shared";
import { seasonFallbackCandidates } from "./utils/season-mapper";

/** Explicit 12h as requested (equals CACHE_TTL_MINUTES.ODDS). */
export const INJURIES_TTL_MINUTES = 720;

export function injuriesFixtureCacheKey(fixtureId: number): string {
  return `injuries_fixture_${fixtureId}`;
}

type ApiEnvelope<T> = {
  response?: T;
  errors?: Record<string, string> | string[];
};

export type InjuryApiRow = {
  player?: {
    id?: number;
    name?: string;
    type?: string;
    reason?: string;
  };
  team?: { id?: number; name?: string };
  fixture?: { id?: number };
};

type PlayerStatRow = {
  player?: { id?: number; name?: string };
  statistics?: Array<{
    team?: { id?: number };
    goals?: { total?: number | null; assists?: number | null };
  }>;
};

export type SideInjuryResult = {
  teamId: number;
  teamName: string;
  keyAbsencesCount: number;
};

export type MatchInjuryCheck = {
  fixtureId: number;
  home: SideInjuryResult;
  away: SideInjuryResult;
  cached: boolean;
  liveFetched: boolean;
  rowCount: number;
};

const TOP_SCORER_TAKE = 5;
/** Cap live /injuries calls per pool sync (Free plan). */
const DEFAULT_MAX_LIVE = 6;

function envelopeHasErrors(errors: ApiEnvelope<unknown>["errors"]): boolean {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors).length > 0;
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isOutStatus(type?: string, reason?: string): boolean {
  const blob = `${type ?? ""} ${reason ?? ""}`.toLowerCase();
  if (/doubt|questionable|probable|duda/.test(blob)) return false;
  // Empty type/reason still counts as sidelined in API-Football injury feeds
  return true;
}

/** Pure: role-based key absences when no topscorer list is cached. */
export function countRoleBasedKeyAbsences(
  rows: InjuryApiRow[],
  teamId: number
): number {
  let n = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.team?.id != null && row.team.id !== teamId) continue;
    if (!isOutStatus(row.player?.type, row.player?.reason)) continue;
    const role = classifyInjuryRole(
      [row.player?.type, row.player?.reason].filter(Boolean).join(" ")
    );
    if (role !== "striker" && role !== "goalkeeper") continue;
    const key =
      row.player?.id != null && row.player.id > 0
        ? `id:${row.player.id}`
        : `n:${normalizeName(row.player?.name ?? "")}`;
    if (!key || key === "n:" || seen.has(key)) continue;
    seen.add(key);
    n += 1;
  }
  return n;
}

function goalsScore(row: PlayerStatRow, teamId: number): number {
  let best = 0;
  for (const st of row.statistics ?? []) {
    if (st.team?.id != null && st.team.id !== teamId) continue;
    const g = st.goals?.total ?? 0;
    const a = st.goals?.assists ?? 0;
    best = Math.max(
      best,
      (Number.isFinite(g) ? g : 0) + (Number.isFinite(a) ? a : 0)
    );
  }
  return best;
}

/** Cache-only topscorers / squad stats (0 live calls). */
async function loadCachedTopAttackers(
  teamId: number,
  leagueId?: number
): Promise<Array<{ id?: number; name?: string }>> {
  const now = new Date();
  const seasons =
    leagueId != null && Number.isFinite(leagueId)
      ? [...seasonFallbackCandidates(leagueId, now)]
      : [now.getFullYear(), now.getFullYear() - 1];
  const keys = seasons.flatMap((season) => [
    `players_topscorers_team_${teamId}_season_${season}`,
    `players_team_${teamId}_season_${season}`,
  ]);
  for (const cacheKey of keys) {
    try {
      const hit = await getCachedPayload<ApiEnvelope<PlayerStatRow[]>>(cacheKey);
      if (!hit || envelopeHasErrors(hit.errors)) continue;
      const rows = hit.response ?? [];
      if (rows.length === 0) continue;
      return [...rows]
        .map((row) => ({
          id: row.player?.id,
          name: row.player?.name,
          score: goalsScore(row, teamId),
        }))
        .filter((p) => (p.name || p.id) && p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_SCORER_TAKE)
        .map(({ id, name }) => ({ id, name }));
    } catch {
      /* ignore */
    }
  }
  return [];
}

function injuredPlayersForTeam(
  rows: InjuryApiRow[],
  teamId: number
): Array<{ id?: number; name?: string }> {
  return rows
    .filter((r) => r.team?.id == null || r.team.id === teamId)
    .filter((r) => isOutStatus(r.player?.type, r.player?.reason))
    .map((r) => ({ id: r.player?.id, name: r.player?.name }));
}

export async function resolveKeyAbsencesCount(
  rows: InjuryApiRow[],
  teamId: number
): Promise<number> {
  if (!rows.length) return 0;
  const tops = await loadCachedTopAttackers(teamId);
  if (tops.length > 0) {
    return countKeyAbsencesFromLists(
      injuredPlayersForTeam(rows, teamId),
      tops
    );
  }
  return countRoleBasedKeyAbsences(rows, teamId);
}

/**
 * Cache-first `/injuries?fixture=`. Live miss → 12h TTL; quota via apiFootballGet.
 */
export async function checkMatchInjuries(
  fixtureId: number,
  homeTeamId: number,
  awayTeamId: number,
  opts?: {
    homeName?: string;
    awayName?: string;
    persistProfiles?: boolean;
    /** When false, never live-fetch (cache only). Default true. */
    allowLive?: boolean;
    leagueId?: number | string | null;
  }
): Promise<MatchInjuryCheck> {
  const empty = (teamId: number, name: string): SideInjuryResult => ({
    teamId,
    teamName: name,
    keyAbsencesCount: 0,
  });

  const homeName = opts?.homeName ?? `Team ${homeTeamId}`;
  const awayName = opts?.awayName ?? `Team ${awayTeamId}`;
  const base: MatchInjuryCheck = {
    fixtureId,
    home: empty(homeTeamId, homeName),
    away: empty(awayTeamId, awayName),
    cached: false,
    liveFetched: false,
    rowCount: 0,
  };

  if (
    !Number.isFinite(fixtureId) ||
    fixtureId <= 0 ||
    !Number.isFinite(homeTeamId) ||
    !Number.isFinite(awayTeamId)
  ) {
    return base;
  }

  const cacheKey = injuriesFixtureCacheKey(fixtureId);
  let rows: InjuryApiRow[] = [];
  let cached = false;
  let liveFetched = false;

  try {
    const hit = await getCachedPayload<ApiEnvelope<InjuryApiRow[]>>(cacheKey);
    if (hit && !envelopeHasErrors(hit.errors) && Array.isArray(hit.response)) {
      rows = hit.response;
      cached = true;
    } else if (opts?.allowLive !== false) {
      const { apiFootballGet } = await import("./api-football");
      const json = await apiFootballGet<InjuryApiRow[]>(
        `/injuries?fixture=${fixtureId}`,
        {
          ttlMinutes: INJURIES_TTL_MINUTES || CACHE_TTL_MINUTES.ODDS,
          cacheKey,
        }
      );
      liveFetched = true;
      if (json && !envelopeHasErrors(json.errors)) {
        rows = json.response ?? [];
      }
    }
  } catch (err) {
    console.warn(`[injuries-checker] fixture=${fixtureId}:`, err);
    return base;
  }

  const homeCount = await resolveKeyAbsencesCount(rows, homeTeamId);
  const awayCount = await resolveKeyAbsencesCount(rows, awayTeamId);

  const result: MatchInjuryCheck = {
    fixtureId,
    home: {
      teamId: homeTeamId,
      teamName: homeName,
      keyAbsencesCount: homeCount,
    },
    away: {
      teamId: awayTeamId,
      teamName: awayName,
      keyAbsencesCount: awayCount,
    },
    cached,
    liveFetched,
    rowCount: rows.length,
  };

  if (opts?.persistProfiles !== false) {
    try {
      const { updateTeamProfileFlags } = await import("./team-profiler");
      const leagueOpt = { leagueId: opts?.leagueId };
      await updateTeamProfileFlags(
        homeTeamId,
        homeName,
        { keyAbsencesCount: homeCount },
        leagueOpt
      );
      await updateTeamProfileFlags(
        awayTeamId,
        awayName,
        { keyAbsencesCount: awayCount },
        leagueOpt
      );
    } catch (err) {
      console.warn("[injuries-checker] profile persist failed:", err);
    }
  }

  return result;
}

/**
 * Run injury checks for a match pool. One fetch per fixture; shared cache key.
 */
export async function applyInjuryChecksToMatchPool(
  matches: Array<{
    id: string;
    leagueId?: string | number;
    home: { id?: number; name: string };
    away: { id?: number; name: string };
  }>,
  opts?: { maxLiveFetches?: number }
): Promise<{
  fixturesChecked: number;
  liveFetches: number;
  profilesTouched: number;
}> {
  let liveLeft = opts?.maxLiveFetches ?? DEFAULT_MAX_LIVE;
  let fixturesChecked = 0;
  let liveFetches = 0;
  let profilesTouched = 0;
  const seen = new Set<number>();

  for (const m of matches) {
    const fixtureId = fixtureIdFromMatchId(m.id);
    const homeId = m.home.id;
    const awayId = m.away.id;
    if (
      fixtureId == null ||
      seen.has(fixtureId) ||
      homeId == null ||
      awayId == null ||
      homeId <= 0 ||
      awayId <= 0
    ) {
      continue;
    }
    seen.add(fixtureId);

    const cacheKey = injuriesFixtureCacheKey(fixtureId);
    const hit = await getCachedPayload<unknown>(cacheKey);
    const allowLive = hit != null || liveLeft > 0;
    if (hit == null && allowLive) liveLeft -= 1;

    const result = await checkMatchInjuries(fixtureId, homeId, awayId, {
      homeName: m.home.name,
      awayName: m.away.name,
      persistProfiles: true,
      allowLive,
      leagueId: m.leagueId,
    });
    fixturesChecked += 1;
    if (result.liveFetched) liveFetches += 1;
    profilesTouched += 2;
  }

  return { fixturesChecked, liveFetches, profilesTouched };
}
