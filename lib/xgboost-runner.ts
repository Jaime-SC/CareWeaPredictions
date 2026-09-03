/**
 * Pre-match XGBoost-style inference for secondary markets (corners, cards, team totals).
 * Loads JSON tree artifacts when present; falls back to heuristic features from TeamProfile.
 * // ponytail: heuristic trees, upgrade when real model trained on StatsBomb/soccerdata
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import type { TeamProfileSnapshot } from "./team-profile-shared";
import {
  CORNER_PRIOR_TOTAL,
  CORNER_HOME_SHARE,
  CARDS_PRIOR_TOTAL,
  poissonOverProb,
  poissonUnderProb,
} from "./phase2-markets";
import type { MarketType } from "./types";
import {
  computeXCard,
  computeCardProbabilities,
  resolveRivalryMultiplier,
} from "./friction-engine";

export type XgboostFixtureInput = {
  homeProfile: TeamProfileSnapshot | null;
  awayProfile: TeamProfileSnapshot | null;
  refereeStrictness?: number;
  rivalryMultiplier?: number;
  fixture?: {
    leagueId?: number;
    isDerby?: boolean;
    roundLabel?: string | null;
    homeCountry?: string | null;
    awayCountry?: string | null;
  };
};

type TreeNode = {
  feature?: string;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
  leaf?: number;
};

type ModelFile = {
  version?: number;
  trees?: Partial<Record<string, TreeNode>>;
};

const SECONDARY_MARKETS: MarketType[] = [
  "corners_over_8_5",
  "corners_under_8_5",
  "corners_over_9_5",
  "corners_under_9_5",
  "corners_over_10_5",
  "corners_under_10_5",
  "corners_home_over_3_5",
  "corners_away_over_3_5",
  "cards_over_3_5",
  "cards_under_3_5",
  "cards_over_4_5",
  "cards_under_4_5",
  "cards_btts",
  "home_over_1_5",
  "away_over_1_5",
];

let cachedModel: ModelFile | null | undefined;

function modelPath(): string {
  return path.join(process.cwd(), "config", "models", "xgboost_secondary.json");
}

function loadModel(): ModelFile | null {
  if (cachedModel !== undefined) return cachedModel;
  const p = modelPath();
  if (!existsSync(p)) {
    cachedModel = null;
    return null;
  }
  try {
    cachedModel = JSON.parse(readFileSync(p, "utf8")) as ModelFile;
    return cachedModel;
  } catch {
    cachedModel = null;
    return null;
  }
}

function clampProb(p: number): number {
  return Math.min(0.99, Math.max(0.01, p));
}

export {
  resolveRefereeStrictness,
  resolveRefereeStrictnessAsync,
} from "./referee-engine";

function hasAdvancedMetrics(
  home: TeamProfileSnapshot | null,
  away: TeamProfileSnapshot | null
): boolean {
  const profiles = [home, away].filter(Boolean) as TeamProfileSnapshot[];
  return profiles.some(
    (p) =>
      (p.avgNpxGScored != null && Number.isFinite(p.avgNpxGScored)) ||
      (p.avgCornersFor != null && Number.isFinite(p.avgCornersFor))
  );
}

type FeatureVector = Record<string, number>;

function buildFeatures(input: XgboostFixtureInput): FeatureVector {
  const home = input.homeProfile;
  const away = input.awayProfile;
  const homeNpxg = home?.avgNpxGScored ?? 1.2;
  const awayNpxg = away?.avgNpxGScored ?? 1.2;
  const homeNpxgConc = home?.avgNpxGConceded ?? 1.2;
  const awayNpxgConc = away?.avgNpxGConceded ?? 1.2;
  const homePpda = home?.avgPPDA ?? 11;
  const awayPpda = away?.avgPPDA ?? 11;
  const homeCorners =
    home?.avgCornersFor ?? CORNER_PRIOR_TOTAL * CORNER_HOME_SHARE;
  const awayCorners =
    away?.avgCornersFor ?? CORNER_PRIOR_TOTAL * (1 - CORNER_HOME_SHARE);
  const homeCornersAgainst = home?.avgCornersAgainst ?? homeCorners;
  const awayCornersAgainst = away?.avgCornersAgainst ?? awayCorners;
  const cornersHome = (homeCorners + awayCornersAgainst) / 2;
  const cornersAway = (awayCorners + homeCornersAgainst) / 2;
  const cornersTotal = cornersHome + cornersAway;
  const cardsHome = home?.avgCardsFor ?? CARDS_PRIOR_TOTAL * 0.5;
  const cardsAway = away?.avgCardsFor ?? CARDS_PRIOR_TOTAL * 0.5;
  const cardsTotal = cardsHome + cardsAway;
  const npxgDiff = homeNpxg - awayNpxgConc;
  const pressing = (homePpda + awayPpda) / 2;
  const derbyBoost = input.fixture?.isDerby ? 0.15 : 0;

  // Rivalry multiplier from friction-engine (CONMEBOL KO + ARG-BRA boost)
  const rivalryMult =
    input.rivalryMultiplier ??
    resolveRivalryMultiplier({
      leagueId: input.fixture?.leagueId,
      roundLabel: input.fixture?.roundLabel,
      homeCountry: input.fixture?.homeCountry,
      awayCountry: input.fixture?.awayCountry,
    });

  return {
    npxg_diff: npxgDiff,
    pressing,
    corners_total: cornersTotal,
    corners_home: cornersHome,
    corners_away: cornersAway,
    cards_total: cardsTotal,
    cards_home: cardsHome,
    cards_away: cardsAway,
    home_npxg: homeNpxg,
    away_npxg: awayNpxg,
    derby_boost: derbyBoost,
    rivalry_mult: rivalryMult,
  };
}

function walkTree(node: TreeNode, features: FeatureVector): number {
  if (node.leaf != null && Number.isFinite(node.leaf)) return node.leaf;
  const feat = node.feature;
  if (!feat || node.threshold == null) return 0.5;
  const val = features[feat] ?? 0;
  return val <= node.threshold
    ? walkTree(node.left ?? { leaf: 0.5 }, features)
    : walkTree(node.right ?? { leaf: 0.5 }, features);
}

function treeProb(
  market: MarketType,
  features: FeatureVector,
  model: ModelFile | null
): number | null {
  const tree = model?.trees?.[market];
  if (!tree) return null;
  return clampProb(walkTree(tree, features));
}

function heuristicProbs(
  features: FeatureVector,
  refereeStrictness: number
): Partial<Record<MarketType, number>> {
  const cornersTotal = Math.max(5, features.corners_total);
  const cornersHome = Math.max(2, features.corners_home);
  const cornersAway = Math.max(2, features.corners_away);

  const rivalryMult = features.rivalry_mult ?? 1;

  // Use friction-engine for card lambdas (includes rivalry + press boost)
  const xCard = computeXCard({
    homeAvgCardsFor: features.cards_home,
    awayAvgCardsFor: features.cards_away,
    refereeStrictness,
    // press boost already factored via PPDA → cards_home/away; pass rivalry separately
    leagueId: undefined,
    roundLabel: undefined,
  });
  // Apply rivalry multiplier on top (features already carry it from buildFeatures)
  const xCardHome = xCard.xCardHome * rivalryMult;
  const xCardAway = xCard.xCardAway * rivalryMult;
  const xCardTotal = xCardHome + xCardAway;
  const cardProbs = computeCardProbabilities(xCardHome, xCardAway);

  // Legacy derby_boost fallback for total cards (kept for backwards compat)
  const legacyTotal = Math.max(1.5, features.cards_total * refereeStrictness + features.derby_boost);
  const cardsTotal = xCardTotal > 1.5 ? xCardTotal : legacyTotal;

  const npxgHomeLambda = Math.max(0.4, 1.1 + features.npxg_diff * 0.35);
  const npxgAwayLambda = Math.max(0.4, 1.1 - features.npxg_diff * 0.3);

  return {
    corners_over_8_5: poissonOverProb(cornersTotal, 8.5),
    corners_under_8_5: poissonUnderProb(cornersTotal, 8.5),
    corners_over_9_5: poissonOverProb(cornersTotal, 9.5),
    corners_under_9_5: poissonUnderProb(cornersTotal, 9.5),
    corners_over_10_5: poissonOverProb(cornersTotal, 10.5),
    corners_under_10_5: poissonUnderProb(cornersTotal, 10.5),
    corners_home_over_3_5: poissonOverProb(cornersHome, 3.5),
    corners_away_over_3_5: poissonOverProb(cornersAway, 3.5),
    cards_over_3_5: poissonOverProb(cardsTotal, 3.5),
    cards_under_3_5: poissonUnderProb(cardsTotal, 3.5),
    cards_over_4_5: poissonOverProb(cardsTotal, 4.5),
    cards_under_4_5: poissonUnderProb(cardsTotal, 4.5),
    cards_btts: cardProbs.cards_btts,
    home_over_1_5: poissonOverProb(npxgHomeLambda, 1.5),
    away_over_1_5: poissonOverProb(npxgAwayLambda, 1.5),
  };
}

/** Run secondary-market inference; empty when profiles lack advanced metrics. */
export function predictSecondaryMarkets(
  input: XgboostFixtureInput
): Partial<Record<MarketType, number>> {
  if (!hasAdvancedMetrics(input.homeProfile, input.awayProfile)) return {};

  const features = buildFeatures(input);
  const refereeStrictness = input.refereeStrictness ?? 1;
  const model = loadModel();
  const heuristic = heuristicProbs(features, refereeStrictness);
  const out: Partial<Record<MarketType, number>> = {};

  for (const market of SECONDARY_MARKETS) {
    const fromTree = treeProb(market, features, model);
    out[market] = clampProb(fromTree ?? heuristic[market] ?? 0.5);
  }

  return out;
}

/** Reset model cache (tests). */
export function resetXgboostModelCache(): void {
  cachedModel = undefined;
}
