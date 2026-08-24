/**
 * European national cup origin gate (FA / EFL / Copa del Rey / Coppa Italia).
 * Usage: npx tsx scripts/verify-europe-cup-origin.ts
 */
import {
  EUROPE_NATIONAL_CUP_IDS,
  EUROPE_NATIONAL_CUP_ORIGINS,
  bothTeamsInRoster,
  europeCupOriginLeagueIds,
  isEuropeNationalCupId,
} from "../config/allowed-leagues";
import { EUROPE_CUP_NO_TOP2_MATCHUPS_MESSAGE } from "../lib/api-messages";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(
  [...EUROPE_NATIONAL_CUP_IDS].sort((a, b) => a - b).join() ===
    "45,48,137,143",
  "cup ids"
);
assert(europeCupOriginLeagueIds(45)?.join() === "39,40", "FA Cup origins");
assert(europeCupOriginLeagueIds(48)?.join() === "39,40", "EFL Cup origins");
assert(europeCupOriginLeagueIds(143)?.join() === "140,141", "CdR origins");
assert(europeCupOriginLeagueIds(137)?.join() === "135,136", "Coppa origins");
assert(
  isEuropeNationalCupId(45) &&
    isEuropeNationalCupId(48) &&
    isEuropeNationalCupId(143) &&
    isEuropeNationalCupId(137)
);
assert(!isEuropeNationalCupId(39) && !isEuropeNationalCupId(2));
assert(
  Object.keys(EUROPE_NATIONAL_CUP_ORIGINS).length === 4,
  "exactly 4 gated cups"
);

const pl = new Set([33, 40]); // sample Premier / Championship clubs
assert(bothTeamsInRoster(33, 40, pl), "both top2 → keep");
assert(!bothTeamsInRoster(33, 999, pl), "one lower → drop");
assert(!bothTeamsInRoster(998, 999, pl), "both lower → drop");
assert(!bothTeamsInRoster(33, undefined, pl), "missing → drop");

assert(
  EUROPE_CUP_NO_TOP2_MATCHUPS_MESSAGE.includes("1ª y 2ª División"),
  "UI empty copy"
);

console.log("verify-europe-cup-origin: ok");
