import { NextRequest, NextResponse } from "next/server";
import { authorizeBearerSecret, unauthorizedJson } from "@/lib/auth";
import { errorMessage, jsonError } from "@/lib/api-response";
import { runOperationalCalibration } from "@/lib/learning-engine";
import { hydrateModelWeightsFromDb } from "@/lib/model-weights";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

/**
 * GET/POST /api/cron/calibrate
 * Walk-forward Brier + ROI tuner with kickoff strictly before now.
 * Auth: Bearer CRON_SECRET
 */
async function handle(request: NextRequest) {
  if (!authorizeBearerSecret(request)) return unauthorizedJson();

  try {
    await hydrateModelWeightsFromDb();
    const asOf = new Date();
    const { brier, tunerSampleSize } = await runOperationalCalibration(asOf);
    return NextResponse.json({
      success: true,
      asOf: asOf.toISOString(),
      tunerSampleSize,
      brierLearning: {
        overallMeanBrier: brier.overallMeanBrier,
        leaguesAdjusted: brier.leaguesAdjusted,
        marketsAdjusted: brier.marketsAdjusted,
        teamsAdjusted: brier.teamsAdjusted,
        sampleSize: brier.sampleSize,
        message: brier.message,
      },
    });
  } catch (error) {
    console.error("[api/cron/calibrate]", error);
    return jsonError(errorMessage(error, "Error al calibrar pesos."));
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
