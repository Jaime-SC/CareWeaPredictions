/**
 * Value bet edge detector: model probability vs bookmaker implied probability.
 * Edge = P_model − P_implied. Flag when Edge ≥ +5%.
 *
 * Spec FairOdds path (coexists): FairOdds = 1/P,
 * Value% = (BookOdds/FairOdds − 1)×100 ≥ 5 → isValueBet.
 *
 * Intentionally self-contained (no poisson / model-weights) so client
 * components can import badges without pulling Node `fs` into the browser.
 */
import type { ParlayLeg } from "./types";

/** Minimum edge (5pp) to flag a value bet (legacy edge metric). */
export const VALUE_EDGE_THRESHOLD = 0.05;

/** Spec: minimum Value% using FairOdds = 1/P_model. */
export const VALUE_MARGIN_THRESHOLD_PCT = 5;

/**
 * Bookmaker implied probability: P_implied = 1 / odds.
 */
export function bookmakerImpliedProbability(odds: number): number {
  if (odds <= 1) return 1;
  return 1 / odds;
}

/**
 * Value edge: P_model − P_implied.
 */
export function valueEdge(modelProbability: number, odds: number): number {
  return modelProbability - bookmakerImpliedProbability(odds);
}

/** Fair decimal odds from model probability (no overround). */
export function fairOdds(modelProbability: number): number {
  if (!(modelProbability > 0) || modelProbability >= 1) return Infinity;
  return 1 / modelProbability;
}

/**
 * Spec value margin: ((Bookmaker_Odds / Fair_Odds) − 1) × 100.
 * Returns 0 when inputs are unusable.
 */
export function valueMarginPercent(
  modelProbability: number,
  bookmakerOdds: number
): number {
  if (!(bookmakerOdds > 1) || !(modelProbability > 0) || modelProbability >= 1) {
    return 0;
  }
  const fair = fairOdds(modelProbability);
  if (!Number.isFinite(fair) || fair <= 0) return 0;
  return (bookmakerOdds / fair - 1) * 100;
}

/** Spec isValueBet when Value% ≥ 5. */
export function isValueBet(
  modelProbability: number,
  bookmakerOdds: number,
  thresholdPct = VALUE_MARGIN_THRESHOLD_PCT
): boolean {
  return valueMarginPercent(modelProbability, bookmakerOdds) >= thresholdPct;
}

export function formatValueBadge(edge: number): string | null {
  if (edge < VALUE_EDGE_THRESHOLD) return null;
  const pct = Math.round(edge * 100);
  return `[VALUE +${pct}%]`;
}

/** Ranking boost so positive-value legs are preferred in accumulator selection. */
export function valueRankBonus(
  modelProbability: number,
  odds: number
): number {
  const edge = valueEdge(modelProbability, odds);
  if (edge < VALUE_EDGE_THRESHOLD) return 0;
  // Strong nudge once past the 5% threshold
  return 0.5 + edge * 4;
}

/**
 * Stable sort: value legs first (by edge desc), then original order.
 */
export function prioritizeValueLegs<
  T extends Pick<ParlayLeg, "modelProbability" | "odds" | "edge">,
>(legs: T[]): T[] {
  return [...legs].sort((a, b) => {
    const ea = a.edge ?? valueEdge(a.modelProbability, a.odds);
    const eb = b.edge ?? valueEdge(b.modelProbability, b.odds);
    const va = ea >= VALUE_EDGE_THRESHOLD ? 1 : 0;
    const vb = eb >= VALUE_EDGE_THRESHOLD ? 1 : 0;
    if (vb !== va) return vb - va;
    return eb - ea;
  });
}
