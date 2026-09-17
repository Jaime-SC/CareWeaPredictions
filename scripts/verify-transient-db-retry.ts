/**
 * Smoke: transient Neon/network error detection used by loadTeamIdMaps retry.
 * Usage: npx tsx scripts/verify-transient-db-retry.ts
 */
import { isTransientDbError } from "../lib/team-profiler";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const reset = new Error("terminated", {
  cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
});
assert(isTransientDbError(reset), "ECONNRESET cause");
assert(isTransientDbError(new Error("fetch failed")), "fetch failed");
assert(!isTransientDbError(new Error("P2025 Record not found")), "not P2025");

console.log("OK verify-transient-db-retry");
