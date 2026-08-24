/**
 * Poisson fair-odds fallback when bookmaker board is missing.
 * Usage: npx tsx scripts/verify-poisson-fair-odds.ts
 */
import { hasBookmakerOdds, predictMatchMarkets } from "../lib/poisson";
import type { Match } from "../lib/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const bare: Match = {
  id: "live-fair-1",
  league: "premier-league",
  leagueName: "Premier League",
  leagueId: "39",
  kickoff: "2026-08-24T19:00:00.000Z",
  home: {
    name: "Home FC",
    shortName: "HOM",
    form: ["W", "W", "D"],
    goalsScoredAvg: 1.6,
    goalsConcededAvg: 0.9,
  },
  away: {
    name: "Away FC",
    shortName: "AWY",
    form: ["L", "D", "L"],
    goalsScoredAvg: 1.0,
    goalsConcededAvg: 1.4,
  },
  h2h: { homeWins: 2, draws: 1, awayWins: 0, avgGoals: 2.4 },
  odds: {
    home: 0,
    draw: 0,
    away: 0,
    doubleChance1X: 0,
    doubleChanceX2: 0,
    over05: 0,
    over15: 0,
    over25: 0,
    under35: 0,
    under45: 0,
    homeScores: 0,
    awayScores: 0,
    dnbHome: 0,
    dnbAway: 0,
  },
};

assert(!hasBookmakerOdds(bare.odds), "bare has no book");

const { markets, contextFlags } = predictMatchMarkets(bare, {
  minSafeProbability: 0.5,
  minSafeOdds: 1.05,
  maxSafeOdds: 5,
});

assert(markets.length > 0, "markets produced without book odds");
assert(markets.every((m) => m.odds > 1), "fair odds > 1");
assert(contextFlags.includes("POISSON_FAIR_ODDS"), "fair-odds flag");
assert(!contextFlags.includes("UNAVAILABLE_NO_REAL_ODDS"), "no hard drop flag");

console.log("verify-poisson-fair-odds: ok", {
  markets: markets.length,
  sample: markets.slice(0, 3).map((m) => ({
    market: m.market,
    odds: m.odds,
    p: m.modelProbability,
  })),
});
