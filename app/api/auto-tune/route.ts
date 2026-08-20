import { NextResponse } from "next/server";
import { recalibrateModel, resetCalibration } from "@/lib/auto-tuner";
import { errorMessage, jsonError } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/**
 * POST /api/auto-tune
 * Unified recalibration: model-weights.json + Poisson tuning-config.json.
 */
export async function POST() {
  try {
    const result = await recalibrateModel();
    return NextResponse.json(
      {
        success: true,
        lastCalibratedAt: result.config.lastCalibratedAt,
        totalBetsAnalyzed: result.totalBetsAnalyzed,
        leaguesAdjusted: result.leaguesAdjusted,
        marketsAdjusted: result.marketsAdjusted,
        skippedLowSample: result.skippedLowSample,
        leagueMultipliers: result.config.leagueMultipliers,
        marketMultipliers: result.config.marketMultipliers,
        over15MinProbability: result.over15MinProbability,
        message: result.message,
        leagues: result.leagues,
        markets: result.markets,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[api/auto-tune POST]", error);
    return jsonError(
      errorMessage(error, "Error al recalibrar los multiplicadores."),
      500,
      undefined,
      { headers: NO_STORE_HEADERS }
    );
  }
}

/**
 * DELETE /api/auto-tune
 * Emergency reset: wipe model-weights and Poisson multipliers to factory 1.0.
 */
export async function DELETE() {
  try {
    const { weights, config } = resetCalibration();
    return NextResponse.json(
      {
        success: true,
        reset: true,
        lastCalibratedAt: config.lastCalibratedAt,
        totalBetsAnalyzed: config.totalBetsAnalyzed,
        leagueMultipliers: config.leagueMultipliers,
        marketMultipliers: config.marketMultipliers,
        weights,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[api/auto-tune DELETE]", error);
    return jsonError(
      errorMessage(error, "Error al restaurar los multiplicadores de fábrica."),
      500,
      undefined,
      { headers: NO_STORE_HEADERS }
    );
  }
}
