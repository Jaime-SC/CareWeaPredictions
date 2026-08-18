-- AlterTable
ALTER TABLE "Prediction" ADD COLUMN "closingOdds" DOUBLE PRECISION;
ALTER TABLE "Prediction" ADD COLUMN "closingOddsAt" TIMESTAMP(3);
