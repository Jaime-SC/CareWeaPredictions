/**
 * Phase 2 market list + Poisson λ / O-U helpers for corners, cards, HT goals.
 * // ponytail: independent Poisson; upgrade to NegBin when overdispersion calibrated
 */
import type { TeamProfileSnapshot } from "./team-profile-shared";
import type { MarketType, Match, MatchOdds } from "./types";

export type Phase2ProfileHints = {
  home?: TeamProfileSnapshot | null;
  away?: TeamProfileSnapshot | null;
};

function poissonPmf(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = (p * lambda) / i;
  return p;
}

export const GOAL_MARKET_TYPES: MarketType[] = [
  "home",
  "draw",
  "away",
  "1x",
  "x2",
  "over_0_5",
  "over_1_5",
  "over_2_5",
  "under_3_5",
  "under_4_5",
  "home_scores",
  "away_scores",
  "home_over_1_5",
  "away_over_1_5",
  "dnb_home",
  "dnb_away",
  "btts_yes",
  "btts_no",
];

export const PHASE2_MARKET_TYPES: MarketType[] = [
  "corners_over_7_5",
  "corners_under_7_5",
  "corners_over_8_5",
  "corners_under_8_5",
  "corners_over_9_5",
  "corners_under_9_5",
  "corners_over_10_5",
  "corners_under_10_5",
  "corners_1h_over_3_5",
  "corners_1h_under_3_5",
  "corners_1h_over_4_5",
  "corners_1h_under_4_5",
  "corners_home_over_3_5",
  "corners_home_under_3_5",
  "corners_home_over_4_5",
  "corners_home_under_4_5",
  "corners_away_over_3_5",
  "corners_away_under_3_5",
  "corners_away_over_4_5",
  "corners_away_under_4_5",
  "cards_over_3_5",
  "cards_under_3_5",
  "cards_over_4_5",
  "cards_under_4_5",
  "cards_over_5_5",
  "cards_under_5_5",
  "cards_btts",
  "cards_home_over_1_5",
  "cards_home_under_1_5",
  "cards_home_over_2_5",
  "cards_home_under_2_5",
  "cards_away_over_1_5",
  "cards_away_under_1_5",
  "cards_away_over_2_5",
  "cards_away_under_2_5",
  "ht_over_0_5",
  "ht_under_0_5",
  "ht_over_1_5",
  "ht_under_1_5",
  "ht_home",
  "ht_draw",
  "ht_away",
];

export const ALL_PARLAY_MARKETS = new Set<MarketType>([
  ...GOAL_MARKET_TYPES,
  ...PHASE2_MARKET_TYPES,
]);

export function isPhase2Market(market: MarketType): boolean {
  return (PHASE2_MARKET_TYPES as string[]).includes(market);
}

/** Markets that need fixture statistics (corners/cards) to settle. */
export function needsFixtureStatSettlement(market: MarketType): boolean {
  return (
    market.startsWith("corners_") || market.startsWith("cards_")
  );
}

export function needsHtScoreSettlement(market: MarketType): boolean {
  return market.startsWith("ht_");
}

export const CORNER_PRIOR_TOTAL = 9.5;
export const CORNER_HOME_SHARE = 0.55;
export const CARDS_PRIOR_TOTAL = 4.2;
export const CORNERS_1H_FRAC = 0.47;
export const HT_GOALS_FRAC = 0.45;

/** P(X <= k) for Poisson(λ). */
export function poissonCdfAtMost(k: number, lambda: number): number {
  if (k < 0) return 0;
  const max = Math.min(Math.floor(k), 40);
  let sum = 0;
  for (let i = 0; i <= max; i++) sum += poissonPmf(i, lambda);
  return Math.min(1, Math.max(0, sum));
}

/** P(X > line) for .5 lines (e.g. over 8.5 → X >= 9). */
export function poissonOverProb(lambda: number, line: number): number {
  const lam = Math.max(0.05, lambda);
  return Math.min(0.99, Math.max(0.01, 1 - poissonCdfAtMost(Math.floor(line), lam)));
}

/** P(X < line) for .5 lines (e.g. under 8.5 → X <= 8). */
export function poissonUnderProb(lambda: number, line: number): number {
  const lam = Math.max(0.05, lambda);
  return Math.min(0.99, Math.max(0.01, poissonCdfAtMost(Math.floor(line), lam)));
}

export type CornerCardLambdas = {
  cornersTotal: number;
  cornersHome: number;
  cornersAway: number;
  corners1h: number;
  cardsTotal: number;
  cardsHome: number;
  cardsAway: number;
};

function clampLam(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v) || v <= 0) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export function estimateCornerCardLambdas(
  match: Match,
  profiles?: Phase2ProfileHints
): CornerCardLambdas {
  const homeProfile = profiles?.home ?? null;
  const awayProfile = profiles?.away ?? null;
  const hFor =
    homeProfile?.avgCornersFor ??
    match.home.homeCornersForAvg ??
    match.home.cornersForAvg ??
    CORNER_PRIOR_TOTAL * CORNER_HOME_SHARE;
  const aFor =
    awayProfile?.avgCornersFor ??
    match.away.awayCornersForAvg ??
    match.away.cornersForAvg ??
    CORNER_PRIOR_TOTAL * (1 - CORNER_HOME_SHARE);
  // Blend for+against lightly when both sides have data
  const hAgainst =
    homeProfile?.avgCornersAgainst ?? match.home.cornersAgainstAvg;
  const aAgainst =
    awayProfile?.avgCornersAgainst ?? match.away.cornersAgainstAvg;
  let cornersHome = hFor;
  let cornersAway = aFor;
  if (aAgainst != null && aAgainst > 0) {
    cornersHome = (hFor + aAgainst) / 2;
  }
  if (hAgainst != null && hAgainst > 0) {
    cornersAway = (aFor + hAgainst) / 2;
  }
  cornersHome = clampLam(cornersHome, 2, 10);
  cornersAway = clampLam(cornersAway, 2, 10);
  const cornersTotal = clampLam(cornersHome + cornersAway, 5, 16);

  const cardsHome = clampLam(
    homeProfile?.avgCardsFor ??
      match.home.homeYellowCardsAvg ??
      match.home.yellowCardsAvg ??
      CARDS_PRIOR_TOTAL * 0.5,
    0.4,
    5
  );
  const cardsAway = clampLam(
    awayProfile?.avgCardsFor ??
      match.away.awayYellowCardsAvg ??
      match.away.yellowCardsAvg ??
      CARDS_PRIOR_TOTAL * 0.5,
    0.4,
    5
  );
  const cardsTotal = clampLam(cardsHome + cardsAway, 1.5, 9);

  return {
    cornersTotal,
    cornersHome,
    cornersAway,
    corners1h: clampLam(cornersTotal * CORNERS_1H_FRAC, 2, 8),
    cardsTotal,
    cardsHome,
    cardsAway,
  };
}

/** Independent Poisson HT 1X2 from scaled FT λ. */
function ht1x2Probs(
  lambdaHome: number,
  lambdaAway: number
): { home: number; draw: number; away: number } {
  const maxG = 6;
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  const s = home + draw + away;
  if (s <= 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: home / s, draw: draw / s, away: away / s };
}

export function phase2MarketProbs(
  match: Match,
  ftXg: { home: number; away: number },
  profiles?: Phase2ProfileHints
): Partial<Record<MarketType, number>> {
  const L = estimateCornerCardLambdas(match, profiles);
  const htH = Math.max(0.05, ftXg.home * HT_GOALS_FRAC);
  const htA = Math.max(0.05, ftXg.away * HT_GOALS_FRAC);
  const ht = ht1x2Probs(htH, htA);
  const htTotal = htH + htA;

  return {
    corners_over_7_5: poissonOverProb(L.cornersTotal, 7.5),
    corners_under_7_5: poissonUnderProb(L.cornersTotal, 7.5),
    corners_over_8_5: poissonOverProb(L.cornersTotal, 8.5),
    corners_under_8_5: poissonUnderProb(L.cornersTotal, 8.5),
    corners_over_9_5: poissonOverProb(L.cornersTotal, 9.5),
    corners_under_9_5: poissonUnderProb(L.cornersTotal, 9.5),
    corners_over_10_5: poissonOverProb(L.cornersTotal, 10.5),
    corners_under_10_5: poissonUnderProb(L.cornersTotal, 10.5),
    corners_1h_over_3_5: poissonOverProb(L.corners1h, 3.5),
    corners_1h_under_3_5: poissonUnderProb(L.corners1h, 3.5),
    corners_1h_over_4_5: poissonOverProb(L.corners1h, 4.5),
    corners_1h_under_4_5: poissonUnderProb(L.corners1h, 4.5),
    corners_home_over_3_5: poissonOverProb(L.cornersHome, 3.5),
    corners_home_under_3_5: poissonUnderProb(L.cornersHome, 3.5),
    corners_home_over_4_5: poissonOverProb(L.cornersHome, 4.5),
    corners_home_under_4_5: poissonUnderProb(L.cornersHome, 4.5),
    corners_away_over_3_5: poissonOverProb(L.cornersAway, 3.5),
    corners_away_under_3_5: poissonUnderProb(L.cornersAway, 3.5),
    corners_away_over_4_5: poissonOverProb(L.cornersAway, 4.5),
    corners_away_under_4_5: poissonUnderProb(L.cornersAway, 4.5),
    cards_over_3_5: poissonOverProb(L.cardsTotal, 3.5),
    cards_under_3_5: poissonUnderProb(L.cardsTotal, 3.5),
    cards_over_4_5: poissonOverProb(L.cardsTotal, 4.5),
    cards_under_4_5: poissonUnderProb(L.cardsTotal, 4.5),
    cards_over_5_5: poissonOverProb(L.cardsTotal, 5.5),
    cards_under_5_5: poissonUnderProb(L.cardsTotal, 5.5),
    cards_home_over_1_5: poissonOverProb(L.cardsHome, 1.5),
    cards_home_under_1_5: poissonUnderProb(L.cardsHome, 1.5),
    cards_home_over_2_5: poissonOverProb(L.cardsHome, 2.5),
    cards_home_under_2_5: poissonUnderProb(L.cardsHome, 2.5),
    cards_away_over_1_5: poissonOverProb(L.cardsAway, 1.5),
    cards_away_under_1_5: poissonUnderProb(L.cardsAway, 1.5),
    cards_away_over_2_5: poissonOverProb(L.cardsAway, 2.5),
    cards_away_under_2_5: poissonUnderProb(L.cardsAway, 2.5),
    ht_over_0_5: poissonOverProb(htTotal, 0.5),
    ht_under_0_5: poissonUnderProb(htTotal, 0.5),
    ht_over_1_5: poissonOverProb(htTotal, 1.5),
    ht_under_1_5: poissonUnderProb(htTotal, 1.5),
    ht_home: ht.home,
    ht_draw: ht.draw,
    ht_away: ht.away,
  };
}

export const PHASE2_ODDS_KEY: Partial<Record<MarketType, keyof MatchOdds>> = {
  corners_over_7_5: "cornersOver75",
  corners_under_7_5: "cornersUnder75",
  corners_over_8_5: "cornersOver85",
  corners_under_8_5: "cornersUnder85",
  corners_over_9_5: "cornersOver95",
  corners_under_9_5: "cornersUnder95",
  corners_over_10_5: "cornersOver105",
  corners_under_10_5: "cornersUnder105",
  corners_1h_over_3_5: "corners1hOver35",
  corners_1h_under_3_5: "corners1hUnder35",
  corners_1h_over_4_5: "corners1hOver45",
  corners_1h_under_4_5: "corners1hUnder45",
  corners_home_over_3_5: "cornersHomeOver35",
  corners_home_under_3_5: "cornersHomeUnder35",
  corners_home_over_4_5: "cornersHomeOver45",
  corners_home_under_4_5: "cornersHomeUnder45",
  corners_away_over_3_5: "cornersAwayOver35",
  corners_away_under_3_5: "cornersAwayUnder35",
  corners_away_over_4_5: "cornersAwayOver45",
  corners_away_under_4_5: "cornersAwayUnder45",
  cards_over_3_5: "cardsOver35",
  cards_under_3_5: "cardsUnder35",
  cards_over_4_5: "cardsOver45",
  cards_under_4_5: "cardsUnder45",
  cards_over_5_5: "cardsOver55",
  cards_under_5_5: "cardsUnder55",
  cards_home_over_1_5: "cardsHomeOver15",
  cards_home_under_1_5: "cardsHomeUnder15",
  cards_home_over_2_5: "cardsHomeOver25",
  cards_home_under_2_5: "cardsHomeUnder25",
  cards_away_over_1_5: "cardsAwayOver15",
  cards_away_under_1_5: "cardsAwayUnder15",
  cards_away_over_2_5: "cardsAwayOver25",
  cards_away_under_2_5: "cardsAwayUnder25",
  ht_over_0_5: "htOver05",
  ht_under_0_5: "htUnder05",
  ht_over_1_5: "htOver15",
  ht_under_1_5: "htUnder15",
  ht_home: "htHome",
  ht_draw: "htDraw",
  ht_away: "htAway",
};
