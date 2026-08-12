import type { LeagueId, Match, MatchOdds } from "./types";
import {
  API_CONNECTION_ERROR_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
} from "./api-messages";
import {
  CACHE_TTL_MINUTES,
  fetchWithCache,
  ttlMinutesForFixtureDate,
} from "./api-cache";
import {
  applyOddsImpliedStats,
  fixtureIdFromMatchId,
  parseFixtureOdds,
  type ApiOddsFixture,
} from "./odds-mapper";
import {
  ALLOWED_LEAGUE_IDS,
  CLUB_FRIENDLY_LEAGUE_IDS,
  ELITE_DOMESTIC_LEAGUE_IDS,
  isAllowedLeagueId,
  isClubFriendlyLeagueId,
} from "../config/allowed-leagues";
import { CHILE_TIMEZONE, chileDateApiWindow, chileDateRange, chileDateString } from "./utils";

export {
  API_CONNECTION_ERROR_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
} from "./api-messages";

export {
  fetchWithCache,
  buildCacheKey,
  getApiQuota,
  CACHE_TTL_MINUTES,
  API_DAILY_QUOTA_LIMIT,
} from "./api-cache";

export {
  ALLOWED_LEAGUE_IDS,
  isAllowedLeagueId,
  isClubFriendlyLeagueId,
} from "../config/allowed-leagues";

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

/** Free-plan roster seasons to try (newest first) */
const ROSTER_SEASON_CANDIDATES = [2024, 2023, 2022];

const YOUTH_OR_RESERVE_RE =
  /\b(U-?\d{2}|Under[\s-]?\d{2}|Reserve[s]?|Youth|Academy|\sII\b|\sB\b|U20|U21|U23|U19|U18)\b/i;

const LEAGUE_ID_TO_SLUG: Record<number, LeagueId> = {
  2: "champions-league",
  3: "europa-league",
  11: "copa-sudamericana",
  13: "copa-libertadores",
  16: "concacaf-champions-cup",
  39: "premier-league",
  45: "premier-league",
  48: "premier-league",
  61: "ligue-1",
  66: "ligue-1",
  71: "brasileirao",
  73: "brasileirao",
  78: "bundesliga",
  81: "bundesliga",
  128: "liga-profesional",
  130: "liga-profesional",
  135: "serie-a",
  137: "serie-a",
  140: "laliga",
  143: "laliga",
  239: "primera-colombia",
  240: "primera-colombia",
  242: "liga-pro-ecuador",
  253: "mls",
  254: "mls",
  262: "liga-mx",
  263: "liga-mx",
  265: "primera-chile",
  266: "primera-chile",
  267: "primera-chile",
  666: "club-friendlies",
  667: "club-friendlies",
  779: "leagues-cup",
  848: "conference-league",
  1050: "liga-pro-ecuador",
};

export interface FetchMatchesOptions {
  leagues?: string[];
  /** Inclusive days from today (0 = today only; 7 = today + next 7 days) */
  daysAhead?: number;
  /** Fetch a single civil date YYYY-MM-DD (Chile calendar). Overrides daysAhead. */
  date?: string;
  /**
   * All modes resolve to the same elite whitelist.
   * Kept for API compatibility (`core` | `expanded` | `wide` → elite only).
   */
  poolMode?: "core" | "expanded" | "wide";
  /** Ignored — elite whitelist is always applied. */
  expandIfFewerThan?: number;
  includeOdds?: boolean;
  requireOdds?: boolean;
}

export interface FetchMatchesResult {
  matches: Match[];
  source: "live";
  message?: string;
  daysFetched?: number;
  poolMode?: "core" | "expanded" | "wide";
}

type ApiFixture = {
  fixture: { id: number; date: string; timestamp?: number };
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
  return LEAGUE_ID_TO_SLUG[apiLeagueId] ?? "club-friendlies";
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

/** Free-plan / date-window rejections — not a connectivity outage. */
function isPlanOrDateRestriction(
  errors: ApiEnvelope<unknown>["errors"]
): boolean {
  const detail = formatApiErrors(errors).toLowerCase();
  return (
    detail.includes("plan") ||
    detail.includes("date") ||
    detail.includes("subscription") ||
    detail.includes("not available") ||
    detail.includes("your subscription")
  );
}

async function apiGet<T>(
  path: string,
  apiKey: string,
  opts?: {
    /** @deprecated Prefer explicit ttlMinutes — kept for callers that forced no Next cache */
    noStore?: boolean;
    ttlMinutes?: number | null;
    cacheKey?: string;
    resolveTtl?: (data: ApiEnvelope<T>) => number | null;
  }
): Promise<ApiEnvelope<T>> {
  const [endpointPart, query = ""] = path.split("?");
  const endpoint = endpointPart.startsWith("/")
    ? endpointPart
    : `/${endpointPart}`;
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query).entries()) {
    params[k] = v;
  }

  try {
    return await fetchWithCache<ApiEnvelope<T>>(
      endpoint,
      params,
      opts?.ttlMinutes ?? CACHE_TTL_MINUTES.TODAY_PENDING,
      {
        apiKey,
        cacheKey: opts?.cacheKey,
        resolveTtl: opts?.resolveTtl,
      }
    );
  } catch (err) {
    const status =
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : undefined;

    if (status === 401 || status === 403) {
      throw new FootballApiError(API_CONNECTION_ERROR_MESSAGE, "AUTH", 401);
    }
    if (status === 429) {
      throw new FootballApiError(API_CONNECTION_ERROR_MESSAGE, "API_ERROR", 429);
    }
    throw new FootballApiError(API_CONNECTION_ERROR_MESSAGE, "API_ERROR", 502);
  }
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
      ELITE_DOMESTIC_LEAGUE_IDS.map(async (leagueId) => {
        try {
          const json = await apiGet<Array<{ team: { id: number } }>>(
            `/teams?league=${leagueId}&season=${season}`,
            apiKey,
            { ttlMinutes: CACHE_TTL_MINUTES.ROSTER }
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
  eliteTeamIds: Set<number>
): boolean {
  const leagueId = item.league.id;
  const home = item.teams.home;
  const away = item.teams.away;

  if (!isAllowedLeagueId(leagueId)) return false;

  if (isYouthOrReserve(home.name) || isYouthOrReserve(away.name)) {
    return false;
  }

  // Elite club friendlies: keep if AT LEAST ONE side is from a whitelisted domestic league
  if (isClubFriendlyLeagueId(leagueId)) {
    if (eliteTeamIds.size === 0) return false;
    return eliteTeamIds.has(home.id) || eliteTeamIds.has(away.id);
  }

  return true;
}

/** Chile civil YYYY-MM-DD for a fixture kickoff (ISO or unix seconds). */
export function chileCivilDateFromKickoff(
  isoOrUnix: string | number | null | undefined
): string | null {
  if (isoOrUnix == null || isoOrUnix === "") return null;
  const ms =
    typeof isoOrUnix === "number"
      ? isoOrUnix < 1e12
        ? isoOrUnix * 1000
        : isoOrUnix
      : Date.parse(isoOrUnix);
  if (!Number.isFinite(ms)) return null;
  return chileDateString(new Date(ms));
}

/** Keep only fixtures whose kickoff falls on Chile civil date `ymd`. */
export function filterMatchesOnChileDate(
  matches: Match[],
  ymd: string
): Match[] {
  return matches.filter((m) => chileCivilDateFromKickoff(m.kickoff) === ymd);
}

function fixtureBelongsToChileDate(
  item: ApiFixture,
  ymd: string
): boolean {
  const fromTs = chileCivilDateFromKickoff(item.fixture.timestamp ?? null);
  if (fromTs) return fromTs === ymd;
  return chileCivilDateFromKickoff(item.fixture.date) === ymd;
}

/**
 * Maps a live fixture into the Match shape.
 * Odds/stats are filled later via /odds + local enrichment — placeholders
 * here are only structural and MUST be replaced before prediction.
 */
function toMatch(item: ApiFixture): Match {
  const kickoff =
    item.fixture.date ||
    (item.fixture.timestamp
      ? new Date(
          item.fixture.timestamp < 1e12
            ? item.fixture.timestamp * 1000
            : item.fixture.timestamp
        ).toISOString()
      : new Date().toISOString());

  return {
    id: `live-${item.fixture.id}`,
    league: mapLeagueSlug(item.league.id),
    leagueName: item.league.name,
    kickoff,
    home: {
      name: item.teams.home.name,
      shortName: shortName(item.teams.home.name),
      form: [],
      goalsScoredAvg: 0,
      goalsConcededAvg: 0,
    },
    away: {
      name: item.teams.away.name,
      shortName: shortName(item.teams.away.name),
      form: [],
      goalsScoredAvg: 0,
      goalsConcededAvg: 0,
    },
    h2h: { homeWins: 0, draws: 0, awayWins: 0, avgGoals: 2.4 },
    odds: EMPTY_ODDS,
  };
}

/** Sentinel odds — never used for ranking once includeOdds is applied. */
const EMPTY_ODDS: MatchOdds = {
  home: 0,
  draw: 0,
  away: 0,
  doubleChance1X: 0,
  doubleChanceX2: 0,
  over05: 0,
  over15: 0,
  over25: 0,
  under35: 0,
  under45: 0,
  homeScores: 0,
  awayScores: 0,
  dnbHome: 0,
  dnbAway: 0,
};

function hasLiveOdds(odds: MatchOdds): boolean {
  return odds.home > 1 && odds.draw > 1 && odds.away > 1 && odds.doubleChance1X > 1;
}

/**
 * Live-only football client. Never returns simulated fixtures.
 * Throws FootballApiError on connection failure or empty elite pool.
 */
export async function fetchUpcomingMatches(
  options: FetchMatchesOptions = {}
): Promise<FetchMatchesResult> {
  const preferredPool = options.poolMode ?? "expanded";
  const includeOdds = options.includeOdds ?? true;
  const requireOdds = options.requireOdds ?? false;

  // Every poolMode resolves to the same elite whitelist
  let result = await fetchFromApiFootball({
    ...options,
    poolMode: preferredPool,
    includeOdds,
    requireOdds,
  });

  // Strict Chile civil-date clamp when a single date was requested
  if (options.date) {
    result = {
      ...result,
      matches: filterMatchesOnChileDate(result.matches, options.date),
    };
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

type OddsPageEnvelope = {
  response?: ApiOddsFixture[];
  errors?: ApiEnvelope<unknown>["errors"];
  paging?: { current: number; total: number };
};

/**
 * Prefetch bookmaker odds for a civil date (paginated, cached).
 * Follows all pages (soft cap) so whitelist matchdays are not truncated.
 */
async function fetchOddsMapForDate(
  date: string,
  apiKey: string,
  maxPages = 25
): Promise<Map<number, MatchOdds>> {
  const map = new Map<number, MatchOdds>();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    try {
      const json = await apiGet<ApiOddsFixture[]>(
        `/odds?date=${date}&page=${page}`,
        apiKey,
        {
          ttlMinutes: ttlMinutesForFixtureDate(date) ?? CACHE_TTL_MINUTES.FUTURE,
          cacheKey: `odds_date_${date}_p${page}`,
        }
      );

      if (hasApiErrors(json.errors)) {
        break;
      }

      const envelope = json as OddsPageEnvelope;
      totalPages = Math.max(1, envelope.paging?.total ?? 1);

      for (const row of envelope.response ?? []) {
        const parsed = parseFixtureOdds(row);
        if (!parsed) continue;
        map.set(row.fixture.id, parsed);
      }
    } catch (err) {
      if (err instanceof FootballApiError && err.code === "AUTH") throw err;
      console.warn(`[api-football] odds fetch failed date=${date} page=${page}:`, err);
      break;
    }
    page += 1;
  }

  return map;
}

function attachOddsToMatches(
  matches: Match[],
  oddsByFixture: Map<number, MatchOdds>,
  requireOdds: boolean
): Match[] {
  const out: Match[] = [];
  for (const match of matches) {
    const fixtureId = fixtureIdFromMatchId(match.id);
    const odds = fixtureId != null ? oddsByFixture.get(fixtureId) : undefined;
    if (!odds) {
      // Keep fixture — Poisson fair odds fill gaps at prediction time
      if (!requireOdds) out.push(match);
      continue;
    }
    out.push(applyOddsImpliedStats(match, odds));
  }
  return out;
}

async function fetchFromApiFootball(
  options: FetchMatchesOptions
): Promise<{
  matches: Match[];
  daysFetched: number;
  poolMode: "core" | "expanded" | "wide";
}> {
  const apiKey = resolveApiKey();
  // Chile civil day → fetch ±1 API dates so UTC-shifted evening kickoffs are not missed
  const dates = options.date
    ? chileDateApiWindow(options.date)
    : dateStrings(options.daysAhead ?? 3);
  const targetChileDate = options.date ?? null;
  const poolMode = options.poolMode ?? "expanded";
  // Always the strict elite whitelist — poolMode is cosmetic for callers
  const includeOdds = options.includeOdds ?? true;
  // Never hard-drop whitelist fixtures solely for missing book lines
  const requireOdds = options.requireOdds ?? false;

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
        apiKey,
        {
          ttlMinutes: ttlMinutesForFixtureDate(date),
          cacheKey: `fixtures_date_${date}`,
        }
      );

      if (hasApiErrors(json.errors)) {
        if (isPlanOrDateRestriction(json.errors)) {
          console.warn(
            `[api-football] date ${date} no disponible en el plan actual — omitida`
          );
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

  // All dates blocked by plan/window → empty pool (caller may treat as EMPTY).
  // Only throw 502 when we had a real upstream failure.
  if (successfulDays === 0) {
    if (fatalError) throw fatalError;
    return { matches: [], daysFetched: 0, poolMode };
  }

  const needsEliteRoster = raw.some((f) =>
    CLUB_FRIENDLY_LEAGUE_IDS.has(f.league.id)
  );
  const eliteTeamIds = needsEliteRoster
    ? await getEliteTeamIds(apiKey)
    : new Set<number>();

  let results = raw
    .filter((item) => {
      if (!shouldKeepFixture(item, eliteTeamIds)) return false;
      // Prefer Chile TZ civil-day membership over raw API date bucket
      if (targetChileDate && !fixtureBelongsToChileDate(item, targetChileDate)) {
        return false;
      }
      return true;
    })
    .map(toMatch);

  // Belt-and-suspenders: never leak another Chile civil day when date= is set
  if (targetChileDate) {
    results = filterMatchesOnChileDate(results, targetChileDate);
  }

  if (includeOdds) {
    const oddsMaps = await Promise.all(
      dates.map((d) => fetchOddsMapForDate(d, apiKey))
    );
    const merged = new Map<number, MatchOdds>();
    for (const m of oddsMaps) {
      for (const [id, odds] of m) merged.set(id, odds);
    }
    results = attachOddsToMatches(results, merged, requireOdds);
  }

  results.sort(
    (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
  );

  if (options.leagues && options.leagues.length > 0) {
    results = results.filter((m) => options.leagues!.includes(m.league));
  }

  // Optional strict mode only — default keeps fixtures and lets Poisson fill odds
  if (requireOdds) {
    results = results.filter((m) => hasLiveOdds(m.odds));
  }

  console.log(
    `[api-football] elite fixtures kept=${results.length}` +
      (targetChileDate ? ` chileDate=${targetChileDate}` : "") +
      ` apiDates=${dates.join(",")}`
  );

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
      {
        ttlMinutes: CACHE_TTL_MINUTES.TODAY_PENDING,
        cacheKey: `fixtures_ids_${idsParam}`,
        resolveTtl: (envelope) => {
          const rows = envelope.response ?? [];
          if (rows.length === 0) return CACHE_TTL_MINUTES.TODAY_PENDING;
          const allFinished = rows.every((item) =>
            FINISHED_SHORT.has(
              (item.fixture.status?.short ?? "").toUpperCase()
            )
          );
          // Finished matches → permanent cache (never burn quota again)
          return allFinished ? null : CACHE_TTL_MINUTES.TODAY_PENDING;
        },
      }
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
    const json = await fetchWithCache<{ response?: unknown }>(
      "/status",
      {},
      CACHE_TTL_MINUTES.STATUS,
      { apiKey, cacheKey: "status_account" }
    );
    return {
      ok: true,
      status: 200,
      account: json?.response ?? json,
    };
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : undefined;
    return {
      ok: false,
      status,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
