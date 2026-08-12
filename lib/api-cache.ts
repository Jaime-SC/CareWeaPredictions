import { prisma } from "./db";
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
} as const;

/** Free-plan style daily budget shown in the UI. */
export const API_DAILY_QUOTA_LIMIT = Number(
  process.env.API_FOOTBALL_DAILY_LIMIT ?? 100
);

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
 * Build a stable SQLite cache id from endpoint + params.
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

export function isPermanentExpiry(expiresAt: Date): boolean {
  return expiresAt.getTime() >= PERMANENT_EXPIRES_AT.getTime() - 86_400_000;
}

export async function getCachedPayload<T>(cacheKey: string): Promise<T | null> {
  try {
    const row = await prisma.cachedApiResponse.findUnique({
      where: { id: cacheKey },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return JSON.parse(row.payload) as T;
  } catch (err) {
    console.warn(`[api-cache] Failed reading key=${cacheKey}:`, err);
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
    await prisma.cachedApiResponse.upsert({
      where: { id: cacheKey },
      create: {
        id: cacheKey,
        endpoint,
        payload: body,
        expiresAt,
      },
      update: {
        endpoint,
        payload: body,
        expiresAt,
      },
    });
  } catch (err) {
    console.warn(`[api-cache] Failed upsert key=${cacheKey}:`, err);
  }
}

export async function incrementApiQuota(date = chileDateString()): Promise<number> {
  try {
    const row = await prisma.apiQuotaDaily.upsert({
      where: { date },
      create: { date, callCount: 1 },
      update: { callCount: { increment: 1 } },
    });
    return row.callCount;
  } catch (err) {
    console.warn("[api-cache] Failed to increment quota:", err);
    return -1;
  }
}

export async function getApiQuota(date = chileDateString()): Promise<{
  date: string;
  used: number;
  limit: number;
  remaining: number;
}> {
  try {
    const row = await prisma.apiQuotaDaily.findUnique({ where: { date } });
    const used = row?.callCount ?? 0;
    return {
      date,
      used,
      limit: API_DAILY_QUOTA_LIMIT,
      remaining: Math.max(0, API_DAILY_QUOTA_LIMIT - used),
    };
  } catch (err) {
    console.warn("[api-cache] Failed to read quota:", err);
    return {
      date,
      used: 0,
      limit: API_DAILY_QUOTA_LIMIT,
      remaining: API_DAILY_QUOTA_LIMIT,
    };
  }
}

const BASE_URL = "https://v3.football.api-sports.io";

/**
 * Central API-Football request wrapper:
 * 1) SQLite cache lookup
 * 2) Live HTTP only on miss/expiry
 * 3) Upsert payload + increment daily quota counter
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

  if (!options.forceRefresh) {
    const hit = await getCachedPayload<T>(cacheKey);
    if (hit !== null) {
      console.log(`[CACHE HIT] Returning data for key=${cacheKey}`);
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

  // Count ONLY live upstream calls (never cache hits), including error statuses
  const used = await incrementApiQuota();
  console.log(
    `[CACHE MISS] Fetched key=${cacheKey} status=${res.status} · quota today=${used}/${API_DAILY_QUOTA_LIMIT}`
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(
      `API-Football HTTP ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`
    ) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  const data = (await res.json()) as T;

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
