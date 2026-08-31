/**
 * SA national cup origin gate (Copa AR / BR / CL).
 * Usage: npx tsx scripts/verify-sa-cup-origin.ts
 */
import {
  SA_NATIONAL_CUP_IDS,
  SA_NATIONAL_CUP_ORIGINS,
  bothTeamsInRoster,
  isSaNationalCupId,
  saCupOriginLeagueIds,
} from "../config/allowed-leagues";
import { SA_CUP_NO_TOP2_MATCHUPS_MESSAGE } from "../lib/api-messages";

function assert(cond: unknown, msg = "assertion failed"): void {
  if (!cond) throw new Error(msg);
}

assert(
  [...SA_NATIONAL_CUP_IDS].sort((a, b) => a - b).join() === "73,130,266",
  "cup ids"
);
assert(saCupOriginLeagueIds(73)?.join() === "71,72", "BR origins");
assert(saCupOriginLeagueIds(130)?.join() === "128,129", "AR origins");
assert(saCupOriginLeagueIds(266)?.join() === "265,267", "CL origins");
assert(isSaNationalCupId(73) && isSaNationalCupId(130) && isSaNationalCupId(266));
assert(!isSaNationalCupId(71) && !isSaNationalCupId(13));
assert(
  Object.keys(SA_NATIONAL_CUP_ORIGINS).length === 3,
  "exactly 3 gated cups"
);

const ar = new Set([435, 436]); // sample Liga Profesional / Nacional
assert(bothTeamsInRoster(435, 436, ar), "both top2 → keep");
assert(!bothTeamsInRoster(435, 999, ar), "one lower → drop");
assert(!bothTeamsInRoster(998, 999, ar), "both lower → drop");
assert(!bothTeamsInRoster(435, undefined, ar), "missing → drop");

assert(
  SA_CUP_NO_TOP2_MATCHUPS_MESSAGE.includes("Primera y Segunda"),
  "UI empty copy"
);

console.log("verify-sa-cup-origin: ok");
