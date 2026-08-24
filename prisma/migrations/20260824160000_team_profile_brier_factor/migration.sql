-- Brier continuous-learning factor on TeamProfile
ALTER TABLE "TeamProfile" ADD COLUMN IF NOT EXISTS "brierCalibrationFactor" DOUBLE PRECISION NOT NULL DEFAULT 1;
