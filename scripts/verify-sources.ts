/**
 * Smoke: weather λ, FairOdds value, underdog sanity, standings gap.
 * Usage: npx tsx scripts/verify-sources.ts
 */
import {
  fairOdds,
  isValueBet,
  valueMarginPercent,
} from "../lib/value-finder";
import {
  MIN_SELECTION_ODDS,
  MIN_VALUE_MARGIN,
} from "../lib/poisson";
import {
  resolveVenueCoords,
  weatherLambdaFactor,
  WEATHER_ADVERSE_LAMBDA,
  WEATHER_HEAVY_PRECIP_MMH,
} from "../lib/sources/weather";
import {
  failsMarketSanity,
  failsModelMarketAnomaly,
  failsUnderdogSanity,
  UNDERDOG_ODDS_THRESHOLD,
} from "../lib/filters";
import {
  applyStandingsAwayPenalty,
  isAwayHeavyUnderdogByStandings,
  STANDINGS_AWAY_PENALTY,
} from "../lib/standings";
import type { MarketType, Match } from "../lib/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Weather
assert(weatherLambdaFactor(0) === 1, "dry → factor 1");
assert(weatherLambdaFactor(WEATHER_HEAVY_PRECIP_MMH) === 1, "at threshold → 1");
assert(
  weatherLambdaFactor(WEATHER_HEAVY_PRECIP_MMH + 0.1) === WEATHER_ADVERSE_LAMBDA,
  "heavy rain → 0.90"
);
assert(resolveVenueCoords("Emirates Stadium", "London") != null, "London coords");
assert(resolveVenueCoords("Unknown Void Arena", null) == null, "unknown venue");

// FairOdds / Value%
assert(Math.abs(fairOdds(0.5) - 2) < 1e-12, "FairOdds(0.5)=2");
assert(Math.abs(valueMarginPercent(0.5, 2.2) - 10) < 1e-9, "Value% = 10");
assert(isValueBet(0.5, 2.2) === true, "isValueBet at 10%");
assert(isValueBet(0.5, 2.05) === false, "isValueBet below 5%");
assert(isValueBet(0.5, 2.1) === true, "2.1/2 → 5% exactly");

// Selection floor + EV gate (poisson isSafePick)
assert(MIN_SELECTION_ODDS === 1.4, "MIN_SELECTION_ODDS = 1.40");
assert(MIN_VALUE_MARGIN === 0.03, "MIN_VALUE_MARGIN = 3%");
assert(
  isValueBet(0.72, 1.45, MIN_VALUE_MARGIN * 100) === true,
  "1.45 vs fair ~1.39 passes 3% EV"
);
assert(
  isValueBet(0.72, 1.42, MIN_VALUE_MARGIN * 100) === false,
  "1.42 vs fair ~1.39 fails 3% EV"
);

// Underdog sanity
const underdogMatch = {
  odds: {
    home: 1.25,
    draw: 5.5,
    away: UNDERDOG_ODDS_THRESHOLD + 0.1,
    doubleChance1X: 1.15,
    doubleChanceX2: 2.1,
    over05: 1.1,
    over15: 1.3,
    over25: 1.8,
    under35: 1.4,
    under45: 1.2,
    homeScores: 1.2,
    awayScores: 2.0,
    dnbHome: 1.2,
    dnbAway: 1.2,
  },
} as Match;

assert(
  failsUnderdogSanity(underdogMatch, "away", 0.8, 1.2) === true,
  "underdog high-conf + low odds blocked"
);
assert(
  failsUnderdogSanity(underdogMatch, "away", 0.7, 1.5) === false,
  "underdog moderate ok"
);
assert(
  failsModelMarketAnomaly(0.9, 3.5) === true,
  "model vs market >30pp anomaly"
);
assert(
  failsMarketSanity(underdogMatch, "away", 0.8, 1.2).fail === true,
  "combined sanity fail"
);
assert(
  failsMarketSanity(underdogMatch, "home", 0.85, 1.25).fail === false,
  "favourite home pick ok"
);

// Standings gap
assert(
  isAwayHeavyUnderdogByStandings({
    homeRank: 1,
    awayRank: 14,
    awayRankGap: 13,
  }),
  "1st vs 14th gap"
);
const baseProbs = { away: 0.4, dnb_away: 0.5 } as Record<MarketType, number>;
const penalized = applyStandingsAwayPenalty(baseProbs, {
  homeRank: 1,
  awayRank: 14,
  awayRankGap: 13,
});
assert(
  Math.abs(penalized.probs.away - 0.4 * STANDINGS_AWAY_PENALTY) < 1e-9,
  "away penalty applied"
);
assert(penalized.flags.includes("STANDINGS_AWAY_WEAK"), "standings flag");

// ESPN slug
function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}
assert(slug("Atlético Madrid") === "atletico_madrid", "ESPN slug accents");

console.log("verify-sources: OK");
