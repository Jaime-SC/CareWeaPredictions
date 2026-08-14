/**
 * Match eligibility filters for the prediction / parlay pipeline.
 */
import { hasBookmakerOdds } from "./poisson";
import type { Match } from "./types";

export const UNAVAILABLE_NO_REAL_ODDS = "UNAVAILABLE_NO_REAL_ODDS" as const;

export type MatchUnavailableReason = typeof UNAVAILABLE_NO_REAL_ODDS;

/** True when the fixture carries a real bookmaker 1X2 + double-chance board. */
export function hasRealBookmakerOdds(match: Match): boolean {
  return hasBookmakerOdds(match.odds);
}

/**
 * Drop fixtures without live bookmaker odds. Never lets Poisson fair odds
 * stand in for a missing `/odds?fixture={id}` payload.
 */
export function rejectMatchesWithoutRealOdds(matches: Match[]): Match[] {
  const kept: Match[] = [];
  for (const match of matches) {
    if (hasRealBookmakerOdds(match)) {
      kept.push(match);
      continue;
    }
    console.warn(
      `[filters] ${UNAVAILABLE_NO_REAL_ODDS} ${match.home.name} vs ${match.away.name} (${match.id})`
    );
  }
  return kept;
}
