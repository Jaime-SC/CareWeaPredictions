/**
 * Value bet edge detector: model probability vs bookmaker implied probability.
 * Edge = P_model − P_implied. Flag when Edge ≥ +5%.
 *
 * Intentionally self-contained (no poisson / model-weights) so client
 * components can import badges without pulling Node `fs` into the browser.
 */
import type { ParlayLeg } from "./types";

/** Minimum edge (5pp) to flag a value bet. */
export const VALUE_EDGE_THRESHOLD = 0.05;

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
