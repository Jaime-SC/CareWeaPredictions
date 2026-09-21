/**
 * UEFA Top 5 1ª origin gate (ENG/ESP/ITA/GER/FRA).
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

assert(
  EUROPE_BIG5_LEAGUE_IDS.join() === "39,140,135,78,61",
  "UEFA origin ids (Top 5 1ª)"
);
assert(
  [...UEFA_COMPETITION_IDS].sort((a, b) => a - b).join() === "2,3,848",
  "UEFA ids"
);
assert(isUefaCompetitionId(2) && isUefaCompetitionId(3) && isUefaCompetitionId(848));
assert(!isUefaCompetitionId(39) && !isUefaCompetitionId(13));

const top5 = new Set([50, 541, 489, 157, 85]); // PL / Barça / Inter / Bayern / PSG sample
assert(bothTeamsFromEuropeBig5(50, 157, top5), "PL vs Bayern → keep");
assert(bothTeamsFromEuropeBig5(50, 85, top5), "PL vs PSG → keep");
assert(!bothTeamsFromEuropeBig5(50, 999, top5), "outsider → drop");
assert(!bothTeamsFromEuropeBig5(50, undefined, top5), "missing id → drop");
assert(!bothTeamsFromEuropeBig5(50, 541, new Set()), "empty roster → drop");

assert(
  UEFA_NO_BIG5_MATCHUPS_MESSAGE.includes("Alemania") &&
    UEFA_NO_BIG5_MATCHUPS_MESSAGE.includes("Francia"),
  "UI empty copy mentions GER/FRA"
);

console.log("verify-uefa-big5: ok");
