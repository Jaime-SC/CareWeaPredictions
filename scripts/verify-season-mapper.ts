/**
 * Dynamic season mapper (Europe split vs SA annual).
 * Usage: npx tsx scripts/verify-season-mapper.ts
 */
import {
  blendSeasonStat,
  earlySeasonCurrentWeight,
  getTargetSeason,
  seasonFallbackCandidates,
} from "../lib/utils/season-mapper";
import { needsPreviousSeasonBlend } from "../lib/context-engine";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// SA annual — always calendar year
assert(getTargetSeason(71, new Date(2026, 7, 15)) === 2026, "BR Aug → 2026");
assert(getTargetSeason(128, new Date(2026, 2, 1)) === 2026, "AR Mar → 2026");
assert(getTargetSeason(265, new Date(2027, 0, 10)) === 2027, "CL Jan → 2027");

// Europe split — Aug+ = year, Jan–Jul = year-1
assert(getTargetSeason(39, new Date(2026, 7, 1)) === 2026, "PL Aug → 2026");
assert(getTargetSeason(39, new Date(2027, 4, 15)) === 2026, "PL May → 2026");
assert(getTargetSeason(2, new Date(2026, 6, 31)) === 2025, "UCL Jul → 2025");
assert(getTargetSeason(140, new Date(2026, 7, 20)) === 2026, "LaLiga Aug → 2026");

assert(
  seasonFallbackCandidates(39, new Date(2026, 8, 1)).join() === "2026,2025",
  "PL candidates"
);
assert(
  seasonFallbackCandidates(71, new Date(2026, 3, 1)).join() === "2026,2025",
  "BR candidates"
);

assert(earlySeasonCurrentWeight(0) === 0);
assert(earlySeasonCurrentWeight(2) === 0.4);
assert(earlySeasonCurrentWeight(5) === 1);
assert(needsPreviousSeasonBlend(4));
assert(!needsPreviousSeasonBlend(5));

assert(
  Math.abs(blendSeasonStat(1.5, 1.0, 2) - (1.5 * 0.4 + 1.0 * 0.6)) < 1e-9,
  "blend"
);

console.log("verify-season-mapper: ok");
