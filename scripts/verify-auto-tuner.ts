/**
 * Smoke: calibrate from synthetic history and verify weights file.
 * Usage: npx tsx scripts/verify-auto-tuner.ts
 */
import { calibrateModelParameters } from "../lib/auto-tuner";
import {
  DEFAULT_MODEL_WEIGHTS,
  saveModelWeights,
  loadModelWeights,
  invalidateModelWeightsCache,
} from "../lib/model-weights";
import type { HistoricalPickRow } from "../lib/auto-tuner";

const rows: HistoricalPickRow[] = [
  // Underperforming league
  ...Array.from({ length: 8 }, (_, i) => ({
    league: "Serie A",
    market: "over_1_5",
    modelProbability: 0.8,
    odds: 1.28,
    outcome: i < 3 ? ("WON" as const) : ("LOST" as const),
  })),
  // Strong league
  ...Array.from({ length: 10 }, (_, i) => ({
    league: "Premier League",
    market: "1x",
    modelProbability: 0.85,
    odds: 1.22,
    outcome: i < 9 ? ("WON" as const) : ("LOST" as const),
  })),
  // Negative ROI market
  ...Array.from({ length: 8 }, (_, i) => ({
    league: "Ligue 1",
    market: "dnb_away",
    modelProbability: 0.77,
    odds: 1.35,
    outcome: i < 2 ? ("WON" as const) : ("LOST" as const),
  })),
];

const result = calibrateModelParameters(
  rows,
  structuredClone(DEFAULT_MODEL_WEIGHTS)
);
saveModelWeights(result.weights);
invalidateModelWeightsCache();
const loaded = loadModelWeights();

console.log(
  JSON.stringify(
    {
      message: result.message,
      leaguesAdjusted: result.leaguesAdjusted,
      marketsAdjusted: result.marketsAdjusted,
      over15: result.over15MinProbability,
      serieA: loaded.leagues["Serie A"],
      premier: loaded.leagues["Premier League"],
      dnbAway: loaded.markets["dnb_away"],
      persisted: loaded.calibratedAt != null,
    },
    null,
    2
  )
);

// Restore defaults for clean repo state
saveModelWeights(structuredClone(DEFAULT_MODEL_WEIGHTS));
