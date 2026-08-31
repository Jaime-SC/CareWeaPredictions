/**
 * Competition category display labels.
 * Usage: npx tsx scripts/verify-league-labels.ts
 */
import {
  REGION_DISPLAY_LABELS,
  competitionCategoryLabel,
  resolveLeagueRegion,
  restrictedCompetitionBadge,
} from "../config/allowed-leagues";

function assert(cond: unknown, msg = "assertion failed"): void {
  if (!cond) throw new Error(msg);
}

assert(
  REGION_DISPLAY_LABELS["south-america-eligible-divisions"] ===
    "Sudamérica (1ª y 2ª División)",
  "SA label"
);
assert(
  REGION_DISPLAY_LABELS.uefa === "UEFA (Filtro 1ª ENG·ESP·ITA)",
  "UEFA label"
);
assert(
  REGION_DISPLAY_LABELS.conmebol === "CONMEBOL (Clubes Elegibles)",
  "CONMEBOL label"
);
assert(
  REGION_DISPLAY_LABELS["europe-top3-and-2nd"] === "Europa (1ª y 2ª División)",
  "Europe label"
);
assert(!("europe-top5" in REGION_DISPLAY_LABELS), "old europe key gone");
assert(!("south-america-top5" in REGION_DISPLAY_LABELS), "old SA key gone");

assert(resolveLeagueRegion(71) === "south-america-eligible-divisions");
assert(resolveLeagueRegion(2) === "uefa");
assert(resolveLeagueRegion(13) === "conmebol");
assert(resolveLeagueRegion(39) === "europe-top3-and-2nd");
assert(resolveLeagueRegion(40) === "europe-top3-and-2nd");
assert(resolveLeagueRegion(45) === "europe-top3-and-2nd");
assert(resolveLeagueRegion(61) === "europe-top3-and-2nd", "Ligue 1");
assert(resolveLeagueRegion(78) === "europe-top3-and-2nd", "Bundesliga");
assert(resolveLeagueRegion(66) === "europe-top3-and-2nd", "Coupe de France");

assert(
  restrictedCompetitionBadge(2, "UEFA Champions League") ===
    "UEFA (Filtro 1ª ENG·ESP·ITA)"
);
assert(
  restrictedCompetitionBadge(13) === "CONMEBOL (Clubes Elegibles)"
);
assert(
  restrictedCompetitionBadge(71) === "Sudamérica (1ª y 2ª División)"
);
assert(
  restrictedCompetitionBadge(39) === "Europa (1ª y 2ª División)",
  "PL shows Europe 1ª/2ª badge"
);
assert(
  restrictedCompetitionBadge(45) === "Europa (1ª y 2ª División)",
  "FA Cup badge"
);
assert(
  competitionCategoryLabel(undefined, "Copa Libertadores") ===
    "CONMEBOL (Clubes Elegibles)"
);

console.log("verify-league-labels: ok");
