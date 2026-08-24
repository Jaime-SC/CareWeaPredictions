/**
 * Match eligibility filters + market sanity guardrails.
 */
import type { MarketType, Match, MatchOdds } from "./types";

export const UNAVAILABLE_NO_REAL_ODDS = "UNAVAILABLE_NO_REAL_ODDS" as const;

/** 1X2 price above this → clear underdog side. */
export const UNDERDOG_ODDS_THRESHOLD = 3.2;
/** Model confidence capped for underdog-side picks. */
export const UNDERDOG_MAX_MODEL_PROB = 0.75;
/** Low-odds “safe” band blocked for underdog sides (e.g. DNB @ 1.20). */
export const UNDERDOG_MIN_PICK_ODDS = 1.35;
/** |P_model − P_implied| above this → market anomaly reject. */
export const MODEL_MARKET_DISAGREE = 0.3;

export type MatchUnavailableReason = typeof UNAVAILABLE_NO_REAL_ODDS;

function hasBookmaker1x2Board(odds: MatchOdds): boolean {
  return (
    odds.home > 1 &&
    odds.draw > 1 &&
    odds.away > 1 &&
    odds.doubleChance1X > 1
  );
}

/** True when the fixture carries a real bookmaker 1X2 + double-chance board. */
export function hasRealBookmakerOdds(match: Match): boolean {
  return hasBookmaker1x2Board(match.odds);
}

/**
 * Keep fixtures even without live bookmaker odds — Poisson fair odds fill the
 * board downstream in `predictMatchMarkets`.
 */
export function rejectMatchesWithoutRealOdds(matches: Match[]): Match[] {
  return matches;
}

/** Main 1X2 win odds for the side implied by the market. */
export function sideWinOdds(
  odds: MatchOdds,
  market: MarketType
): number | null {
  switch (market) {
    case "home":
    case "1x":
    case "dnb_home":
    case "home_scores":
    case "home_over_1_5":
      return odds.home > 1 ? odds.home : null;
    case "away":
    case "x2":
    case "dnb_away":
    case "away_scores":
    case "away_over_1_5":
      return odds.away > 1 ? odds.away : null;
    default:
      return null;
  }
}

export function isClearUnderdogSide(
  odds: MatchOdds,
  market: MarketType
): boolean {
  const winOdds = sideWinOdds(odds, market);
  return winOdds != null && winOdds > UNDERDOG_ODDS_THRESHOLD;
}

/**
 * Underdog sanity: no high-confidence (>75%) or ultra-low-odds picks
 * for a clear underdog side (1X2 > 3.20).
 */
export function failsUnderdogSanity(
  match: Match,
  market: MarketType,
  modelProbability: number,
  pickOdds: number
): boolean {
  if (!isClearUnderdogSide(match.odds, market)) return false;
  if (modelProbability > UNDERDOG_MAX_MODEL_PROB) return true;
  if (pickOdds > 1 && pickOdds < UNDERDOG_MIN_PICK_ODDS) return true;
  return false;
}

/**
 * Reject when model probability disagrees with implied book probability by >30pp.
 */
export function failsModelMarketAnomaly(
  modelProbability: number,
  bookmakerOdds: number
): boolean {
  if (!(bookmakerOdds > 1)) return true;
  const implied = 1 / bookmakerOdds;
  return Math.abs(modelProbability - implied) > MODEL_MARKET_DISAGREE;
}

/** Ban picks with no explicit bookmaker line (odds ≤ 1 / sentinel). */
export function failsMissingBookLine(bookmakerOdds: number): boolean {
  return !(bookmakerOdds > 1);
}

/**
 * Combined market sanity for isSafePick / selection gates.
 */
export function failsMarketSanity(
  match: Match,
  market: MarketType,
  modelProbability: number,
  bookmakerOdds: number
): { fail: boolean; flags: string[] } {
  const flags: string[] = [];
  if (failsMissingBookLine(bookmakerOdds)) {
    flags.push(UNAVAILABLE_NO_REAL_ODDS);
    return { fail: true, flags };
  }
  if (failsUnderdogSanity(match, market, modelProbability, bookmakerOdds)) {
    flags.push("UNDERDOG_SANITY");
  }
  if (failsModelMarketAnomaly(modelProbability, bookmakerOdds)) {
    flags.push("MODEL_MARKET_ANOMALY");
  }
  return { fail: flags.length > 0, flags };
}
