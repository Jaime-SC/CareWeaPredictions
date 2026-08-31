/**
 * UEFA ENG/ESP/ITA 1ª origin gate.
 * Usage: npx tsx scripts/verify-uefa-big5.ts
 */
import {
  EUROPE_BIG5_LEAGUE_IDS,
  UEFA_COMPETITION_IDS,
  bothTeamsFromEuropeBig5,
  isUefaCompetitionId,
} from "../config/allowed-leagues";
import { UEFA_NO_BIG5_MATCHUPS_MESSAGE } from "../lib/api-messages";

function assert(cond: unknown, msg = "assertion failed"): void {
  if (!cond) throw new Error(msg);
}

assert(EUROPE_BIG5_LEAGUE_IDS.join() === "39,140,135", "UEFA origin ids");
assert(
  [...UEFA_COMPETITION_IDS].sort((a, b) => a - b).join() === "2,3,848",
  "UEFA ids"
);
assert(isUefaCompetitionId(2) && isUefaCompetitionId(3) && isUefaCompetitionId(848));
assert(!isUefaCompetitionId(39) && !isUefaCompetitionId(13));

const top3 = new Set([50, 541, 489]); // PL / Barça / Inter sample
assert(bothTeamsFromEuropeBig5(50, 541, top3), "both top3 → keep");
assert(!bothTeamsFromEuropeBig5(50, 157, top3), "Bayern outsider → drop");
assert(!bothTeamsFromEuropeBig5(50, undefined, top3), "missing id → drop");
assert(!bothTeamsFromEuropeBig5(50, 541, new Set()), "empty roster → drop");

assert(
  UEFA_NO_BIG5_MATCHUPS_MESSAGE.includes("Inglaterra, España o Italia"),
  "UI empty copy"
);

console.log("verify-uefa-big5: ok");
