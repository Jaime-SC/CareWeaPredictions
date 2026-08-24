/**
 * CONMEBOL origin gate (Libertadores / Sudamericana → CL/AR/BR 1ª).
 * Usage: npx tsx scripts/verify-conmebol-origin.ts
 */
import {
  CONMEBOL_COMPETITION_IDS,
  CONMEBOL_ELIGIBLE_ORIGIN_LEAGUE_IDS,
  bothTeamsInRoster,
  isConmebolCompetitionId,
} from "../config/allowed-leagues";
import { CONMEBOL_NO_ELIGIBLE_MATCHUPS_MESSAGE } from "../lib/api-messages";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(
  [...CONMEBOL_COMPETITION_IDS].sort((a, b) => a - b).join() === "11,13",
  "CONMEBOL ids"
);
assert(
  CONMEBOL_ELIGIBLE_ORIGIN_LEAGUE_IDS.join() === "265,128,71",
  "origin leagues"
);
assert(isConmebolCompetitionId(13) && isConmebolCompetitionId(11));
assert(!isConmebolCompetitionId(71) && !isConmebolCompetitionId(2));

const eligible = new Set([229, 435, 131]); // Colo-Colo / River / Flamengo sample
assert(bothTeamsInRoster(229, 435, eligible), "CL vs AR → keep");
assert(bothTeamsInRoster(435, 131, eligible), "AR vs BR → keep");
assert(!bothTeamsInRoster(229, 999, eligible), "one outsider → drop");
assert(!bothTeamsInRoster(998, 999, eligible), "both outsiders → drop");

assert(
  CONMEBOL_NO_ELIGIBLE_MATCHUPS_MESSAGE.includes("Chile, Argentina o Brasil"),
  "UI empty copy"
);

console.log("verify-conmebol-origin: ok");
