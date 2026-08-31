/**
 * CONCACAF regional origin gate (Champions Cup / Leagues Cup → MLS·Liga MX).
 * Usage: npx tsx scripts/verify-concacaf-origin.ts
 */
import {
  CONCACAF_ELIGIBLE_ORIGIN_LEAGUE_IDS,
  CONCACAF_REGIONAL_COMPETITION_IDS,
  bothTeamsInRoster,
  isConcacafRegionalCompetitionId,
} from "../config/allowed-leagues";
import { CONCACAF_NO_ELIGIBLE_MATCHUPS_MESSAGE } from "../lib/api-messages";

function assert(cond: unknown, msg = "assertion failed"): void {
  if (!cond) throw new Error(msg);
}

assert(
  [...CONCACAF_REGIONAL_COMPETITION_IDS].sort((a, b) => a - b).join() === "16,779",
  "CONCACAF regional ids"
);
assert(
  CONCACAF_ELIGIBLE_ORIGIN_LEAGUE_IDS.join() === "253,262",
  "origin leagues"
);
assert(isConcacafRegionalCompetitionId(16) && isConcacafRegionalCompetitionId(779));
assert(!isConcacafRegionalCompetitionId(253) && !isConcacafRegionalCompetitionId(262));

const eligible = new Set([1609, 2287]); // sample MLS / Liga MX team ids
assert(bothTeamsInRoster(1609, 2287, eligible), "MLS vs Liga MX → keep");
assert(bothTeamsInRoster(1609, 1609, eligible), "MLS vs MLS → keep");
assert(!bothTeamsInRoster(1609, 999, eligible), "one outsider → drop");
assert(!bothTeamsInRoster(998, 999, eligible), "both outsiders → drop");

assert(
  CONCACAF_NO_ELIGIBLE_MATCHUPS_MESSAGE.includes("MLS o Liga MX"),
  "UI empty copy"
);

console.log("verify-concacaf-origin: ok");
