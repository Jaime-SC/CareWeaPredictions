/**
 * Serie A IT vs Brasileirão display labels.
 * Usage: npx tsx scripts/verify-league-labels-serie-a.ts
 */
import {
  getLeagueCountry,
  getLeagueDisplayName,
} from "../lib/utils/league-labels";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(getLeagueDisplayName(135) === "Serie A (Italia)", "IT A");
assert(getLeagueDisplayName(136) === "Serie B (Italia)", "IT B");
assert(getLeagueDisplayName(71) === "Brasileirão Série A", "BR A");
assert(getLeagueDisplayName(72) === "Brasileirão Série B", "BR B");
assert(getLeagueDisplayName("135") === "Serie A (Italia)", "string id");
assert(getLeagueDisplayName(71, "Serie A") === "Brasileirão Série A", "BR overrides API");
assert(getLeagueDisplayName(135, "Serie A") === "Serie A (Italia)", "IT overrides API");
assert(getLeagueCountry(135) === "Italia");
assert(getLeagueCountry(71) === "Brasil");
assert(getLeagueDisplayName(135) !== getLeagueDisplayName(71), "distinct");

console.log("verify-league-labels-serie-a: ok");
