/**
 * Compatibility shim. The unified auto-calibration engine lives in
 * `lib/auto-tuner.ts`. Keep this file so older imports still resolve.
 */
export {
  LEARNING_RATE,
  MIN_SAMPLE_FULL,
  MIN_SAMPLE_PARTIAL,
  MIN_SETTLEMENT_CALIBRATION_BATCH,
  MIN_TUNING_SAMPLE_SIZE,
  maybeRecalibrateAfterSettlement,
  recalibrateModel,
  resetCalibration,
  sampleAdjustmentAlpha,
  type RecalibrationResult,
  type TuningBucketStat,
} from "./auto-tuner";
