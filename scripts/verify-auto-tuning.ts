/**
 * Smoke: ultra-conservative auto-tuning safeguards.
 * Usage: npx tsx scripts/verify-auto-tuning.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import {
  applyTuningToProbability,
  clampTuningMultiplier,
  getTuningConfig,
  getTuningConfigPath,
  invalidateTuningConfigCache,
  resetTuningConfig,
  saveTuningConfig,
} from "../lib/tuning-config";
import {
  MIN_TUNING_SAMPLE_SIZE,
  multiplierForSample,
  multiplierFromWinRate,
} from "../lib/auto-tuning";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(clampTuningMultiplier(0.5) === 0.95, "clamp low");
assert(clampTuningMultiplier(2) === 1.05, "clamp high");
assert(clampTuningMultiplier(Number.NaN) === 1, "clamp nan");
assert(clampTuningMultiplier(1.02) === 1.02, "clamp mid");

assert(multiplierFromWinRate(0.64) === 0.95, "wr < 65 => 0.95");
assert(multiplierFromWinRate(0.65) === 0.95, "wr = 65 => 0.95");
assert(Math.abs(multiplierFromWinRate(0.75) - 1) < 1e-12, "wr = 75 => 1.0");
assert(multiplierFromWinRate(0.85) === 1.05, "wr = 85 => 1.05");
assert(multiplierFromWinRate(0.99) === 1.05, "wr > 85 => 1.05");
assert(multiplierForSample(0.4, 19) === 1, "n<20 stays 1.0");
assert(multiplierForSample(0.4, MIN_TUNING_SAMPLE_SIZE) === 0.95, "n>=20 applies");

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
    },
    null,
    2
  )
);
