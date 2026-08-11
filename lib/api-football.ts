import type { LeagueId, Match } from "./types";
import {
  API_CONNECTION_ERROR_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
} from "./api-messages";
import { CHILE_TIMEZONE, chileDateRange } from "./utils";

export {
  API_CONNECTION_ERROR_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
} from "./api-messages";

/** Direct API-Football (api-sports) — not RapidAPI */
const BASE_URL = "https://v3.football.api-sports.io";

/** @deprecated Prefer EMPTY_MATCHES_MESSAGE */
export const EMPTY_ELITE_MESSAGE = EMPTY_MATCHES_MESSAGE;

export type FootballApiErrorCode = "API_ERROR" | "EMPTY" | "AUTH";

export class FootballApiError extends Error {
  readonly code: FootballApiErrorCode;
  readonly status: number;

  constructor(
    message: string,
    code: FootballApiErrorCode,
    status?: number
  ) {
    super(message);
    this.name = "FootballApiError";
    this.code = code;
    this.status =
      status ??
      (code === "EMPTY" ? 404 : code === "AUTH" ? 401 : 502);
  }
}

/** National-team / FIFA-style friendlies */
const INTERNATIONAL_FRIENDLY_IDS = new Set([10]);

/**
 * Club friendlies / pre-season cups — kept ONLY when both clubs
 * belong to a verified top-tier domestic league.
 * API-Football league 667 = Friendlies Clubs.
 */
const CLUB_FRIENDLY_IDS = new Set([667]);

/** Core elite competitions (always allowed) */
const CORE_COMPETITION_IDS = new Set([
  2, // UCL
  3, // UEL
  848, // UECL
  11, // Sudamericana
  13, // Libertadores
  71, // Brasileirão
  128, // Argentina
  253, // MLS
]);

/**
 * Expanded pool for Fun modes when the elite day is thin:
 * Big-5 + South America + Chile/Colombia + MX.
 */
const EXPANDED_COMPETITION_IDS = new Set([
  ...CORE_COMPETITION_IDS,
  39, // Premier League
  140, // La Liga
  135, // Serie A
  78, // Bundesliga
  61, // Ligue 1
  265, // Primera División Chile
  239, // Primera A Colombia
  262, // Liga MX
  10, // International friendlies
  667, // Club friendlies (elite-filtered)
]);

const ALLOWED_LEAGUE_IDS = new Set([
  ...INTERNATIONAL_FRIENDLY_IDS,
  ...CLUB_FRIENDLY_IDS,
  ...CORE_COMPETITION_IDS,
]);

const TOP_TIER_LEAGUE_IDS = [
  39, // Premier League
  140, // La Liga
  135, // Serie A
  78, // Bundesliga
  61, // Ligue 1
  71, // Brasileirão Serie A
  128, // Liga Profesional Argentina
  265, // Chile
  239, // Colombia
] as const;

/** Free-plan roster seasons to try (newest first) */
const ROSTER_SEASON_CANDIDATES = [2024, 2023, 2022];

const YOUTH_OR_RESERVE_RE =
  /\b(U-?\d{2}|Under[\s-]?\d{2}|Reserve[s]?|Youth|Academy|\sII\b|\sB\b|U20|U21|U23|U19|U18)\b/i;

const LEAGUE_ID_TO_SLUG: Record<number, LeagueId> = {
  2: "champions-league",
  3: "europa-league",
  10: "international-friendlies",
  11: "copa-sudamericana",
  13: "copa-libertadores",
  39: "premier-league",
  61: "ligue-1",
  71: "brasileirao",
  78: "bundesliga",
  128: "liga-profesional",
  135: "serie-a",
  140: "laliga",
  239: "primera-colombia",
  253: "mls",
  262: "liga-mx",
  265: "primera-chile",
  667: "club-friendlies",
  848: "conference-league",
};

export interface FetchMatchesOptions {
  leagues?: string[];
  /** Inclusive days from today (0 = today only; 7 = today + next 7 days) */
  daysAhead?: number;
  /** Fetch a single civil date YYYY-MM-DD (Chile calendar). Overrides daysAhead. */
  date?: string;
  /**
   * Fun modes: start with expanded South America / Big-5 / cups pool.
   * Safe modes: keep core elite competitions only.
   */
  poolMode?: "core" | "expanded";
  /** If core pool is thinner than this, auto-upgrade to expanded. */
  expandIfFewerThan?: number;
}

export interface FetchMatchesResult {
  matches: Match[];
  source: "live";
  message?: string;
  daysFetched?: number;
  poolMode?: "core" | "expanded";
}

type ApiFixture = {
  fixture: { id: number; date: string };
  league: { id: number; name: string; season?: number };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
};

type ApiEnvelope<T> = {
  response?: T;
  errors?: Record<string, string> | string[];
};

let eliteTeamIdsCache: Set<number> | null = null;

function resolveApiKey(): string {
  const key = process.env.FOOTBALL_API_KEY?.trim();
  if (!key) {
    throw new FootballApiError(API_CONNECTION_ERROR_MESSAGE, "AUTH", 401);
  }
  return key;
}

function dateStrings(daysAhead: number): string[] {
  return chileDateRange(daysAhead);
}

function isYouthOrReserve(name: string): boolean {
  return YOUTH_OR_RESERVE_RE.test(name);
}

function mapLeagueSlug(apiLeagueId: number): LeagueId {
  return LEAGUE_ID_TO_SLUG[apiLeagueId] ?? "international-friendlies";
}

function shortName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0] + (parts[1][1] ?? parts[0][1] ?? ""))
      .toUpperCase()
      .slice(0, 3);
  }
  return cleaned.slice(0, 3).toUpperCase() || "TBD";
}

function hasApiErrors(errors: ApiEnvelope<unknown>["errors"]): boolean {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors).length > 0;
}

function formatApiErrors(errors: ApiEnvelope<unknown>["errors"]): string {
  if (!errors) return "";
  if (Array.isArray(errors)) return errors.join("; ");
  return Object.values(errors).join("; ");
}

async function apiGet<T>(
  path: string,
  apiKey: string,
  opts?: { noStore?: boolean }
): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        "x-apisports-key": apiKey,
      },
      ...(opts?.noStore
        ? { cache: "no-store" as const }
        : { next: { revalidate: 300 } }),
    });
  } catch {
    throw new FootballApiError(API_CONNECTION_ERROR_MESSAGE, "API_ERROR", 502);
  }

  if (res.status === 401 || res.status === 403) {
    throw new FootballApiError(API_CONNECTION_ERROR_MESSAGE, "AUTH", 401);
  }

  if (res.status === 429) {
    throw new FootballApiError(API_CONNECTION_ERROR_MESSAGE, "API_ERROR", 429);
  }

  if (!res.ok) {
    throw new FootballApiError(API_CONNECTION_ERROR_MESSAGE, "API_ERROR", 502);
  }

  return (await res.json()) as ApiEnvelope<T>;
}

/**
 * Load team IDs that play in verified top-tier leagues.
 * Uses recent free-plan-accessible seasons; cached in-process.
 */
async function getEliteTeamIds(apiKey: string): Promise<Set<number>> {
  if (eliteTeamIdsCache) return eliteTeamIdsCache;

  const ids = new Set<number>();

  for (const season of ROSTER_SEASON_CANDIDATES) {
    let seasonHadData = false;

    await Promise.all(
      TOP_TIER_LEAGUE_IDS.map(async (leagueId) => {
        try {
          const json = await apiGet<Array<{ team: { id: number } }>>(
            `/teams?league=${leagueId}&season=${season}`,
            apiKey
          );
          if (hasApiErrors(json.errors)) return;
          const rows = json.response ?? [];
          if (rows.length > 0) seasonHadData = true;
          for (const row of rows) ids.add(row.team.id);
        } catch (err) {
          if (err instanceof FootballApiError && err.code === "AUTH") {
            throw err;
          }
          console.warn(
            `[api-football] Elite roster fetch failed league=${leagueId} season=${season}:`,
            err
          );
        }
      })
    );

    if (seasonHadData && ids.size > 0) break;
  }

  eliteTeamIdsCache = ids;
  return ids;
}

function shouldKeepFixture(
  item: ApiFixture,
  eliteTeamIds: Set<number>,
  allowedLeagueIds: Set<number>
): boolean {
  const leagueId = item.league.id;
  if (!allowedLeagueIds.has(leagueId)) return false;

  const home = item.teams.home;
  const away = item.teams.away;

  if (isYouthOrReserve(home.name) || isYouthOrReserve(away.name)) {
    return false;
  }

  if (CLUB_FRIENDLY_IDS.has(leagueId)) {
    if (eliteTeamIds.size === 0) return false;
    return eliteTeamIds.has(home.id) && eliteTeamIds.has(away.id);
  }

  return true;
}

/**
 * Maps a live fixture into the Match shape.
 * Attack/defense averages and odds are provisional league baselines until
 * dedicated stats/odds endpoints are wired — teams/kickoff come from API only.
 */
function toMatch(item: ApiFixture): Match {
  return {
    id: `live-${item.fixture.id}`,
    league: mapLeagueSlug(item.league.id),
    leagueName: item.league.name,
    kickoff: item.fixture.date,
    home: {
      name: item.teams.home.name,
      shortName: shortName(item.teams.home.name),
      form: [],
      goalsScoredAvg: 1.35,
      goalsConcededAvg: 1.15,
    },
    away: {
      name: item.teams.away.name,
      shortName: shortName(item.teams.away.name),
      form: [],
      goalsScoredAvg: 1.2,
      goalsConcededAvg: 1.25,
    },
    h2h: { homeWins: 0, draws: 0, awayWins: 0, avgGoals: 2.4 },
    odds: {
      home: 2.1,
      draw: 3.2,
      away: 3.5,
      doubleChance1X: 1.28,
      doubleChanceX2: 1.45,
      over05: 1.18,
      over15: 1.32,
      over25: 1.55,
      under35: 1.3,
      under45: 1.18,
      homeScores: 1.25,
      awayScores: 1.33,
      dnbHome: 1.28,
      dnbAway: 1.4,
    },
  };
}

/**
 * Live-only football client. Never returns simulated fixtures.
 * Throws FootballApiError on connection failure or empty elite pool.
 */
export async function fetchUpcomingMatches(
  options: FetchMatchesOptions = {}
): Promise<FetchMatchesResult> {
  const preferredPool = options.poolMode ?? "core";
  const expandIfFewerThan = options.expandIfFewerThan ?? 10;

  let result = await fetchFromApiFootball({
    ...options,
    poolMode: preferredPool,
  });

  // Fun / thin days: widen league criteria automatically
  if (
    preferredPool === "core" &&
    result.matches.length < expandIfFewerThan
  ) {
    const expanded = await fetchFromApiFootball({
      ...options,
      poolMode: "expanded",
    });
    if (expanded.matches.length > result.matches.length) {
      result = expanded;
    }
  }

  if (result.matches.length === 0) {
    throw new FootballApiError(EMPTY_MATCHES_MESSAGE, "EMPTY", 404);
  }

  return {
    matches: result.matches,
    source: "live",
    daysFetched: result.daysFetched,
    poolMode: result.poolMode,
  };
}

async function fetchFromApiFootball(
  options: FetchMatchesOptions
): Promise<{
  matches: Match[];
  daysFetched: number;
  poolMode: "core" | "expanded";
}> {
  const apiKey = resolveApiKey();
  const dates = options.date
    ? [options.date]
    : dateStrings(options.daysAhead ?? 3);
  const poolMode = options.poolMode ?? "core";
  const allowedLeagueIds =
    poolMode === "expanded" ? EXPANDED_COMPETITION_IDS : ALLOWED_LEAGUE_IDS;

  const raw: ApiFixture[] = [];
  const seen = new Set<number>();
  let successfulDays = 0;
  let fatalError: FootballApiError | null = null;

  // Aggregate EVERY accessible day in the requested Chile range.
  // Free plans may reject some dates; we keep whatever days succeed.
  for (const date of dates) {
    try {
      const json = await apiGet<ApiFixture[]>(
        `/fixtures?date=${date}&timezone=${encodeURIComponent(CHILE_TIMEZONE)}`,
        apiKey
      );

      if (hasApiErrors(json.errors)) {
        const detail = formatApiErrors(json.errors).toLowerCase();
        if (detail.includes("plan") || detail.includes("date")) {
          continue;
        }
        fatalError = new FootballApiError(
          API_CONNECTION_ERROR_MESSAGE,
          "API_ERROR",
          502
        );
        continue;
      }

      successfulDays += 1;
      for (const item of json.response ?? []) {
        if (seen.has(item.fixture.id)) continue;
        seen.add(item.fixture.id);
        raw.push(item);
      }
    } catch (err) {
      if (err instanceof FootballApiError) {
        if (err.code === "AUTH") throw err;
        fatalError = err;
        continue;
      }
      fatalError = new FootballApiError(
        API_CONNECTION_ERROR_MESSAGE,
        "API_ERROR",
        502
      );
    }
  }

  if (successfulDays === 0) {
    throw (
      fatalError ??
      new FootballApiError(API_CONNECTION_ERROR_MESSAGE, "API_ERROR", 502)
    );
  }

  const needsEliteRoster = raw.some((f) => CLUB_FRIENDLY_IDS.has(f.league.id));
  const eliteTeamIds = needsEliteRoster
    ? await getEliteTeamIds(apiKey)
    : new Set<number>();

  let results = raw
    .filter((item) =>
      shouldKeepFixture(item, eliteTeamIds, allowedLeagueIds)
    )
    .map(toMatch);

  results.sort(
    (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
  );

  if (options.leagues && options.leagues.length > 0) {
    results = results.filter((m) => options.leagues!.includes(m.league));
  }

  return {
    matches: results,
    daysFetched: successfulDays,
    poolMode,
  };
}

export function getMatchById(
  matches: Match[],
  id: string
): Match | undefined {
  return matches.find((m) => m.id === id);
}

type ApiFixtureResult = {
  fixture: {
    id: number;
    date: string;
    status: { short: string; long?: string; elapsed?: number | null };
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
  score?: {
    fulltime?: { home: number | null; away: number | null };
  };
};

export type FixtureScoreResult = {
  fixtureId: number;
  statusShort: string;
  finished: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  homeName: string;
  awayName: string;
  date: string;
  elapsed: number | null;
};

const FINISHED_SHORT = new Set(["FT", "AET", "PEN", "AWD", "WO"]);

function chunkIds(ids: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

/**
 * Fetch live fixture status/scores by API-Football fixture ids.
 * Uses `/fixtures?ids=id-id-id` in batches (no mock data).
 */
export async function fetchFixturesByIds(
  fixtureIds: number[]
): Promise<FixtureScoreResult[]> {
  const unique = Array.from(
    new Set(fixtureIds.filter((id) => Number.isFinite(id) && id > 0))
  );
  if (unique.length === 0) return [];

  const apiKey = resolveApiKey();
  const results: FixtureScoreResult[] = [];

  for (const batch of chunkIds(unique, 20)) {
    const idsParam = batch.join("-");
    const json = await apiGet<ApiFixtureResult[]>(
      `/fixtures?ids=${idsParam}`,
      apiKey,
      { noStore: true }
    );

    if (hasApiErrors(json.errors)) {
      throw new FootballApiError(
        API_CONNECTION_ERROR_MESSAGE,
        "API_ERROR",
        502
      );
    }

    for (const item of json.response ?? []) {
      const statusShort = item.fixture.status?.short ?? "";
      const finished = FINISHED_SHORT.has(statusShort.toUpperCase());
      const homeGoals =
        item.goals?.home ?? item.score?.fulltime?.home ?? null;
      const awayGoals =
        item.goals?.away ?? item.score?.fulltime?.away ?? null;

      results.push({
        fixtureId: item.fixture.id,
        statusShort,
        finished,
        homeGoals,
        awayGoals,
        homeName: item.teams.home.name,
        awayName: item.teams.away.name,
        date: item.fixture.date,
        elapsed: item.fixture.status?.elapsed ?? null,
      });
    }
  }

  return results;
}

export function toErrorResponse(error: unknown): {
  body: {
    success: false;
    error: string;
    code: FootballApiErrorCode | "UNKNOWN";
  };
  status: number;
} {
  if (error instanceof FootballApiError) {
    return {
      body: {
        success: false,
        error: error.message,
        code: error.code,
      },
      status: error.status,
    };
  }

  return {
    body: {
      success: false,
      error: API_CONNECTION_ERROR_MESSAGE,
      code: "API_ERROR",
    },
    status: 502,
  };
}

/** Exposed for smoke / connection checks */
export async function pingApiFootball(): Promise<{
  ok: boolean;
  status?: number;
  account?: unknown;
  error?: string;
}> {
  try {
    const apiKey = resolveApiKey();
    const res = await fetch(`${BASE_URL}/status`, {
      headers: { "x-apisports-key": apiKey },
      cache: "no-store",
    });
    const json = await res.json();
    return {
      ok: res.ok,
      status: res.status,
      account: json?.response ?? json,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
