/**
 * Synthetic odds + paper backtest smoke.
 * Usage: npx tsx scripts/verify-backtest.ts
 */
import {
  BACKTEST_FALLBACK_MIN_ODDS,
  doubleChanceOddsFrom1x2,
  dnbOddsFrom1x2,
  runPaperBacktest,
  type FdMatchResult,
} from "../lib/sources/football-data";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Formulas from spec
const home = 2.0;
const draw = 3.5;
const away = 4.0;

const dc = doubleChanceOddsFrom1x2(home, draw, away);
const expected1X = 1 / (1 / home + 1 / draw);
assert(
  dc.dc1X != null && Math.abs(dc.dc1X - expected1X) < 0.002,
  "Double Chance 1X from 1X2"
);

const dnb = dnbOddsFrom1x2(home, draw, away);
const expectedDnbHome = home * (1 - 1 / draw);
assert(
  dnb.dnbHome != null && Math.abs(dnb.dnbHome - expectedDnbHome) < 0.002,
  "DNB Home from 1X2 + draw"
);

function synthMatch(
  id: number,
  hg: number,
  ag: number,
  odds: { home: number; draw: number; away: number }
): FdMatchResult {
  return {
    id,
    utcDate: "2024-09-01T15:00:00Z",
    status: "FINISHED",
    homeTeam: `Home${id}`,
    awayTeam: `Away${id}`,
    homeGoals: hg,
    awayGoals: ag,
    odds,
  };
}

/** Repeat favorites at home so synthetic DC/DNB land in 1.40–1.85. */
const matches: FdMatchResult[] = Array.from({ length: 40 }, (_, i) =>
  synthMatch(
    i + 1,
    i % 5 === 0 ? 1 : 2,
    i % 5 === 0 ? 1 : 0,
    { home: 2.5, draw: 3.5, away: 4.0 }
  )
);

const strict = runPaperBacktest(matches, {
  threshold: 0,
  minOdds: 1.4,
  maxOdds: 1.85,
  market: "ALL",
  autoMinOddsFallback: false,
});
assert(strict.nBets > 0, "ALL + synthetic DC/DNB yields bets at 1.40+");
assert(
  (strict.byMarket["1x"]?.nBets ?? 0) > 0 ||
    (strict.byMarket.dnb_home?.nBets ?? 0) > 0,
  "includes synthetic 1X or DNB markets"
);

const fallback = runPaperBacktest(
  matches.map((m) => ({
    ...m,
    odds: { home: 1.35, draw: 4.5, away: 8.0 },
  })),
  { threshold: 0, minOdds: 1.4, maxOdds: 1.85, market: "1X2" }
);
assert(
  fallback.minOddsFallbackApplied === true &&
    fallback.minOdds === BACKTEST_FALLBACK_MIN_ODDS,
  "1X2 auto-fallback to 1.20 when strict band yields zero bets"
);
assert(fallback.nBets > 0, "fallback run registers bets");

console.log("verify-backtest: OK", {
  strictBets: strict.nBets,
  fallbackBets: fallback.nBets,
  byMarket: strict.byMarket,
});
