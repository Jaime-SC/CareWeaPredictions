import type { LeagueId, Match, MatchOdds, NearbyTeamFixture } from "./types";
import {
  API_AUTH_MESSAGE,
  API_CONNECTION_ERROR_MESSAGE,
  API_IDS_UNSUPPORTED_MESSAGE,
  API_KEY_MISSING_MESSAGE,
  API_RATE_LIMIT_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
} from "./api-messages";
import {
  CACHE_TTL_MINUTES,
  fetchWithCache,
  ttlMinutesForFixtureDate,
  FREE_PLAN_MAX_PAGE,
  getCachedPayload,
  buildCacheKey,
} from "./api-cache";
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
  ELITE_DOMESTIC_LEAGUE_IDS,
  isAllowedCompetition,
  isClubFriendlyLeagueId,
} from "../config/allowed-leagues";
import { CHILE_TIMEZONE, chileDateApiWindow, chileDateOffset, chileDateRange, chileDateString } from "./utils";
import { purgeStaleOddsAndFixtureCache } from "./cache";
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
  EMPTY_MATCHES_MESSAGE,
} from "./api-messages";

export {
  fetchWithCache,
  buildCacheKey,
  getApiQuota,
  syncApiQuotaFromHeaders,
  parseApiFootballQuotaHeaders,
  refreshApiQuotaFromStatus,
  CACHE_TTL_MINUTES,
  API_DAILY_QUOTA_LIMIT,
  FREE_PLAN_MAX_PAGE,
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
  /** When omitted, follows includeOdds: live bookmaker odds are required. */
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
let staleCachePurged: Promise<void> | null = null;

function ensureStaleCachePurged(): Promise<void> {
  if (!staleCachePurged) {
    staleCachePurged = purgeStaleOddsAndFixtureCache().then(() => undefined);
  }
  return staleCachePurged;
}

function resolveApiKey(): string {
  const key = process.env.FOOTBALL_API_KEY?.trim();
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
    return `Tu plan Free no permite esta consulta: ${formatApiErrors(errors)}`;
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
    detail.includes("your subscription")
  );
}

/** Free plan: 10 HTTP requests / minute. Space live calls by 6.2s. */
const FREE_PLAN_LIVE_INTERVAL_MS = 6_200;
const ODDS_UNCACHED_BATCH_CAP = 8;
const RATE_LIMIT_COOLDOWN_MS = 60_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let liveGate: Promise<void> = Promise.resolve();
let lastLiveRequestAt = 0;

/**
 * Serializes uncached upstream HTTP so we stay under 10 req/min
 * (one in-flight live call, ≥6.2s between starts).
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
      FREE_PLAN_LIVE_INTERVAL_MS - (Date.now() - lastLiveRequestAt)
    );
    if (wait > 0) {
      console.log(`[api-football] rate-limit throttle ${wait}ms`);
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
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : undefined;
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
): Promise<ApiEnvelope<T>> {
  const [endpointPart, query = ""] = path.split("?");
  const endpoint = endpointPart.startsWith("/")
    ? endpointPart
    : `/${endpointPart}`;
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query).entries()) {
    params[k] = v;
  }

  const cacheKey = opts?.cacheKey ?? buildCacheKey(endpoint, params);

  try {
    if (!opts?.forceRefresh) {
      const cached = await getCachedPayload<ApiEnvelope<T>>(cacheKey);
      if (cached !== null) {
        console.log(`[CACHE HIT] Returning data for key=${cacheKey}`);
        return cached;
      }
    }

    return await runLiveRequest(() =>
      fetchWithCache<ApiEnvelope<T>>(
        endpoint,
        params,
        opts?.ttlMinutes ?? CACHE_TTL_MINUTES.TODAY_PENDING,
        {
          apiKey,
          cacheKey,
          forceRefresh: opts?.forceRefresh,
          resolveTtl: opts?.resolveTtl,
        }
      )
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
      throw new FootballApiError(API_AUTH_MESSAGE, "AUTH", 401);
    }
    if (status === 429) {
      throw new FootballApiError(API_RATE_LIMIT_MESSAGE, "API_ERROR", 429);
    }
    const detail =
      err instanceof Error && err.message ? err.message : "";
    throw new FootballApiError(
      detail.startsWith("API-Football HTTP")
        ? `Error al conectar con API-Football (${detail}).`
        : API_CONNECTION_ERROR_MESSAGE,
      "API_ERROR",
      502
    );
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

  if (!isAllowedCompetition(leagueId, item.league.name)) return false;

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
    leagueName: item.league.name,
    leagueId: String(item.league.id),
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
  toYmd: string
): Promise<ApiFixture[]> {
  const apiKey = resolveApiKey();
  const currentYear = new Date().getFullYear();
  try {
    const json = await apiGet<ApiFixture[]>(
      `/fixtures?team=${teamId}&from=${fromYmd}&to=${toYmd}&season=${currentYear}&timezone=${encodeURIComponent(CHILE_TIMEZONE)}`,
      apiKey,
      {
        ttlMinutes: CACHE_TTL_MINUTES.TODAY_PENDING,
        cacheKey: `fixtures_team_${teamId}_from_${fromYmd}_to_${toYmd}_season_${currentYear}`,
      }
    );
    if (hasApiErrors(json.errors)) {
      console.warn(
        `[api-football] team window ${teamId} ${fromYmd}→${toYmd} season=${currentYear} envelope errors — skipping cache/process:`,
        json.errors
      );
      return [];
    }
    return json.response ?? [];
  } catch (err) {
    if (err instanceof FootballApiError && err.code === "AUTH") throw err;
    console.warn(`[api-football] team window fetch failed team=${teamId}:`, err);
    return [];
  }
}

export async function fetchTeamFixturesWindow(
  teamId: number,
  fromYmd: string,
  toYmd: string
): Promise<NearbyTeamFixture[]> {
  const rows = await fetchTeamApiFixtures(teamId, fromYmd, toYmd);
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
  let teamCalls = 0;

  for (const team of getMonopolyTeams()) {
    const rows = await fetchTeamApiFixtures(team.teamId, fromScan, toScan);
    teamCalls += 1;
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

  console.log(
    `[api-football] monopoly week ${week.fromYmd}→${week.toYmd} candidates=${candidates.length} kept=${matches.length} teamCalls=${teamCalls}`
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

const UNAVAILABLE_NO_REAL_ODDS = "UNAVAILABLE_NO_REAL_ODDS";

function oddsCacheKey(fixtureId: number, page = 1): string {
  return `odds_fixture_${fixtureId}_p${page}`;
}

function ttlMinutesForOdds(kickoffIso: string): number | null {
  const ymd = chileCivilDateFromKickoff(kickoffIso);
  if (ymd && ymd < chileDateString()) return null;
  return CACHE_TTL_MINUTES.ODDS;
}

/** UEFA / Libertadores / Primera first so the 8-call batch is well spent. */
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
    slug === "serie-a" ||
    slug === "bundesliga" ||
    slug === "ligue-1"
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

async function readCachedFixtureOdds(
  fixtureId: number
): Promise<MatchOdds | null> {
  const cached = await getCachedPayload<OddsPageEnvelope>(
    oddsCacheKey(fixtureId, 1)
  );
  if (!cached) return null;
  return oddsFromEnvelope(cached);
}

async function fetchOddsForFixtureLive(
  fixtureId: number,
  apiKey: string,
  ttlMinutes: number | null
): Promise<MatchOdds | null> {
  let best: MatchOdds | null = null;
  let totalPages = 1;

  for (let page = 1; page <= FREE_PLAN_MAX_PAGE && page <= totalPages; page++) {
    const qs =
      page === 1
        ? `/odds?fixture=${fixtureId}`
        : `/odds?fixture=${fixtureId}&page=${page}`;
    const json = await apiGet<ApiOddsFixture[]>(qs, apiKey, {
      ttlMinutes,
      cacheKey: oddsCacheKey(fixtureId, page),
    });

    if (hasApiErrors(json.errors)) {
      if (isRateLimitEnvelope(json.errors)) {
        throw new FootballApiError(API_RATE_LIMIT_MESSAGE, "API_ERROR", 429);
      }
      if (page === 1) return null;
      break;
    }

    const envelope = json as OddsPageEnvelope;
    totalPages = Math.min(
      FREE_PLAN_MAX_PAGE,
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
    if (!isRateLimitError(err)) {
      console.warn(
        `[api-football] odds fetch failed fixture=${fixtureId}:`,
        err
      );
      return null;
    }
    console.warn(
      `[api-football] 429 on odds fixture=${fixtureId} — cooling down ${RATE_LIMIT_COOLDOWN_MS / 1000}s`
    );
    await delay(RATE_LIMIT_COOLDOWN_MS);
    try {
      return await fetchOddsForFixtureLive(fixtureId, apiKey, ttlMinutes);
    } catch (retryErr) {
      if (retryErr instanceof FootballApiError && retryErr.code === "AUTH") {
        throw retryErr;
      }
      if (isRateLimitError(retryErr)) throw retryErr;
      console.warn(
        `[api-football] odds retry failed fixture=${fixtureId}:`,
        retryErr
      );
      return null;
    }
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
    .sort((a, b) => b.priority - a.priority || a.id - b.id);

  const uncached: typeof jobs = [];

  for (const job of jobs) {
    const cached = await readCachedFixtureOdds(job.id);
    if (cached) {
      map.set(job.id, cached);
      continue;
    }
    uncached.push(job);
  }

  const batch = uncached.slice(0, ODDS_UNCACHED_BATCH_CAP);
  const skipped = uncached.length - batch.length;
  if (skipped > 0) {
    console.warn(
      `[api-football] odds live batch cap=${ODDS_UNCACHED_BATCH_CAP}; skipping ${skipped} uncached fixtures this cycle`
    );
  }

  console.log(
    `[api-football] odds cache hits=${map.size} live=${batch.length} skipped=${skipped}`
  );

  for (const job of batch) {
    try {
      const odds = await fetchOddsForFixture(job.id, apiKey, job.ttl);
      if (odds) map.set(job.id, odds);
    } catch (err) {
      if (err instanceof FootballApiError && err.code === "AUTH") throw err;
      if (isRateLimitError(err)) {
        console.warn(
          `[api-football] 429 persists — remaining uncached fixtures marked ${UNAVAILABLE_NO_REAL_ODDS}`
        );
        break;
      }
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
    if (!odds || !hasLiveOdds(odds)) {
      console.warn(
        `[api-football] ${UNAVAILABLE_NO_REAL_ODDS} ${match.home.name} vs ${match.away.name} (${match.id})`
      );
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
    const oddsByFixture = await fetchOddsForEliteFixtures(results, apiKey);
    results = attachOddsToMatches(results, oddsByFixture);
  }

  // Injuries / H2H / venue splits (cache-first; tiny live budget under Free plan)
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
  voided: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  homeName: string;
  awayName: string;
  date: string;
  elapsed: number | null;
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
