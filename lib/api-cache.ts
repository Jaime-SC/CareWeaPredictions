import { prisma } from "./db";
import { env } from "./env";
import { chileDateString } from "./utils";

/** Far-future sentinel used for finished/permanent cache entries. */
export const PERMANENT_EXPIRES_AT = new Date("9999-12-31T23:59:59.000Z");

export const CACHE_TTL_MINUTES = {
  /** Future / upcoming fixture lists */
  FUTURE: 720,
  /** Today's still-pending fixtures */
  TODAY_PENDING: 30,
  /** Elite team roster / slow-changing lookups */
  ROSTER: 720,
  /** Account status ping */
  STATUS: 5,
  /** Per-fixture bookmaker odds (6–12h; 12h keeps parlay regen on CACHE HIT) */
  ODDS: 720,
  /** ESPN team injuries / news */
  ESPN: 720,
  /** The Odds API fill-gaps (per sport/region snapshot) */
  ODDS_API: 360,
  /** Open-Meteo matchday forecast */
  WEATHER: 1440,
  /** Football-Data.org historical results */
  FOOTBALL_DATA: 1440,
} as const;

/** Free-plan style daily budget shown in the UI. */
export const API_DAILY_QUOTA_LIMIT = Number(
  env.API_FOOTBALL_DAILY_LIMIT ?? 100
);

/** API-Football free plans reject Page > 3. */
export const FREE_PLAN_MAX_PAGE = 3;

export type FetchWithCacheOptions<T> = {
  apiKey?: string;
  forceRefresh?: boolean;
  /** Override auto-generated cache key */
  cacheKey?: string;
  /** Adjust TTL after inspecting the live payload (e.g. all FT → permanent) */
  resolveTtl?: (data: T) => number | null;
  /** Extra fetch init (defaults to no Next data-cache for live quota control) */
  fetchInit?: RequestInit;
};

function sanitizeKeyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Build a stable cache id from endpoint + params.
 * Example: fixtures + {date:2026-08-12} → fixtures_date_2026-08-12
 */
export function buildCacheKey(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined | null> = {}
): string {
  const ep = sanitizeKeyPart(endpoint.replace(/^\//, "")) || "root";
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${sanitizeKeyPart(k)}_${sanitizeKeyPart(String(v))}`);

  const key = [ep, ...parts].filter(Boolean).join("_");
  return key.slice(0, 191);
}

export function expiresAtFromTtl(ttlMinutes: number | null): Date {
  if (ttlMinutes === null || !Number.isFinite(ttlMinutes)) {
    return PERMANENT_EXPIRES_AT;
  }
  return new Date(Date.now() + Math.max(0, ttlMinutes) * 60_000);
}

/** TTL for a fixtures?date=YYYY-MM-DD list relative to Chile "today". */
export function ttlMinutesForFixtureDate(dateYmd: string): number | null {
  const today = chileDateString();
  if (dateYmd > today) return CACHE_TTL_MINUTES.FUTURE;
  if (dateYmd === today) return CACHE_TTL_MINUTES.TODAY_PENDING;
  // Past civil dates: finished cards → permanent
  return null;
}

function expiresAtMs(
  value: Date | string | number | null | undefined
): number | null {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export async function getCachedPayload<T>(cacheKey: string): Promise<T | null> {
  try {
    const row = await prisma.cachedApiResponse.findUnique({
      where: { id: cacheKey },
    });
    if (!row) return null;
    const exp = expiresAtMs(row.expiresAt);
    if (exp == null || exp <= Date.now()) return null;
    return JSON.parse(row.payload) as T;
  } catch (err) {
    console.warn(`[api-cache] Failed reading key=${cacheKey}:`, err);
    return null;
  }
}

/** Return cached JSON even if TTL expired (429 / offline fallback). */
export async function getCachedPayloadAllowStale<T>(
  cacheKey: string
): Promise<T | null> {
  try {
    const row = await prisma.cachedApiResponse.findUnique({
      where: { id: cacheKey },
    });
    if (!row) return null;
    return JSON.parse(row.payload) as T;
  } catch (err) {
    console.warn(`[api-cache] Failed stale read key=${cacheKey}:`, err);
    return null;
  }
}

export async function upsertCachedPayload(
  cacheKey: string,
  endpoint: string,
  payload: unknown,
  ttlMinutes: number | null
): Promise<void> {
  const expiresAt = expiresAtFromTtl(ttlMinutes);
  const body = JSON.stringify(payload);
  try {
    // ponytail: Neon HTTP rejects Prisma.upsert (implicit transaction).
    const existing = await prisma.cachedApiResponse.findUnique({
      where: { id: cacheKey },
    });
    if (existing) {
      await prisma.cachedApiResponse.update({
        where: { id: cacheKey },
        data: { endpoint, payload: body, expiresAt },
      });
      return;
    }
    try {
      await prisma.cachedApiResponse.create({
        data: { id: cacheKey, endpoint, payload: body, expiresAt },
      });
    } catch {
      await prisma.cachedApiResponse.update({
        where: { id: cacheKey },
        data: { endpoint, payload: body, expiresAt },
      });
    }
  } catch (err) {
    console.warn(`[api-cache] Failed upsert key=${cacheKey}:`, err);
  }
}

export type ApiQuotaSnapshot = {
  date: string;
  used: number;
  limit: number;
  remaining: number;
};

/** Parse official daily quota headers from an API-Football response. */
export function parseApiFootballQuotaHeaders(headers: Headers): {
  limit: number;
  remaining: number;
  used: number;
} | null {
  const limitRaw = headers.get("x-ratelimit-requests-limit");
  const remainingRaw = headers.get("x-ratelimit-requests-remaining");
  if (limitRaw == null && remainingRaw == null) return null;

  const limit = Number.parseInt(limitRaw || String(API_DAILY_QUOTA_LIMIT), 10);
  const remaining = Number.parseInt(remainingRaw || "0", 10);
  if (!Number.isFinite(limit) || limit < 0) return null;
  if (!Number.isFinite(remaining) || remaining < 0) return null;

  return {
    limit,
    remaining,
    used: Math.max(0, limit - remaining),
  };
}

/**
 * Persist official quota from response headers (replaces local ++ counters).
 */
export async function syncApiQuotaFromHeaders(
  headers: Headers,
  date = chileDateString()
): Promise<ApiQuotaSnapshot | null> {
  const parsed = parseApiFootballQuotaHeaders(headers);
  if (!parsed) {
    return null;
  }

  try {
    // ponytail: Neon HTTP rejects Prisma.upsert (implicit transaction).
    const data = {
      callCount: parsed.used,
      limit: parsed.limit,
      remaining: parsed.remaining,
      fromHeaders: true,
    };
    const existing = await prisma.apiQuotaDaily.findUnique({ where: { date } });
    const row = existing
      ? await prisma.apiQuotaDaily.update({ where: { date }, data })
      : await prisma.apiQuotaDaily.create({ data: { date, ...data } }).catch(
          async () => prisma.apiQuotaDaily.update({ where: { date }, data })
        );
    return {
      date: row.date,
      used: row.callCount,
      limit: row.limit,
      remaining: row.remaining,
    };
  } catch (err) {
    console.warn("[api-cache] Failed to sync quota from headers:", err);
    return null;
  }
}

export async function getApiQuota(
  date = chileDateString()
): Promise<ApiQuotaSnapshot & { fromHeaders: boolean }> {
  try {
    const row = await prisma.apiQuotaDaily.findUnique({ where: { date } });
    if (!row) {
      return {
        date,
        used: 0,
        limit: API_DAILY_QUOTA_LIMIT,
        remaining: API_DAILY_QUOTA_LIMIT,
        fromHeaders: false,
      };
    }
    const limit = row.limit > 0 ? row.limit : API_DAILY_QUOTA_LIMIT;
    // Never invent metrics from the old local ++ counter
    if (!row.fromHeaders) {
      return {
        date: row.date,
        used: 0,
        limit,
        remaining: limit,
        fromHeaders: false,
      };
    }
    return {
      date: row.date,
      used: row.callCount,
      limit,
      remaining: row.remaining,
      fromHeaders: true,
    };
  } catch (err) {
    console.warn("[api-cache] Failed to read quota:", err);
    return {
      date,
      used: 0,
      limit: API_DAILY_QUOTA_LIMIT,
      remaining: API_DAILY_QUOTA_LIMIT,
      fromHeaders: false,
    };
  }
}

const BASE_URL = "https://v3.football.api-sports.io";

/**
 * Central API-Football request wrapper:
 * 1) SQLite cache lookup
 * 2) Live HTTP only on miss/expiry
 * 3) Sync official quota from x-ratelimit-requests-* headers
 * 4) Upsert payload into SQLite cache
 */
export async function fetchWithCache<T>(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
  ttlMinutes: number | null = CACHE_TTL_MINUTES.TODAY_PENDING,
  options: FetchWithCacheOptions<T> = {}
): Promise<T> {
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;
  const cacheKey =
    options.cacheKey ?? buildCacheKey(normalizedEndpoint, params);

  const pageParam = params.page;
  const pageNum =
    pageParam === undefined || pageParam === null || pageParam === ""
      ? null
      : Number(pageParam);
  if (
    pageNum != null &&
    Number.isFinite(pageNum) &&
    pageNum > FREE_PLAN_MAX_PAGE
  ) {
    console.warn(
      `[api-cache] blocked page=${pageNum} (free-plan cap ${FREE_PLAN_MAX_PAGE}) key=${cacheKey}`
    );
    return { response: [], paging: { current: pageNum, total: FREE_PLAN_MAX_PAGE } } as T;
  }

  if (!options.forceRefresh) {
    const hit = await getCachedPayload<T>(cacheKey);
    if (hit !== null) {
      return hit;
    }
  }

  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new Error("API key requerida para fetchWithCache");
  }

  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  const qs = search.toString();
  const url = `${BASE_URL}${normalizedEndpoint}${qs ? `?${qs}` : ""}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options.fetchInit,
      headers: {
        "x-apisports-key": apiKey,
        ...(options.fetchInit?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (err) {
    throw err;
  }

  // Official dashboard metrics — only on HTTP 200 with real quota headers
  if (res.status === 200 && parseApiFootballQuotaHeaders(res.headers)) {
    await syncApiQuotaFromHeaders(res.headers);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(
      `API-Football HTTP ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`
    ) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  const data = (await res.json()) as T;

  const envelopeErrors =
    data &&
    typeof data === "object" &&
    "errors" in data &&
    (data as { errors?: unknown }).errors;
  const hasEnvelopeErrors = Array.isArray(envelopeErrors)
    ? envelopeErrors.length > 0
    : Boolean(
        envelopeErrors &&
          typeof envelopeErrors === "object" &&
          Object.keys(envelopeErrors as object).length > 0
      );

  if (hasEnvelopeErrors) {
    console.warn(
      `[api-football] envelope errors key=${cacheKey}:`,
      envelopeErrors
    );
    return data;
  }

  const effectiveTtl =
    options.resolveTtl !== undefined ? options.resolveTtl(data) : ttlMinutes;

  await upsertCachedPayload(
    cacheKey,
    normalizedEndpoint,
    data,
    effectiveTtl
  );

  return data;
}

/** Bump to force another one-shot wipe of bulk date caches. */
export const STALE_CACHE_PURGE_MARKER = "cache_purge_odds_fixture_v1";

export async function purgeStaleOddsAndFixtureCache(): Promise<{
  deleted: number;
  skipped: boolean;
}> {
  try {
    const marker = await prisma.cachedApiResponse.findUnique({
      where: { id: STALE_CACHE_PURGE_MARKER },
    });
    if (marker) {
      return { deleted: 0, skipped: true };
    }

    const result = await prisma.cachedApiResponse.deleteMany({
      where: {
        OR: [
          { id: { startsWith: "fixtures_date_" } },
          { id: { startsWith: "odds_date_" } },
        ],
      },
    });

    await prisma.cachedApiResponse.create({
      data: {
        id: STALE_CACHE_PURGE_MARKER,
        endpoint: "cache/purge",
        payload: JSON.stringify({
          purgedAt: new Date().toISOString(),
          deleted: result.count,
        }),
        expiresAt: PERMANENT_EXPIRES_AT,
      },
    });

    return { deleted: result.count, skipped: false };
  } catch (err) {
    console.warn("[api-cache] stale cache purge failed:", err);
    return { deleted: 0, skipped: false };
  }
}
