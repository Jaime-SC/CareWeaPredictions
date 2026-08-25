/**
 * Smoke: Groq quota counter helpers (no live Groq call).
 * Usage: npx tsx scripts/verify-groq-quota.ts
 */
import {
  GROQ_DAILY_LIMIT_DEFAULT,
  isGroqQuotaError,
  resolveGroqDailyLimit,
  resolveGroqSoftCallLimit,
} from "../lib/groq-quota";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(GROQ_DAILY_LIMIT_DEFAULT === 14_400, "default 14400");
assert(resolveGroqDailyLimit() >= 1, "limit positive");
assert(
  resolveGroqSoftCallLimit() === Math.max(1, resolveGroqDailyLimit() - 5),
  "soft = hard - 5"
);

assert(
  isGroqQuotaError(
    new Error("[429 Too Many Requests] Rate limit exceeded")
  ),
  "429 quota"
);
assert(!isGroqQuotaError(new Error("network timeout")), "not quota");

console.log(
  JSON.stringify({
    ok: true,
    defaultLimit: GROQ_DAILY_LIMIT_DEFAULT,
    resolved: resolveGroqDailyLimit(),
    soft: resolveGroqSoftCallLimit(),
  })
);
