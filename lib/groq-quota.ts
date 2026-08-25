/**
 * Local Groq AI Judge daily call counter.
 * Groq does not expose used/remaining like API-Football headers —
 * we count chat.completions calls made by this app (Chile civil day).
 */
import { prisma } from "./db";
import { getCachedPayload, upsertCachedPayload } from "./api-cache";
import { chileDateString } from "./utils";

/** Free-tier style RPD default; override with GROQ_DAILY_LIMIT. */
export const GROQ_DAILY_LIMIT_DEFAULT = 14_400;
/** Soft buffer so we stop before hard provider 429. */
export const GROQ_SOFT_BUFFER = 5;
/** In-memory pause after RPM / transient 429 (~30 RPM free tier). */
export const GROQ_RATE_LIMIT_COOLDOWN_MS = 60_000;

export type GroqQuotaSnapshot = {
  date: string;
  used: number;
  limit: number;
  remaining: number;
  configured: boolean;
};

type GroqQuotaPayload = {
  used: number;
  limit: number;
  exhausted?: boolean;
};

/** Process-local cool-down until epoch ms. */
let rateLimitCoolUntil = 0;

function quotaCacheId(date: string): string {
  return `groq_quota_${date}`;
}

export function resolveGroqDailyLimit(): number {
  const raw = process.env.GROQ_DAILY_LIMIT?.trim();
  const n = raw ? Number(raw) : GROQ_DAILY_LIMIT_DEFAULT;
  if (!Number.isFinite(n) || n <= 0) return GROQ_DAILY_LIMIT_DEFAULT;
  return Math.floor(n);
}

/** Soft spend ceiling (e.g. 14395 when limit is 14400). */
export function resolveGroqSoftCallLimit(): number {
  return Math.max(1, resolveGroqDailyLimit() - GROQ_SOFT_BUFFER);
}

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function isGroqRateLimited(now = Date.now()): boolean {
  return rateLimitCoolUntil > now;
}

export function remainingGroqRateLimitMs(now = Date.now()): number {
  return Math.max(0, rateLimitCoolUntil - now);
}

export function markGroqRateLimitCooldown(
  ms: number = GROQ_RATE_LIMIT_COOLDOWN_MS
): void {
  const until = Date.now() + Math.max(0, ms);
  if (until > rateLimitCoolUntil) rateLimitCoolUntil = until;
  console.warn(`[groq-quota] rate-limit cool-down ${Math.ceil(ms / 1000)}s`);
}

export async function getGroqQuota(
  date = chileDateString()
): Promise<GroqQuotaSnapshot> {
  const limit = resolveGroqDailyLimit();
  const configured = isGroqConfigured();
  try {
    const cached = await getCachedPayload<GroqQuotaPayload>(
      quotaCacheId(date)
    );
    if (cached && typeof cached.used === "number") {
      const used = Math.max(0, Math.floor(cached.used));
      const lim =
        typeof cached.limit === "number" && cached.limit > 0
          ? Math.floor(cached.limit)
          : limit;
      const remaining = cached.exhausted
        ? 0
        : Math.max(0, lim - used);
      return {
        date,
        used: Math.min(used, lim),
        limit: lim,
        remaining,
        configured,
      };
    }
  } catch (err) {
    console.warn("[groq-quota] get failed:", err);
  }
  return {
    date,
    used: 0,
    limit,
    remaining: limit,
    configured,
  };
}

export async function canSpendGroqCall(
  date = chileDateString()
): Promise<boolean> {
  if (!isGroqConfigured()) return false;
  if (isGroqRateLimited()) return false;
  const q = await getGroqQuota(date);
  if (q.remaining <= 0) return false;
  return q.used < resolveGroqSoftCallLimit();
}

export async function recordGroqCall(
  date = chileDateString()
): Promise<GroqQuotaSnapshot> {
  const limit = resolveGroqDailyLimit();
  const configured = isGroqConfigured();
  try {
    const id = quotaCacheId(date);
    const prev = await getCachedPayload<GroqQuotaPayload>(id);
    const used = Math.max(0, Math.floor(prev?.used ?? 0)) + 1;
    const exhausted = Boolean(prev?.exhausted);
    const payload: GroqQuotaPayload = { used, limit, exhausted };
    await upsertCachedPayload(id, "groq/quota", payload, null);
    return {
      date,
      used: Math.min(used, limit),
      limit,
      remaining: exhausted ? 0 : Math.max(0, limit - used),
      configured,
    };
  } catch (err) {
    console.warn("[groq-quota] record failed:", err);
    return getGroqQuota(date);
  }
}

export async function markGroqQuotaExhausted(
  date = chileDateString()
): Promise<GroqQuotaSnapshot> {
  const limit = resolveGroqDailyLimit();
  const configured = isGroqConfigured();
  try {
    const id = quotaCacheId(date);
    const prev = await getCachedPayload<GroqQuotaPayload>(id);
    const used = Math.max(limit, Math.floor(prev?.used ?? 0));
    const payload: GroqQuotaPayload = { used, limit, exhausted: true };
    await upsertCachedPayload(id, "groq/quota", payload, null);
    return { date, used, limit, remaining: 0, configured };
  } catch (err) {
    console.warn("[groq-quota] mark exhausted failed:", err);
    return { date, used: limit, limit, remaining: 0, configured };
  }
}

export function isGroqQuotaError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: number }).status)
      : NaN;
  return (
    status === 429 ||
    msg.includes("429") ||
    msg.includes("rate_limit") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("quota")
  );
}

export function isGroqDailyQuotaError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("daily") ||
    msg.includes("per day") ||
    msg.includes("rpd") ||
    (msg.includes("quota") && msg.includes("exceeded"))
  );
}

export async function resetGroqQuotaForDate(
  date = chileDateString()
): Promise<void> {
  try {
    await prisma.cachedApiResponse.delete({
      where: { id: quotaCacheId(date) },
    });
  } catch {
    /* ignore missing */
  }
}
