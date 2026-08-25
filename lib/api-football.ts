import type { LeagueId, Match, MatchOdds, NearbyTeamFixture } from "./types";
import {
  API_AUTH_MESSAGE,
  API_CONNECTION_ERROR_MESSAGE,
  API_IDS_UNSUPPORTED_MESSAGE,
  API_KEY_MISSING_MESSAGE,
  API_RATE_LIMIT_MESSAGE,
  CONMEBOL_NO_ELIGIBLE_MATCHUPS_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
  EUROPE_CUP_NO_TOP2_MATCHUPS_MESSAGE,
  SA_CUP_NO_TOP2_MATCHUPS_MESSAGE,
  UEFA_NO_BIG5_MATCHUPS_MESSAGE,
} from "./api-messages";
import {
  CACHE_TTL_MINUTES,
  fetchWithCache,
  ttlMinutesForFixtureDate,
  MAX_API_PAGE,
  getApiQuota,
  getCachedPayload,
  buildCacheKey,
  purgeStaleOddsAndFixtureCache,
  purgePlanLimitNegativeCache,
  type ApiQuotaSnapshot,
} from "./api-cache";
import { env } from "./env";
import { prisma } from "./db";
import {
  applyOddsImpliedStats,
  fixtureIdFromMatchId,
  parseFixtureOdds,
  type ApiOddsFixture,
} from "./odds-mapper";
import {
  isFixtureFinished,
  isFixtureLive,
  isFixtureVoided,
} from "./match-status";
import {
  ALLOWED_LEAGUE_IDS,
  CLUB_FRIENDLY_LEAGUE_IDS,
  CONMEBOL_COMPETITION_IDS,
  CONMEBOL_ELIGIBLE_ORIGIN_LEAGUE_IDS,
  ELITE_DOMESTIC_LEAGUE_IDS,
  EUROPE_BIG5_LEAGUE_IDS,
  EUROPE_NATIONAL_CUP_IDS,
  EUROPE_NATIONAL_CUP_ORIGINS,
  SA_NATIONAL_CUP_IDS,
  SA_NATIONAL_CUP_ORIGINS,
  UEFA_COMPETITION_IDS,
  bothTeamsInRoster,
  isAllowedCompetition,
  isClubFriendlyLeagueId,
  isConmebolCompetitionId,
  isEuropeNationalCupId,
  isSaNationalCupId,
  isUefaCompetitionId,
  parseLeagueId,
} from "../config/allowed-leagues";
import { CHILE_TIMEZONE, chileDateApiWindow, chileDateOffset, chileDateRange, chileDateString } from "./utils";
import { seasonFallbackCandidates } from "./utils/season-mapper";
import { getLeagueDisplayName } from "./utils/league-labels";
import { snapshotClosingOdds } from "./clv-tracker";
import { enrichMatchContextFeatures } from "./context-enrichment";
import {
  getMonopolyTeams,
  getMonopolyTeamIds,
  getWeeklyDateRange,
  MONOPOLY_WINDOW_DAYS,
  type WeeklyDateRange,
} from "./monopoly-engine";

export {
  API_CONNECTION_ERROR_MESSAGE,
  CONMEBOL_NO_ELIGIBLE_MATCHUPS_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
  EUROPE_CUP_NO_TOP2_MATCHUPS_MESSAGE,
  SA_CUP_NO_TOP2_MATCHUPS_MESSAGE,
  UEFA_NO_BIG5_MATCHUPS_MESSAGE,
} from "./api-messages";

export {
  fetchWithCache,
  buildCacheKey,
  getApiQuota,
  syncApiQuotaFromHeaders,
  parseApiFootballQuotaHeaders,
  CACHE_TTL_MINUTES,
  API_DAILY_QUOTA_LIMIT,
  MAX_API_PAGE,
} from "./api-cache";

/** Paid plan: space live upstream calls (~200ms ≈ ≤300 req/min headroom). */
export const LIVE_REQUEST_INTERVAL_MS = 200;
/** Single 429 retry pause. */
export const RATE_LIMIT_RETRY_MS = 2_000;

export {
  ALLOWED_LEAGUE_IDS,
  CONMEBOL_COMPETITION_IDS,
  EUROPE_NATIONAL_CUP_IDS,
  SA_NATIONAL_CUP_IDS,
  UEFA_COMPETITION_IDS,
  isAllowedLeagueId,
  isClubFriendlyLeagueId,
  isConmebolCompetitionId,
  isEuropeNationalCupId,
  isSaNationalCupId,
  isUefaCompetitionId,
} from "../config/allowed-leagues";

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

/** Free-plan roster seasons: dynamic via getTargetSeason; kept as last-resort floor. */
const ROSTER_SEASON_FLOOR = 2024;

const YOUTH_OR_RESERVE_RE =
  /\b(U-?\d{2}|Under[\s-]?\d{2}|Reserve[s]?|Youth|Academy|\sII\b|\sB\b|U20|U21|U23|U19|U18)\b/i;

const LEAGUE_ID_TO_SLUG: Record<number, LeagueId> = {
  2: "champions-league",
  3: "europa-league",
  11: "copa-sudamericana",
  13: "copa-libertadores",
  16: "concacaf-champions-cup",
  39: "premier-league",
  40: "premier-league",
  45: "premier-league",
  48: "premier-league",
  71: "brasileirao",
  72: "brasileirao",
  73: "brasileirao",
  128: "liga-profesional",
  129: "liga-profesional",
  130: "liga-profesional",
  135: "serie-a",
  136: "serie-a",
  137: "serie-a",
  140: "laliga",
  141: "laliga",
  143: "laliga",
  253: "mls",
  254: "mls",
  262: "liga-mx",
  263: "liga-mx",
  265: "primera-chile",
  266: "primera-chile",
  267: "primera-chile",
  779: "leagues-cup",
  848: "conference-league",
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
  /**
   * When true, still prefer fixtures with a live book board, but never drop
   * matches solely for missing odds (Poisson fair-odds fallback).
   */
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
  fixture: {
    id: number;
    date: string;
    timestamp?: number;
    status?: { short?: string };
    referee?: string | null;
    venue?: { id?: number; name?: string | null; city?: string | null };
  };
  league: { id: number; name: string; season?: number; round?: string | null };
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
let europeBig5TeamIdsCache: Set<number> | null = null;
/** cupId → team IDs from that cup's allowed 1st+2nd domestic divisions */
let saCupOriginRostersCache: Map<number, Set<number>> | null = null;
/** ENG / ESP / ITA cupId → 1ª+2ª roster */
let europeCupOriginRostersCache: Map<number, Set<number>> | null = null;
/** Chile / Argentina / Brazil 1ª — CONMEBOL origin gate */
let conmebolEligibleTeamIdsCache: Set<number> | null = null;
let staleCachePurged: Promise<void> | null = null;

function ensureStaleCachePurged(): Promise<void> {
  if (!staleCachePurged) {
    staleCachePurged = Promise.all([
      purgeStaleOddsAndFixtureCache(),
      purgePlanLimitNegativeCache(),
    ]).then(() => undefined);
  }
  return staleCachePurged;
}

function resolveApiKey(): string {
  const key = env.FOOTBALL_API_KEY?.trim() ?? "";
  if (!key) {
    throw new FootballApiError(API_KEY_MISSING_MESSAGE, "AUTH", 401);
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
  return LEAGUE_ID_TO_SLUG[apiLeagueId] ?? "other-domestic";
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

function messageFromApiErrors(
  errors: ApiEnvelope<unknown>["errors"],
  httpStatus?: number
): string {
  if (httpStatus === 401 || httpStatus === 403) return API_AUTH_MESSAGE;
  if (httpStatus === 429) return API_RATE_LIMIT_MESSAGE;

  const detail = formatApiErrors(errors).toLowerCase();
  if (
    detail.includes("rate") ||
    detail.includes("too many") ||
    detail.includes("per minute") ||
    detail.includes("minuto")
  ) {
    return API_RATE_LIMIT_MESSAGE;
  }
  if (
    (detail.includes("request") && detail.includes("limit")) ||
    detail.includes("reached the request")
  ) {
    return `${API_RATE_LIMIT_MESSAGE} Detalle API: ${formatApiErrors(errors)}`;
  }
  if (
    detail.includes("plan") ||
    detail.includes("subscription") ||
    detail.includes("not available")
  ) {
    return `Tu plan de API-Football no permite esta consulta: ${formatApiErrors(errors)}`;
  }
  const formatted = formatApiErrors(errors);
  return formatted || API_CONNECTION_ERROR_MESSAGE;
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
    detail.includes("your subscription") ||
    detail.includes("free plans do not") ||
    detail.includes("does not have access")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let liveGate: Promise<void> = Promise.resolve();
let lastLiveRequestAt = 0;

/**
 * Serializes uncached upstream HTTP with a short paid-plan gap between starts.
 */
async function runLiveRequest<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = liveGate;
  liveGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const wait = Math.max(
      0,
      LIVE_REQUEST_INTERVAL_MS - (Date.now() - lastLiveRequestAt)
    );
    if (wait > 0) {
      await delay(wait);
    }
    lastLiveRequestAt = Date.now();
    return await fn();
  } finally {
    release();
  }
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof FootballApiError && err.status === 429) return true;
  const status = httpStatusOf(err);
  if (status === 429) return true;
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return msg.includes("too many requests") || msg.includes("rate limit");
}

function isRateLimitEnvelope(errors: ApiEnvelope<unknown>["errors"]): boolean {
  const detail = formatApiErrors(errors).toLowerCase();
  return (
    detail.includes("rate limit") ||
    detail.includes("too many requests") ||
    detail.includes("per minute")
  );
}

function httpStatusOf(err: unknown): number | undefined {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status?: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return undefined;
}

function toFootballApiError(err: unknown): FootballApiError {
  const status = httpStatusOf(err);
  if (status === 401 || status === 403) {
    return new FootballApiError(API_AUTH_MESSAGE, "AUTH", 401);
  }
  if (status === 429) {
    return new FootballApiError(API_RATE_LIMIT_MESSAGE, "API_ERROR", 429);
  }
  const detail = err instanceof Error && err.message ? err.message : "";
  return new FootballApiError(
    detail.startsWith("API-Football HTTP")
      ? `Error al conectar con API-Football (${detail}).`
      : API_CONNECTION_ERROR_MESSAGE,
    "API_ERROR",
    502
  );
}

/**
 * Pass-through: paid plans allow H2H `last` and other query params.
 * Exported for verify scripts.
 */
export function sanitizeApiParams(
  _endpoint: string,
  params: Record<string, string>
): Record<string, string> {
  return params;
}

async function apiGet<T>(
  path: string,
  apiKey: string,
  opts?: {
    /** @deprecated Prefer explicit ttlMinutes — kept for callers that forced no Next cache */
    noStore?: boolean;
    ttlMinutes?: number | null;
    cacheKey?: string;
    forceRefresh?: boolean;
    resolveTtl?: (data: ApiEnvelope<T>) => number | null;
  }
): Promise<ApiEnvelope<T> | null> {
  const [endpointPart, query = ""] = path.split("?");
  const endpoint = endpointPart.startsWith("/")
    ? endpointPart
    : `/${endpointPart}`;
  const rawParams: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query).entries()) {
    rawParams[k] = v;
  }
  const params = sanitizeApiParams(endpoint, rawParams);

  const cacheKey = opts?.cacheKey ?? buildCacheKey(endpoint, params);

  if (!opts?.forceRefresh) {
    const cached = await getCachedPayload<ApiEnvelope<T>>(cacheKey);
    if (cached !== null) {
      if (hasApiErrors(cached.errors) && isPlanOrDateRestriction(cached.errors)) {
        return null;
      }
      return cached;
    }
  }

  const liveFetch = () =>
    runLiveRequest(() =>
      fetchWithCache<ApiEnvelope<T>>(
        endpoint,
        params,
        opts?.ttlMinutes ?? CACHE_TTL_MINUTES.TODAY_PENDING,
        {
          apiKey,
          cacheKey,
          forceRefresh: true,
          resolveTtl: opts?.resolveTtl,
          quietPlanErrors: true,
        }
      )
    );

  try {
    const data = await liveFetch();
    if (hasApiErrors(data.errors) && isPlanOrDateRestriction(data.errors)) {
      console.warn(
        `[API PLAN LIMIT] Restricted endpoint for key: ${cacheKey}. Falling back to Poisson.`
      );
      return null;
    }
    return data;
  } catch (err) {
    if (httpStatusOf(err) === 429) {
      console.warn(
        "[RATE LIMIT 429] Upstream rate limit. Retrying after delay..."
      );
      await delay(RATE_LIMIT_RETRY_MS);
      try {
        const data = await liveFetch();
        if (hasApiErrors(data.errors) && isPlanOrDateRestriction(data.errors)) {
          console.warn(
            `[API PLAN LIMIT] Restricted endpoint for key: ${cacheKey}. Falling back to Poisson.`
          );
          return null;
        }
        return data;
      } catch (retryErr) {
        throw toFootballApiError(retryErr);
      }
    }
    throw toFootballApiError(err);
  }
}

/** Cache-first GET for callers outside this module (team profiler, etc.). */
export async function apiFootballGet<T>(
  path: string,
  opts?: {
    ttlMinutes?: number | null;
    cacheKey?: string;
    forceRefresh?: boolean;
  }
): Promise<ApiEnvelope<T> | null> {
  return apiGet<T>(path, resolveApiKey(), opts);
}

/**
 * Load team IDs that play in the given domestic leagues.
 * Per-league season via calendar adapter, then previous season fallback.
 */
async function loadTeamIdsForLeagues(
  apiKey: string,
  leagueIds: readonly number[]
): Promise<Set<number>> {
  const ids = new Set<number>();
  const now = new Date();

  await Promise.all(
    leagueIds.map(async (leagueId) => {
      const [current, previous] = seasonFallbackCandidates(leagueId, now);
      const seasons = [current, previous].filter((y) => y >= ROSTER_SEASON_FLOOR);

      for (const season of seasons) {
        try {
          const json = await apiGet<Array<{ team: { id: number } }>>(
            `/teams?league=${leagueId}&season=${season}`,
            apiKey,
            { ttlMinutes: CACHE_TTL_MINUTES.ROSTER }
          );
          if (!json || hasApiErrors(json.errors)) continue;
          const rows = json.response ?? [];
          if (rows.length === 0) continue;
          for (const row of rows) ids.add(row.team.id);
          break;
        } catch (err) {
          if (err instanceof FootballApiError && err.code === "AUTH") {
            throw err;
          }
          console.warn(
            `[api-football] Roster fetch failed league=${leagueId} season=${season}:`,
            err
          );
        }
      }
    })
  );

  return ids;
}

async function getEliteTeamIds(apiKey: string): Promise<Set<number>> {
  if (eliteTeamIdsCache) return eliteTeamIdsCache;
  eliteTeamIdsCache = await loadTeamIdsForLeagues(
    apiKey,
    ELITE_DOMESTIC_LEAGUE_IDS
  );
  return eliteTeamIdsCache;
}

async function getEuropeBig5TeamIds(apiKey: string): Promise<Set<number>> {
  if (europeBig5TeamIdsCache) return europeBig5TeamIdsCache;
  europeBig5TeamIdsCache = await loadTeamIdsForLeagues(
    apiKey,
    EUROPE_BIG5_LEAGUE_IDS
  );
  return europeBig5TeamIdsCache;
}

async function getSaCupOriginRosters(
  apiKey: string
): Promise<Map<number, Set<number>>> {
  if (saCupOriginRostersCache) return saCupOriginRostersCache;

  const [brazil, argentina, chile] = await Promise.all([
    loadTeamIdsForLeagues(apiKey, SA_NATIONAL_CUP_ORIGINS[73]),
    loadTeamIdsForLeagues(apiKey, SA_NATIONAL_CUP_ORIGINS[130]),
    loadTeamIdsForLeagues(apiKey, SA_NATIONAL_CUP_ORIGINS[266]),
  ]);

  const byCup = new Map<number, Set<number>>([
    [73, brazil],
    [130, argentina],
    [266, chile],
  ]);
  saCupOriginRostersCache = byCup;
  return byCup;
}

async function getEuropeCupOriginRosters(
  apiKey: string
): Promise<Map<number, Set<number>>> {
  if (europeCupOriginRostersCache) return europeCupOriginRostersCache;

  const [eng, esp, ita] = await Promise.all([
    loadTeamIdsForLeagues(apiKey, EUROPE_NATIONAL_CUP_ORIGINS[45]),
    loadTeamIdsForLeagues(apiKey, EUROPE_NATIONAL_CUP_ORIGINS[143]),
    loadTeamIdsForLeagues(apiKey, EUROPE_NATIONAL_CUP_ORIGINS[137]),
  ]);

  const byCup = new Map<number, Set<number>>([
    [45, eng],
    [48, eng],
    [143, esp],
    [137, ita],
  ]);
  europeCupOriginRostersCache = byCup;
  return byCup;
}

async function getConmebolEligibleTeamIds(
  apiKey: string
): Promise<Set<number>> {
  if (conmebolEligibleTeamIdsCache) return conmebolEligibleTeamIdsCache;
  conmebolEligibleTeamIdsCache = await loadTeamIdsForLeagues(
    apiKey,
    CONMEBOL_ELIGIBLE_ORIGIN_LEAGUE_IDS
  );
  return conmebolEligibleTeamIdsCache;
}

/** Sync peek for defense-in-depth filters after a live fetch warmed the cache. */
export function peekEuropeBig5TeamIds(): ReadonlySet<number> | null {
  return europeBig5TeamIdsCache;
}

export function peekSaCupOriginRosters(): ReadonlyMap<
  number,
  ReadonlySet<number>
> | null {
  return saCupOriginRostersCache;
}

export function peekEuropeCupOriginRosters(): ReadonlyMap<
  number,
  ReadonlySet<number>
> | null {
  return europeCupOriginRostersCache;
}

export function peekConmebolEligibleTeamIds(): ReadonlySet<number> | null {
  return conmebolEligibleTeamIdsCache;
}

type OriginRosters = {
  eliteTeamIds: Set<number>;
  europeBig5TeamIds: Set<number>;
  saCupOrigins: Map<number, Set<number>>;
  europeCupOrigins: Map<number, Set<number>>;
  conmebolEligibleTeamIds: Set<number>;
};

function shouldKeepFixture(item: ApiFixture, rosters: OriginRosters): boolean {
  const leagueId = item.league.id;
  const home = item.teams.home;
  const away = item.teams.away;

  if (!isAllowedCompetition(leagueId, item.league.name)) return false;

  if (isYouthOrReserve(home.name) || isYouthOrReserve(away.name)) {
    return false;
  }

  // Elite club friendlies: keep if AT LEAST ONE side is from a whitelisted domestic league
  if (isClubFriendlyLeagueId(leagueId)) {
    if (rosters.eliteTeamIds.size === 0) return false;
    return (
      rosters.eliteTeamIds.has(home.id) || rosters.eliteTeamIds.has(away.id)
    );
  }

  // UEFA: keep ONLY when BOTH clubs originate from Europe's Big 3 (1ª)
  if (isUefaCompetitionId(leagueId)) {
    return bothTeamsInRoster(home.id, away.id, rosters.europeBig5TeamIds);
  }

  // CONMEBOL: both clubs from Chile / Argentina / Brazil 1ª
  if (isConmebolCompetitionId(leagueId)) {
    return bothTeamsInRoster(
      home.id,
      away.id,
      rosters.conmebolEligibleTeamIds
    );
  }

  // SA national cups: both clubs from that country's 1st or 2nd division
  if (isSaNationalCupId(leagueId)) {
    const origin = rosters.saCupOrigins.get(leagueId) ?? new Set<number>();
    return bothTeamsInRoster(home.id, away.id, origin);
  }

  // ENG / ESP / ITA national cups: both from that country's 1ª or 2ª
  if (isEuropeNationalCupId(leagueId)) {
    const origin = rosters.europeCupOrigins.get(leagueId) ?? new Set<number>();
    return bothTeamsInRoster(home.id, away.id, origin);
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
 * Odds/stats are filled later via `/odds?fixture={id}` — placeholders
 * here are only structural. Fixtures without a real book board are dropped.
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
    leagueName: getLeagueDisplayName(item.league.id, item.league.name),
    leagueId: String(item.league.id),
    round: item.league.round?.trim() || null,
    kickoff,
    home: {
      id: item.teams.home.id,
      name: item.teams.home.name,
      shortName: shortName(item.teams.home.name),
      form: [],
      goalsScoredAvg: 0,
      goalsConcededAvg: 0,
    },
    away: {
      id: item.teams.away.id,
      name: item.teams.away.name,
      shortName: shortName(item.teams.away.name),
      form: [],
      goalsScoredAvg: 0,
      goalsConcededAvg: 0,
    },
    h2h: { homeWins: 0, draws: 0, awayWins: 0, avgGoals: 2.4 },
    odds: EMPTY_ODDS,
    referee: item.fixture.referee?.trim() || null,
    venue: item.fixture.venue?.name?.trim() || null,
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
  return (
    odds.home > 1 &&
    odds.draw > 1 &&
    odds.away > 1 &&
    odds.doubleChance1X > 1
  );
}

function toNearbyFixture(item: ApiFixture): NearbyTeamFixture {
  return {
    id: item.fixture.id,
    date: item.fixture.date,
    league: { id: item.league.id, name: item.league.name },
    teams: {
      home: { id: item.teams.home.id, name: item.teams.home.name },
      away: { id: item.teams.away.id, name: item.teams.away.name },
    },
  };
}

async function fetchRawApiFixturesForDates(dates: string[]): Promise<{
  fixtures: ApiFixture[];
  successfulDays: number;
  fatalError: FootballApiError | null;
}> {
  const apiKey = resolveApiKey();
  const raw: ApiFixture[] = [];
  const seen = new Set<number>();
  let successfulDays = 0;
  let fatalError: FootballApiError | null = null;

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

      if (!json) continue;

      if (hasApiErrors(json.errors)) {
        if (isPlanOrDateRestriction(json.errors)) {
          console.warn(
            `[api-football] date ${date} no disponible en el plan actual — omitida`
          );
          continue;
        }
        fatalError = new FootballApiError(
          messageFromApiErrors(json.errors),
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

  return { fixtures: raw, successfulDays, fatalError };
}

/**
 * Team fixtures in [fromYmd, toYmd] (civil dates). Used by monopoly anti-rotation
 * and the Monday–Sunday weekly scan.
 * API-Football requires `season` on `/fixtures?team=&from=&to=`.
 */
async function fetchTeamApiFixtures(
  teamId: number,
  fromYmd: string,
  toYmd: string,
  leagueId?: number
): Promise<ApiFixture[]> {
  const apiKey = resolveApiKey();
  const ref = new Date(`${fromYmd}T12:00:00`);
  const seasons =
    leagueId != null && Number.isFinite(leagueId)
      ? [...seasonFallbackCandidates(leagueId, ref)]
      : [ref.getFullYear(), ref.getFullYear() - 1];

  for (const season of seasons) {
    try {
      const json = await apiGet<ApiFixture[]>(
        `/fixtures?team=${teamId}&from=${fromYmd}&to=${toYmd}&season=${season}&timezone=${encodeURIComponent(CHILE_TIMEZONE)}`,
        apiKey,
        {
          ttlMinutes: CACHE_TTL_MINUTES.TODAY_PENDING,
          cacheKey: `fixtures_team_${teamId}_from_${fromYmd}_to_${toYmd}_season_${season}`,
        }
      );
      if (!json || hasApiErrors(json.errors)) {
        if (json && hasApiErrors(json.errors)) {
          console.warn(
            `[api-football] team window ${teamId} ${fromYmd}→${toYmd} season=${season} envelope errors — try fallback:`,
            json.errors
          );
        }
        continue;
      }
      const rows = json.response ?? [];
      if (rows.length > 0) return rows;
    } catch (err) {
      if (err instanceof FootballApiError && err.code === "AUTH") throw err;
      console.warn(
        `[api-football] team window fetch failed team=${teamId} season=${season}:`,
        err
      );
    }
  }
  return [];
}

export async function fetchTeamFixturesWindow(
  teamId: number,
  fromYmd: string,
  toYmd: string,
  leagueId?: number
): Promise<NearbyTeamFixture[]> {
  const rows = await fetchTeamApiFixtures(teamId, fromYmd, toYmd, leagueId);
  return rows.map(toNearbyFixture);
}

function isUpcomingMonopolyFixture(item: ApiFixture, nowMs = Date.now()): boolean {
  const short = item.fixture.status?.short;
  if (isFixtureFinished(short) || isFixtureVoided(short) || isFixtureLive(short)) {
    return false;
  }
  const kick = Date.parse(item.fixture.date);
  if (Number.isFinite(kick) && kick < nowMs) return false;
  return true;
}

/**
 * Attach bookmaker odds when available; keep the fixture if the book is missing
 * (monopoly exotic leagues often have no Bet365 board).
 */
async function attachOddsBestEffort(
  matches: Match[],
  apiKey: string
): Promise<Match[]> {
  if (matches.length === 0) return matches;
  const oddsByFixture = await fetchOddsForEliteFixtures(matches, apiKey);
  const out: Match[] = [];
  for (const match of matches) {
    const fixtureId = fixtureIdFromMatchId(match.id);
    const odds = fixtureId != null ? oddsByFixture.get(fixtureId) : undefined;
    if (odds && hasLiveOdds(odds)) {
      out.push(applyOddsImpliedStats(match, odds));
      continue;
    }
    out.push(match);
  }
  return out;
}

/**
 * Upcoming domestic monopoly fixtures for the current Chile week (Mon–Sun).
 * Ignores any caller date; anti-rotation windows are ±4 days around each fixture.
 */
export async function fetchMonopolyMatchPool(): Promise<{
  matches: Match[];
  daysFetched: number;
  week: WeeklyDateRange;
}> {
  await ensureStaleCachePurged();
  const apiKey = resolveApiKey();
  const week = getWeeklyDateRange();
  const fromScan = chileDateOffset(-MONOPOLY_WINDOW_DAYS, week.fromYmd);
  const toScan = chileDateOffset(MONOPOLY_WINDOW_DAYS, week.toYmd);

  const windows = new Map<number, NearbyTeamFixture[]>();
  const seen = new Set<number>();
  const candidates: ApiFixture[] = [];

  for (const team of getMonopolyTeams()) {
    const rows = await fetchTeamApiFixtures(
      team.teamId,
      fromScan,
      toScan,
      team.leagueId
    );
    windows.set(team.teamId, rows.map(toNearbyFixture));

    for (const item of rows) {
      if (seen.has(item.fixture.id)) continue;
      const plays =
        item.teams.home.id === team.teamId ||
        item.teams.away.id === team.teamId;
      if (!plays) continue;
      if (item.league.id !== team.leagueId) continue;
      const ymd = chileCivilDateFromKickoff(
        item.fixture.timestamp ?? item.fixture.date
      );
      if (!ymd || ymd < week.fromYmd || ymd > week.toYmd) continue;
      if (!isUpcomingMonopolyFixture(item)) continue;
      seen.add(item.fixture.id);
      candidates.push(item);
    }
  }

  const matches: Match[] = (
    await attachOddsBestEffort(
      candidates.map((item) => {
        const mapped = toMatch(item);
        const monopolyId = getMonopolyTeamIds().has(item.teams.home.id)
          ? item.teams.home.id
          : item.teams.away.id;
        const window = windows.get(monopolyId);
        return {
          ...mapped,
          nearbyTeamFixtures:
            window && window.length > 0 ? window : [toNearbyFixture(item)],
        };
      }),
      apiKey
    )
  ).sort(
    (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
  );

  return { matches, daysFetched: week.dates.length, week };
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
  const requireOdds = options.requireOdds ?? includeOdds;

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
    const emptyMsg = result.uefaOriginFilteredEmpty
      ? UEFA_NO_BIG5_MATCHUPS_MESSAGE
      : result.europeCupOriginFilteredEmpty
        ? EUROPE_CUP_NO_TOP2_MATCHUPS_MESSAGE
        : result.saCupOriginFilteredEmpty
          ? SA_CUP_NO_TOP2_MATCHUPS_MESSAGE
          : result.conmebolOriginFilteredEmpty
            ? CONMEBOL_NO_ELIGIBLE_MATCHUPS_MESSAGE
            : EMPTY_MATCHES_MESSAGE;
    throw new FootballApiError(emptyMsg, "EMPTY", 404);
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

const UNAVAILABLE_NO_REAL_ODDS = "UNAVAILABLE_NO_REAL_ODDS";

function oddsCacheKey(fixtureId: number, page = 1): string {
  return `odds_fixture_${fixtureId}_p${page}`;
}

const IMMINENT_KICKOFF_MS = 4 * 60 * 60 * 1000;

function isImminentKickoff(kickoffIso: string): boolean {
  const ms = new Date(kickoffIso).getTime() - Date.now();
  return Number.isFinite(ms) && ms > -15 * 60_000 && ms <= IMMINENT_KICKOFF_MS;
}

function ttlMinutesForOdds(kickoffIso: string): number | null {
  const ymd = chileCivilDateFromKickoff(kickoffIso);
  if (ymd && ymd < chileDateString()) return null;
  // Shorter TTL in the closing-line window so CLV can recapture the book.
  if (isImminentKickoff(kickoffIso)) return 60;
  return CACHE_TTL_MINUTES.ODDS;
}

/** UEFA / Libertadores / Primera first when many fixtures need odds. */
function oddsFetchPriority(match: Match): number {
  const slug = match.league;
  const name = match.leagueName.toLowerCase();
  if (slug === "champions-league" || name.includes("champions league")) return 100;
  if (slug === "europa-league") return 96;
  if (slug === "conference-league") return 94;
  if (slug === "copa-libertadores" || name.includes("libertadores")) return 92;
  if (slug === "primera-chile" || name.includes("primera división chile"))
    return 90;
  if (name.includes("primera división") || name.includes("primera division"))
    return 88;
  if (
    slug === "premier-league" ||
    slug === "laliga" ||
    slug === "serie-a"
  ) {
    return 80;
  }
  if (slug === "copa-sudamericana") return 72;
  if (slug === "club-friendlies" || slug === "international-friendlies") return 8;
  return 40;
}

function oddsFromEnvelope(
  json: ApiEnvelope<ApiOddsFixture[]> | OddsPageEnvelope
): MatchOdds | null {
  if (hasApiErrors(json.errors)) return null;
  let best: MatchOdds | null = null;
  for (const row of json.response ?? []) {
    const parsed = parseFixtureOdds(row);
    if (parsed) best = parsed;
  }
  return best;
}

async function readCachedFixtureOddsMeta(
  fixtureId: number
): Promise<{ odds: MatchOdds; remainingMs: number } | null> {
  try {
    const row = await prisma.cachedApiResponse.findUnique({
      where: { id: oddsCacheKey(fixtureId, 1) },
    });
    if (!row) return null;
    const remainingMs = new Date(row.expiresAt).getTime() - Date.now();
    if (remainingMs <= 0) return null;
    const odds = oddsFromEnvelope(JSON.parse(row.payload) as OddsPageEnvelope);
    if (!odds) return null;
    return { odds, remainingMs };
  } catch {
    return null;
  }
}

async function fetchOddsForFixtureLive(
  fixtureId: number,
  apiKey: string,
  ttlMinutes: number | null
): Promise<MatchOdds | null> {
  let best: MatchOdds | null = null;
  let totalPages = 1;

  for (let page = 1; page <= MAX_API_PAGE && page <= totalPages; page++) {
    const qs =
      page === 1
        ? `/odds?fixture=${fixtureId}`
        : `/odds?fixture=${fixtureId}&page=${page}`;

    let json = await apiGet<ApiOddsFixture[]>(qs, apiKey, {
      ttlMinutes,
      cacheKey: oddsCacheKey(fixtureId, page),
    });
    if (!json) return null;

    // Body-level rate limit (HTTP 200) — same single retry as HTTP 429 in apiGet
    if (hasApiErrors(json.errors) && isRateLimitEnvelope(json.errors)) {
      console.warn(
        "[RATE LIMIT 429] Upstream rate limit. Retrying after delay..."
      );
      await delay(RATE_LIMIT_RETRY_MS);
      json = await apiGet<ApiOddsFixture[]>(qs, apiKey, {
        ttlMinutes,
        cacheKey: oddsCacheKey(fixtureId, page),
        forceRefresh: true,
      });
      if (!json) return null;
      if (hasApiErrors(json.errors) && isRateLimitEnvelope(json.errors)) {
        throw new FootballApiError(API_RATE_LIMIT_MESSAGE, "API_ERROR", 429);
      }
    }

    if (hasApiErrors(json.errors)) {
      if (page === 1) return null;
      break;
    }

    const envelope = json as OddsPageEnvelope;
    totalPages = Math.min(
      MAX_API_PAGE,
      Math.max(1, envelope.paging?.total ?? 1)
    );
    const parsed = oddsFromEnvelope(envelope);
    if (parsed) best = parsed;
  }

  return best;
}

async function fetchOddsForFixture(
  fixtureId: number,
  apiKey: string,
  ttlMinutes: number | null
): Promise<MatchOdds | null> {
  try {
    return await fetchOddsForFixtureLive(fixtureId, apiKey, ttlMinutes);
  } catch (err) {
    if (err instanceof FootballApiError && err.code === "AUTH") throw err;
    // HTTP 429 already retried once inside apiGet; envelope 429 or final fail → null
    // so the match stays and Poisson fair odds fill the board.
    if (isRateLimitError(err)) {
      console.warn(
        `[api-football] odds fixture=${fixtureId} rate-limited after retry — Poisson fair-odds fallback`
      );
      return null;
    }
    console.warn(
      `[api-football] odds fetch failed fixture=${fixtureId}:`,
      err
    );
    return null;
  }
}

/**
 * Bookmaker odds for already-filtered elite fixtures only.
 * Cache hits return immediately; uncached live calls are capped and throttled.
 */
async function fetchOddsForEliteFixtures(
  matches: Match[],
  apiKey: string
): Promise<Map<number, MatchOdds>> {
  const map = new Map<number, MatchOdds>();
  const jobs = matches
    .map((match) => {
      const id = fixtureIdFromMatchId(match.id);
      if (id == null) return null;
      return {
        id,
        match,
        ttl: ttlMinutesForOdds(match.kickoff),
        priority: oddsFetchPriority(match),
      };
    })
    .filter(
      (row): row is {
        id: number;
        match: Match;
        ttl: number | null;
        priority: number;
      } => row != null
    )
    .sort((a, b) => {
      const imminentDelta =
        Number(isImminentKickoff(b.match.kickoff)) -
        Number(isImminentKickoff(a.match.kickoff));
      if (imminentDelta !== 0) return imminentDelta;
      return b.priority - a.priority || a.id - b.id;
    });

  const uncached: typeof jobs = [];

  for (const job of jobs) {
    const cached = await readCachedFixtureOddsMeta(job.id);
    if (cached) {
      map.set(job.id, cached.odds);
      // 12h leftovers in the closing window must be refreshed once (new TTL = 60m).
      const staleForClose =
        isImminentKickoff(job.match.kickoff) && cached.remainingMs > 90 * 60_000;
      if (staleForClose) uncached.push(job);
      continue;
    }
    uncached.push(job);
  }

  for (const job of uncached) {
    try {
      const odds = await fetchOddsForFixture(job.id, apiKey, job.ttl);
      if (odds) map.set(job.id, odds);
      // null odds → fixture kept; attachOddsToMatches → POISSON_FAIR_ODDS
    } catch (err) {
      if (err instanceof FootballApiError && err.code === "AUTH") throw err;
      console.warn(
        `[api-football] ${UNAVAILABLE_NO_REAL_ODDS} ${job.match.home.name} vs ${job.match.away.name} (${job.match.id})`
      );
    }
  }

  return map;
}

function attachOddsToMatches(
  matches: Match[],
  oddsByFixture: Map<number, MatchOdds>
): Match[] {
  const out: Match[] = [];
  for (const match of matches) {
    const fixtureId = fixtureIdFromMatchId(match.id);
    const odds = fixtureId != null ? oddsByFixture.get(fixtureId) : undefined;
    if (odds && hasLiveOdds(odds)) {
      out.push(applyOddsImpliedStats(match, odds));
      continue;
    }
    // Keep fixture — Poisson fair odds fill the board at prediction time
    console.warn(
      `[api-football] no book odds → Poisson fallback ${match.home.name} vs ${match.away.name} (${match.id})`
    );
    out.push(match);
  }
  return out;
}

async function fetchFromApiFootball(
  options: FetchMatchesOptions
): Promise<{
  matches: Match[];
  daysFetched: number;
  poolMode: "core" | "expanded" | "wide";
  uefaOriginFilteredEmpty: boolean;
  europeCupOriginFilteredEmpty: boolean;
  saCupOriginFilteredEmpty: boolean;
  conmebolOriginFilteredEmpty: boolean;
}> {
  await ensureStaleCachePurged();
  const apiKey = resolveApiKey();
  // Chile civil day → fetch ±1 API dates so UTC-shifted evening kickoffs are not missed
  const dates = options.date
    ? chileDateApiWindow(options.date)
    : dateStrings(options.daysAhead ?? 3);
  const targetChileDate = options.date ?? null;
  const poolMode = options.poolMode ?? "expanded";
  // Always the strict elite whitelist — poolMode is cosmetic for callers
  const includeOdds = options.includeOdds ?? true;
  const requireOdds = options.requireOdds ?? includeOdds;

  const { fixtures: raw, successfulDays, fatalError } =
    await fetchRawApiFixturesForDates(dates);

  // All dates blocked by plan/window → empty pool (caller may treat as EMPTY).
  // Only throw 502 when we had a real upstream failure.
  if (successfulDays === 0) {
    if (fatalError) throw fatalError;
    return {
      matches: [],
      daysFetched: 0,
      poolMode,
      uefaOriginFilteredEmpty: false,
      europeCupOriginFilteredEmpty: false,
      saCupOriginFilteredEmpty: false,
      conmebolOriginFilteredEmpty: false,
    };
  }

  const needsEliteRoster = raw.some((f) =>
    CLUB_FRIENDLY_LEAGUE_IDS.has(f.league.id)
  );
  const needsEuropeBig5Roster = raw.some((f) =>
    UEFA_COMPETITION_IDS.has(f.league.id)
  );
  const needsEuropeCupRoster = raw.some((f) =>
    EUROPE_NATIONAL_CUP_IDS.has(f.league.id)
  );
  const needsSaCupRoster = raw.some((f) =>
    SA_NATIONAL_CUP_IDS.has(f.league.id)
  );
  const needsConmebolRoster = raw.some((f) =>
    CONMEBOL_COMPETITION_IDS.has(f.league.id)
  );
  const [
    eliteTeamIds,
    europeBig5TeamIds,
    europeCupOrigins,
    saCupOrigins,
    conmebolEligibleTeamIds,
  ] = await Promise.all([
    needsEliteRoster
      ? getEliteTeamIds(apiKey)
      : Promise.resolve(new Set<number>()),
    needsEuropeBig5Roster
      ? getEuropeBig5TeamIds(apiKey)
      : Promise.resolve(new Set<number>()),
    needsEuropeCupRoster
      ? getEuropeCupOriginRosters(apiKey)
      : Promise.resolve(new Map<number, Set<number>>()),
    needsSaCupRoster
      ? getSaCupOriginRosters(apiKey)
      : Promise.resolve(new Map<number, Set<number>>()),
    needsConmebolRoster
      ? getConmebolEligibleTeamIds(apiKey)
      : Promise.resolve(new Set<number>()),
  ]);

  const rosters: OriginRosters = {
    eliteTeamIds,
    europeBig5TeamIds,
    europeCupOrigins,
    saCupOrigins,
    conmebolEligibleTeamIds,
  };

  const dayRaw = targetChileDate
    ? raw.filter((item) => fixtureBelongsToChileDate(item, targetChileDate))
    : raw;
  const hadUefaFixtures = dayRaw.some((f) =>
    UEFA_COMPETITION_IDS.has(f.league.id)
  );
  const hadEuropeCupFixtures = dayRaw.some((f) =>
    EUROPE_NATIONAL_CUP_IDS.has(f.league.id)
  );
  const hadSaCupFixtures = dayRaw.some((f) =>
    SA_NATIONAL_CUP_IDS.has(f.league.id)
  );
  const hadConmebolFixtures = dayRaw.some((f) =>
    CONMEBOL_COMPETITION_IDS.has(f.league.id)
  );

  let results = dayRaw
    .filter((item) => shouldKeepFixture(item, rosters))
    .map(toMatch);

  // Belt-and-suspenders: never leak another Chile civil day when date= is set
  if (targetChileDate) {
    results = filterMatchesOnChileDate(results, targetChileDate);
  }

  const keptUefa = results.some((m) => {
    const id = parseLeagueId(m.leagueId);
    return id != null && isUefaCompetitionId(id);
  });
  const keptEuropeCup = results.some((m) => {
    const id = parseLeagueId(m.leagueId);
    return id != null && isEuropeNationalCupId(id);
  });
  const keptSaCup = results.some((m) => {
    const id = parseLeagueId(m.leagueId);
    return id != null && isSaNationalCupId(id);
  });
  const keptConmebol = results.some((m) => {
    const id = parseLeagueId(m.leagueId);
    return id != null && isConmebolCompetitionId(id);
  });
  const uefaOriginFilteredEmpty =
    hadUefaFixtures && !keptUefa && results.length === 0;
  const europeCupOriginFilteredEmpty =
    hadEuropeCupFixtures && !keptEuropeCup && results.length === 0;
  const saCupOriginFilteredEmpty =
    hadSaCupFixtures && !keptSaCup && results.length === 0;
  const conmebolOriginFilteredEmpty =
    hadConmebolFixtures && !keptConmebol && results.length === 0;

  if (europeCupOriginFilteredEmpty) {
    console.log(
      `[ORIGIN DROP] European national cups: ${EUROPE_CUP_NO_TOP2_MATCHUPS_MESSAGE}`
    );
  }

  if (includeOdds) {
    const oddsByFixture = await fetchOddsForEliteFixtures(results, apiKey);
    results = attachOddsToMatches(results, oddsByFixture);
    await snapshotClosingOdds(oddsByFixture);
  }

  // Injuries / H2H / venue splits (cache-first; paid live budget)
  results = await enrichMatchContextFeatures(results, (path, opts) =>
    apiGet(path, apiKey, opts)
  );

  results.sort(
    (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
  );

  if (options.leagues && options.leagues.length > 0) {
    results = results.filter((m) => options.leagues!.includes(m.league));
  }

  if (requireOdds) {
    // Prefer book boards but do not drop — missing odds → Poisson fair board
    const withBook = results.filter((m) => hasLiveOdds(m.odds));
    if (withBook.length > 0 && withBook.length < results.length) {
      console.warn(
        `[api-football] ${results.length - withBook.length} fixture(s) without book odds kept for Poisson fallback`
      );
    }
  }

  return {
    matches: results,
    daysFetched: successfulDays,
    poolMode,
    uefaOriginFilteredEmpty,
    europeCupOriginFilteredEmpty,
    saCupOriginFilteredEmpty,
    conmebolOriginFilteredEmpty,
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
    halftime?: { home: number | null; away: number | null };
  };
};

export type FixtureScoreResult = {
  fixtureId: number;
  statusShort: string;
  finished: boolean;
  voided: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  homeName: string;
  awayName: string;
  date: string;
  elapsed: number | null;
  htHomeGoals?: number | null;
  htAwayGoals?: number | null;
};

function toFixtureScoreResult(item: ApiFixtureResult): FixtureScoreResult {
  const statusShort = item.fixture.status?.short ?? "";
  return {
    fixtureId: item.fixture.id,
    statusShort,
    finished: isFixtureFinished(statusShort),
    voided: isFixtureVoided(statusShort),
    homeGoals: item.goals?.home ?? item.score?.fulltime?.home ?? null,
    awayGoals: item.goals?.away ?? item.score?.fulltime?.away ?? null,
    homeName: item.teams.home.name,
    awayName: item.teams.away.name,
    date: item.fixture.date,
    elapsed: item.fixture.status?.elapsed ?? null,
    htHomeGoals: item.score?.halftime?.home ?? null,
    htAwayGoals: item.score?.halftime?.away ?? null,
  };
}

/**
 * Free-plan friendly score fetch: `/fixtures?date=` (Ids parameter is Pro-only).
 * One request covers the whole civil day — much cheaper than per-fixture calls.
 */
export async function fetchFixturesByChileDate(
  dateYmd: string,
  opts?: { forceRefresh?: boolean }
): Promise<FixtureScoreResult[]> {
  const apiKey = resolveApiKey();
  const json = await apiGet<ApiFixtureResult[]>(
    `/fixtures?date=${dateYmd}&timezone=${encodeURIComponent(CHILE_TIMEZONE)}`,
    apiKey,
    {
      ttlMinutes: ttlMinutesForFixtureDate(dateYmd),
      cacheKey: `fixtures_date_${dateYmd}`,
      forceRefresh: opts?.forceRefresh,
      resolveTtl: (envelope) => {
        if (hasApiErrors(envelope.errors)) {
          return CACHE_TTL_MINUTES.TODAY_PENDING;
        }
        const rows = envelope.response ?? [];
        if (rows.length === 0) return ttlMinutesForFixtureDate(dateYmd);
        const allTerminal = rows.every((item) => {
          const short = item.fixture.status?.short ?? "";
          return isFixtureFinished(short) || isFixtureVoided(short);
        });
        // Past days with all FT/void → permanent SQLite cache (0 live calls next time)
        if (allTerminal && dateYmd < chileDateString()) return null;
        return ttlMinutesForFixtureDate(dateYmd);
      },
    }
  );

  if (!json) return [];

  if (hasApiErrors(json.errors)) {
    if (isPlanOrDateRestriction(json.errors)) {
      console.warn(
        `[api-football] date ${dateYmd} no disponible en el plan:`,
        json.errors
      );
      return [];
    }
    throw new FootballApiError(
      messageFromApiErrors(json.errors),
      "API_ERROR",
      502
    );
  }

  return (json.response ?? []).map(toFixtureScoreResult);
}

/**
 * Resolve scores for specific fixture ids using date queries (Free plan).
 * Optional kickoff hints avoid extra DB lookups; otherwise reads MatchFixture.
 */
export async function fetchFixturesByIds(
  fixtureIds: number[],
  opts?: {
    forceRefresh?: boolean;
    /** ISO kickoffs or YYYY-MM-DD aligned with each id (same order not required) */
    kickoffsById?: Record<number, string>;
  }
): Promise<FixtureScoreResult[]> {
  const unique = Array.from(
    new Set(fixtureIds.filter((id) => Number.isFinite(id) && id > 0))
  );
  if (unique.length === 0) return [];

  const kickoffsById: Record<number, string> = {
    ...(opts?.kickoffsById ?? {}),
  };

  const missing = unique.filter((id) => !kickoffsById[id]);
  if (missing.length > 0) {
    const rows = await prisma.matchFixture.findMany({
      where: { apiFixtureId: { in: missing } },
      select: { apiFixtureId: true, matchDate: true },
    });
    for (const row of rows) {
      kickoffsById[row.apiFixtureId] = row.matchDate.toISOString();
    }
  }

  const dates = new Set<string>();
  for (const id of unique) {
    const raw = kickoffsById[id];
    if (!raw) continue;
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : chileCivilDateFromKickoff(raw);
    if (!ymd) continue;
    for (const d of chileDateApiWindow(ymd)) dates.add(d);
  }

  // No kickoff known → try today ±1 so settlement still has a chance
  if (dates.size === 0) {
    for (const d of chileDateApiWindow(chileDateString())) dates.add(d);
  }

  const byId = new Map<number, FixtureScoreResult>();
  const wanted = new Set(unique);
  let lastError: FootballApiError | null = null;

  for (const date of Array.from(dates).sort()) {
    try {
      const rows = await fetchFixturesByChileDate(date, {
        forceRefresh: opts?.forceRefresh,
      });
      for (const row of rows) {
        if (wanted.has(row.fixtureId)) byId.set(row.fixtureId, row);
      }
    } catch (err) {
      if (err instanceof FootballApiError && err.code === "AUTH") throw err;
      if (err instanceof FootballApiError) lastError = err;
      else {
        lastError = new FootballApiError(
          API_CONNECTION_ERROR_MESSAGE,
          "API_ERROR",
          502
        );
      }
    }
    if (byId.size === wanted.size) break;
  }

  if (byId.size === 0 && lastError) throw lastError;

  // Free plan never supports ?ids= — keep message available for diagnostics
  if (byId.size === 0) {
    console.warn(`[api-football] ${API_IDS_UNSUPPORTED_MESSAGE}`);
  }

  return Array.from(byId.values());
}

export type FixtureMatchStats = {
  fixtureId: number;
  cornersHome: number | null;
  cornersAway: number | null;
  yellowHome: number | null;
  yellowAway: number | null;
};

type ApiFixtureStatTeam = {
  team?: { id?: number };
  statistics?: Array<{ type?: string; value?: number | string | null }>;
};

function statValue(
  rows: ApiFixtureStatTeam[],
  teamId: number | undefined,
  needle: string
): number | null {
  if (teamId == null) return null;
  const row = rows.find((r) => r.team?.id === teamId);
  const hit = row?.statistics?.find((s) =>
    String(s.type ?? "")
      .toLowerCase()
      .includes(needle)
  );
  if (!hit || hit.value == null) return null;
  const n = Number(String(hit.value).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

/** FT corners + yellow cards for settlement (cached permanently after FT). */
export async function fetchFixtureMatchStats(
  fixtureId: number,
  homeTeamId?: number,
  awayTeamId?: number
): Promise<FixtureMatchStats> {
  const empty: FixtureMatchStats = {
    fixtureId,
    cornersHome: null,
    cornersAway: null,
    yellowHome: null,
    yellowAway: null,
  };
  if (!(fixtureId > 0)) return empty;
  const apiKey = resolveApiKey();
  const cacheKey = `fixture_statistics_${fixtureId}`;
  try {
    const json = await apiGet<ApiFixtureStatTeam[]>(
      `/fixtures/statistics?fixture=${fixtureId}`,
      apiKey,
      { ttlMinutes: null, cacheKey }
    );
    if (!json || hasApiErrors(json.errors)) return empty;
    const rows = json.response ?? [];
    let homeId = homeTeamId;
    let awayId = awayTeamId;
    if (homeId == null || awayId == null) {
      homeId = rows[0]?.team?.id;
      awayId = rows[1]?.team?.id;
    }
    return {
      fixtureId,
      cornersHome: statValue(rows, homeId, "corner"),
      cornersAway: statValue(rows, awayId, "corner"),
      yellowHome: statValue(rows, homeId, "yellow"),
      yellowAway: statValue(rows, awayId, "yellow"),
    };
  } catch (err) {
    console.warn(`[api-football] fixture stats ${fixtureId}:`, err);
    return empty;
  }
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

/**
 * Force one live /status call so quota mirrors official dashboard headers.
 */
export async function refreshApiQuotaFromStatus(): Promise<ApiQuotaSnapshot | null> {
  const apiKey = resolveApiKey();
  await apiGet("/status", apiKey, {
    ttlMinutes: CACHE_TTL_MINUTES.STATUS,
    cacheKey: "status_account",
    forceRefresh: true,
  });
  const quota = await getApiQuota();
  return quota.fromHeaders ? quota : null;
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
