/**
 * Smoke: paid-plan API-Football caps (no live HTTP).
 * Usage: npx tsx scripts/verify-api-football-paid-caps.ts
 */
import {
  LIVE_REQUEST_INTERVAL_MS,
  MAX_API_PAGE,
  RATE_LIMIT_RETRY_MS,
  sanitizeApiParams,
} from "../lib/api-football";
import { API_DAILY_QUOTA_LIMIT } from "../lib/api-cache";
import { API_RATE_LIMIT_COOLDOWN_MS } from "../lib/api-rate-limit-cooldown";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(LIVE_REQUEST_INTERVAL_MS === 200, `live interval ${LIVE_REQUEST_INTERVAL_MS}`);
assert(RATE_LIMIT_RETRY_MS === 2000, `429 retry ${RATE_LIMIT_RETRY_MS}`);
assert(MAX_API_PAGE === 20, `max page ${MAX_API_PAGE}`);
assert(MAX_API_PAGE > 3, "max page above free cap");
assert(API_DAILY_QUOTA_LIMIT >= 7500 || process.env.API_FOOTBALL_DAILY_LIMIT, "daily quota default");
assert(API_RATE_LIMIT_COOLDOWN_MS === 15_000, `ui cooldown ${API_RATE_LIMIT_COOLDOWN_MS}`);

const h2h = sanitizeApiParams("/fixtures/headtohead", {
  h2h: "33-34",
  last: "10",
});
assert(h2h.last === "10", "H2H last preserved");

console.log(
  JSON.stringify({
    ok: true,
    LIVE_REQUEST_INTERVAL_MS,
    RATE_LIMIT_RETRY_MS,
    MAX_API_PAGE,
    API_DAILY_QUOTA_LIMIT,
    h2hLast: h2h.last,
  })
);
