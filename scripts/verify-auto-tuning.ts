/**
 * Smoke: Poisson tuning-config clamps + unified engine sync.
 * Usage: npx tsx scripts/verify-auto-tuning.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import {
  MIN_TUNING_SAMPLE_SIZE,
  calibrateModelParameters,
  deriveTuningConfig,
  sampleAdjustmentAlpha,
} from "../lib/auto-tuner";
import { DEFAULT_MODEL_WEIGHTS } from "../lib/model-weights";
import {
  applyTuningToProbability,
  clampTuningMultiplier,
  getTuningConfig,
  getTuningConfigPath,
  invalidateTuningConfigCache,
  resetTuningConfig,
  saveTuningConfig,
} from "../lib/tuning-config";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(clampTuningMultiplier(0.5) === 0.95, "clamp low");
assert(clampTuningMultiplier(2) === 1.05, "clamp high");
assert(clampTuningMultiplier(Number.NaN) === 1, "clamp nan");
assert(clampTuningMultiplier(1.02) === 1.02, "clamp mid");
assert(MIN_TUNING_SAMPLE_SIZE === 5, "unified min sample is 5");
assert(sampleAdjustmentAlpha(4) === 0, "below min stays 0");

const combined = applyTuningToProbability(
  0.8,
  { leagueId: "39", leagueName: "Premier League" },
  "over_1_5",
  {
    lastCalibratedAt: "x",
    totalBetsAnalyzed: 40,
    leagueMultipliers: { "39": 0.97 },
    marketMultipliers: { OVER_1_5: 1.02 },
  }
);
const expected = 0.8 * Math.min(1.05, Math.max(0.95, 0.97 * 1.02));
assert(Math.abs(combined - expected) < 1e-12, "combined ±5% clamp");

const calibrated = calibrateModelParameters(
  Array.from({ length: 16 }, (_, i) => ({
    league: "Premier League",
    leagueId: "39",
    market: "over_1_5",
    modelProbability: 0.85,
    odds: 1.22,
    outcome: i < 15 ? ("WON" as const) : ("LOST" as const),
  })),
  structuredClone(DEFAULT_MODEL_WEIGHTS)
);
const synced = deriveTuningConfig(calibrated.weights);
for (const value of Object.values(synced.leagueMultipliers)) {
  assert(value >= 0.95 && value <= 1.05, "synced league multiplier in band");
}
for (const value of Object.values(synced.marketMultipliers)) {
  assert(value >= 0.95 && value <= 1.05, "synced market multiplier in band");
}

const filePath = getTuningConfigPath();
mkdirSync(path.dirname(filePath), { recursive: true });
writeFileSync(filePath, "{not-json", "utf8");
invalidateTuningConfigCache();
const fallback = getTuningConfig();
assert(fallback.totalBetsAnalyzed === 0, "corrupt JSON fallback");
assert(Object.keys(fallback.leagueMultipliers).length === 0, "corrupt => empty map");

const restored = resetTuningConfig();
assert(restored.totalBetsAnalyzed === 0, "reset totals");
assert(Object.keys(restored.leagueMultipliers).length === 0, "reset leagues");

saveTuningConfig({
  lastCalibratedAt: "",
  totalBetsAnalyzed: 0,
  leagueMultipliers: {},
  marketMultipliers: {},
});

console.log(
  JSON.stringify(
    {
      ok: true,
      minSample: MIN_TUNING_SAMPLE_SIZE,
      combined,
      fallbackNeutral: true,
      reset: true,
      syncedLeagues: Object.keys(synced.leagueMultipliers).length,
    },
    null,
    2
  )
);
