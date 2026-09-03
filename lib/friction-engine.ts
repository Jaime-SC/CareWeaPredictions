/**
 * Friction & xCard Engine — Expected Cards model.
 *
 * Pure logic: no I/O. Consumed by xgboost-runner.ts.
 * // ponytail: Poisson independence assumption; upgrade to correlated bivariate
 * // Poisson when enough referee+team card samples exist in RefereeProfile.
 */
import { poissonOverProb } from "./phase2-markets";
import { isInternationalKnockoutCompetitionId } from "./referee-engine";
import type { MarketType } from "./types";

/** PPDA threshold below which high-press friction boost activates. */
const HIGH_PRESS_PPDA = 8;
const HIGH_PRESS_BOOST = 0.05; // +5% per team in high-press

/** Argentine club country code / name patterns (lowercase). */
const ARGENTINA_PATTERNS = ["argentina", "arg"];
/** Brazilian club country code / name patterns (lowercase). */
const BRAZIL_PATTERNS = ["brazil", "brasil", "bra"];

// ─── Input / Output types ──────────────────────────────────────────────────────

export interface FrictionFixtureInput {
  homeAvgCardsFor: number;
  awayAvgCardsFor: number;
  homeAvgPPDA?: number | null;
  awayAvgPPDA?: number | null;
  refereeStrictness: number;
  leagueId?: number | null;
  /** Knockout round label (e.g. "Quarter-Finals", "Semi-Finals", "Final"). */
  roundLabel?: string | null;
  /** Country / nationality of home team (for rivalry detection). */
  homeCountry?: string | null;
  /** Country / nationality of away team (for rivalry detection). */
  awayCountry?: string | null;
}

export interface XCardResult {
  xCardHome: number;
  xCardAway: number;
  xCardTotal: number;
  rivalryMultiplier: number;
  refereeStrictness: number;
}

export interface CardProbabilities {
  cards_btts: number;
  cards_over_3_5: number;
  cards_under_3_5: number;
  cards_over_4_5: number;
  cards_under_4_5: number;
}

// ─── Rivalry detection ────────────────────────────────────────────────────────

function matchesAny(value: string | null | undefined, patterns: string[]): boolean {
  if (!value) return false;
  const lc = value.toLowerCase();
  return patterns.some((p) => lc.includes(p));
}

const KO_ROUND_RE = /quarter|semi|final|cuarto|semifinal|octavo|round of 8|round of 4/i;

/**
 * Detect if this fixture warrants a rivalry friction multiplier.
 *
 * Rules:
 * - CONMEBOL KO stage (Libertadores/Sudamericana) from QF onwards: +20%
 * - Argentina vs. Brazil cross-border derby: additional +15%
 * - Both conditions: +35% combined cap
 */
export function resolveRivalryMultiplier(input: Pick<
  FrictionFixtureInput,
  "leagueId" | "roundLabel" | "homeCountry" | "awayCountry"
>): number {
  const isKnockoutComp =
    input.leagueId != null &&
    isInternationalKnockoutCompetitionId(input.leagueId) &&
    input.roundLabel != null &&
    KO_ROUND_RE.test(input.roundLabel);

  const isArgBra =
    (matchesAny(input.homeCountry, ARGENTINA_PATTERNS) &&
      matchesAny(input.awayCountry, BRAZIL_PATTERNS)) ||
    (matchesAny(input.homeCountry, BRAZIL_PATTERNS) &&
      matchesAny(input.awayCountry, ARGENTINA_PATTERNS));

  if (isKnockoutComp && isArgBra) return 1.35;
  if (isKnockoutComp) return 1.2;
  if (isArgBra) return 1.15;
  return 1.0;
}

// ─── Core xCard calculation ───────────────────────────────────────────────────

const CARDS_PRIOR = 2.0; // prior per team when no profile data

/**
 * Compute expected cards per team and total, applying:
 * 1. Referee strictness multiplier
 * 2. High-press (low PPDA) friction boost
 * 3. Rivalry / competition context multiplier
 */
export function computeXCard(input: FrictionFixtureInput): XCardResult {
  const baseHome = Math.max(0.5, input.homeAvgCardsFor || CARDS_PRIOR);
  const baseAway = Math.max(0.5, input.awayAvgCardsFor || CARDS_PRIOR);

  // Press boost: low PPDA → more fouls → more cards
  const homePressBoost = (input.homeAvgPPDA ?? 11) < HIGH_PRESS_PPDA ? HIGH_PRESS_BOOST : 0;
  const awayPressBoost = (input.awayAvgPPDA ?? 11) < HIGH_PRESS_PPDA ? HIGH_PRESS_BOOST : 0;

  const rivalry = resolveRivalryMultiplier(input);
  const strictness = Math.max(0.5, Math.min(2.0, input.refereeStrictness));

  const xCardHome = baseHome * (1 + homePressBoost) * strictness * rivalry;
  const xCardAway = baseAway * (1 + awayPressBoost) * strictness * rivalry;

  return {
    xCardHome,
    xCardAway,
    xCardTotal: xCardHome + xCardAway,
    rivalryMultiplier: rivalry,
    refereeStrictness: strictness,
  };
}

// ─── Probability outputs ──────────────────────────────────────────────────────

function clamp(p: number): number {
  return Math.min(0.99, Math.max(0.01, p));
}

/**
 * Compute card market probabilities from xCard lambdas.
 * Independence assumption: P(both ≥ 1) = P(home ≥ 1) × P(away ≥ 1).
 */
export function computeCardProbabilities(
  xCardHome: number,
  xCardAway: number
): CardProbabilities {
  const xCardTotal = xCardHome + xCardAway;

  const pHomeCard = poissonOverProb(xCardHome, 0.5); // P(home ≥ 1)
  const pAwayCard = poissonOverProb(xCardAway, 0.5); // P(away ≥ 1)

  return {
    cards_btts: clamp(pHomeCard * pAwayCard),
    cards_over_3_5: clamp(poissonOverProb(xCardTotal, 3.5)),
    cards_under_3_5: clamp(1 - poissonOverProb(xCardTotal, 3.5)),
    cards_over_4_5: clamp(poissonOverProb(xCardTotal, 4.5)),
    cards_under_4_5: clamp(1 - poissonOverProb(xCardTotal, 4.5)),
  };
}

/**
 * Convenience: compute xCard then return card market probabilities.
 */
export function xCardProbabilities(
  input: FrictionFixtureInput
): CardProbabilities & { xCard: XCardResult } {
  const xCard = computeXCard(input);
  const probs = computeCardProbabilities(xCard.xCardHome, xCard.xCardAway);
  return { ...probs, xCard };
}

/** Subset of CardProbabilities as a Partial<Record<MarketType, number>>. */
export function cardProbsAsMarketMap(
  probs: CardProbabilities
): Partial<Record<MarketType, number>> {
  return {
    cards_btts: probs.cards_btts,
    cards_over_3_5: probs.cards_over_3_5,
    cards_under_3_5: probs.cards_under_3_5,
    cards_over_4_5: probs.cards_over_4_5,
    cards_under_4_5: probs.cards_under_4_5,
  };
}
