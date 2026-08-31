import { NextRequest, NextResponse } from "next/server";
import {
  normalizeTrainingRows,
  recalibrateModel,
} from "@/lib/auto-tuner";
import { loadModelWeights, hydrateModelWeightsFromDb } from "@/lib/model-weights";
import { errorMessage, jsonError } from "@/lib/api-response";
import { requireMutationAuth } from "@/lib/auth";

/**
 * GET /api/model/calibrate — current calibrated weights snapshot.
 */
export async function GET() {
  try {
    const weights = await hydrateModelWeightsFromDb();
    return NextResponse.json({
      success: true,
      autoCalibration: true,
      calibratedAt: weights.calibratedAt,
      sampleSize: weights.sampleSize,
      leaguesAdjusted: weights.summary.leaguesAdjusted,
      marketsAdjusted: weights.summary.marketsAdjusted,
      message: weights.summary.message,
      weights,
    });
  } catch (error) {
    console.error("[api/model/calibrate GET]", error);
    return jsonError(
      errorMessage(error, "No se pudieron leer los pesos del modelo.")
    );
  }
}

/**
 * POST /api/model/calibrate
 * Force-recalibrate from SQLite (+ optional exported featureVectors in body).
 */
export async function POST(request: NextRequest) {
  const denied = requireMutationAuth(request);
  if (denied) return denied;

  try {
    await hydrateModelWeightsFromDb();
    const body = await request.json().catch(() => ({}));
    const extraRows = normalizeTrainingRows(
      body?.featureVectors ?? body?.rows ?? body?.trainingExport ?? []
    );

    const result = await recalibrateModel({
      extraRows,
      jsonPath:
        typeof body?.jsonPath === "string" ? body.jsonPath : undefined,
    });

    return NextResponse.json({
      success: true,
      autoCalibration: true,
      message: result.message,
      leaguesAdjusted: result.leaguesAdjusted,
      marketsAdjusted: result.marketsAdjusted,
      sampleSize: result.sampleSize,
      calibratedAt: result.weights.calibratedAt,
      over15MinProbability: result.over15MinProbability,
      weights: result.weights,
    });
  } catch (error) {
    console.error("[api/model/calibrate POST]", error);
    return jsonError(errorMessage(error, "Error al recalibrar el modelo."));
  }
}
