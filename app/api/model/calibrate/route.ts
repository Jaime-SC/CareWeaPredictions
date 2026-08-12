import { NextRequest, NextResponse } from "next/server";
import {
  normalizeTrainingRows,
  runAutoCalibration,
} from "@/lib/auto-tuner";
import { loadModelWeights } from "@/lib/model-weights";

/**
 * GET /api/model/calibrate — current calibrated weights snapshot.
 */
export async function GET() {
  try {
    const weights = loadModelWeights();
    return NextResponse.json({ success: true, weights });
  } catch (error) {
    console.error("[api/model/calibrate GET]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudieron leer los pesos del modelo.",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/model/calibrate
 * Recalibrate from SQLite (+ optional exported featureVectors in body).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const extraRows = normalizeTrainingRows(
      body?.featureVectors ?? body?.rows ?? body?.trainingExport ?? []
    );

    const result = await runAutoCalibration({
      extraRows,
      jsonPath:
        typeof body?.jsonPath === "string" ? body.jsonPath : undefined,
    });

    return NextResponse.json({
      success: true,
      message: result.message,
      leaguesAdjusted: result.leaguesAdjusted,
      marketsAdjusted: result.marketsAdjusted,
      sampleSize: result.sampleSize,
      over15MinProbability: result.over15MinProbability,
      weights: result.weights,
    });
  } catch (error) {
    console.error("[api/model/calibrate POST]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error al recalibrar el modelo.",
      },
      { status: 500 }
    );
  }
}
