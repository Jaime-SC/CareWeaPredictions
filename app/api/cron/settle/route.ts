import { NextRequest, NextResponse } from "next/server";
import { settlePendingTickets } from "@/lib/settlement";
import {
  MIN_SETTLEMENT_CALIBRATION_BATCH,
  maybeRecalibrateAfterSettlement,
} from "@/lib/auto-tuner";
import { maybeUpdateBrierLearning } from "@/lib/learning-engine";
import { errorMessage, jsonError } from "@/lib/api-response";
import { env } from "@/lib/env";
import { maybeUpdateTeamProfilesAfterSettlement } from "@/lib/team-profiler";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * GET/POST /api/cron/settle
 * Auto-settle PENDING tickets against finished (FT) match results.
 *
 * Protect with CRON_SECRET header when set:
 *   Authorization: Bearer <CRON_SECRET>
 *   or ?secret=<CRON_SECRET>
 */
function authorize(request: NextRequest): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return true; // open in local/dev when unset
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = request.nextUrl.searchParams.get("secret");
  return q === secret;
}

function calibrationPayload(
  result: Awaited<ReturnType<typeof maybeRecalibrateAfterSettlement>>
) {
  if (!result) return null;
  return {
    leaguesAdjusted: result.leaguesAdjusted,
    marketsAdjusted: result.marketsAdjusted,
    sampleSize: result.sampleSize,
    calibratedAt: result.weights.calibratedAt,
    message: result.message,
  };
}

function brierPayload(
  result: Awaited<ReturnType<typeof maybeUpdateBrierLearning>>
) {
  if (!result) return null;
  return {
    overallMeanBrier: result.overallMeanBrier,
    leaguesAdjusted: result.leaguesAdjusted,
    marketsAdjusted: result.marketsAdjusted,
    teamsAdjusted: result.teamsAdjusted,
    sampleSize: result.sampleSize,
    message: result.message,
  };
}

async function handle(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json(
      { success: false, error: "No autorizado." },
      { status: 401 }
    );
  }

  try {
    const result = await settlePendingTickets();
    const newlySettledCount = result.updatedLegsCount;

    let calibration: Awaited<
      ReturnType<typeof maybeRecalibrateAfterSettlement>
    > = null;
    let brierLearning: Awaited<
      ReturnType<typeof maybeUpdateBrierLearning>
    > = null;

    if (newlySettledCount >= MIN_SETTLEMENT_CALIBRATION_BATCH) {
      // ROI auto-tuner first, then Brier factors (both write model-weights).
      calibration = await maybeRecalibrateAfterSettlement(newlySettledCount);
      brierLearning = await maybeUpdateBrierLearning(newlySettledCount);
    }

    const teamProfiles =
      await maybeUpdateTeamProfilesAfterSettlement(newlySettledCount);

    return NextResponse.json({
      success: result.ok,
      ...result,
      newlySettledCount,
      winRatePct: Number((result.winRate * 100).toFixed(2)),
      roiPct: Number(result.roi.toFixed(2)),
      calibration: calibrationPayload(calibration),
      brierLearning: brierPayload(brierLearning),
      teamProfiles: teamProfiles
        ? {
            teamsUpserted: teamProfiles.teamsUpserted,
            matchesUsed: teamProfiles.matchesUsed,
          }
        : null,
    });
  } catch (error) {
    console.error("[api/cron/settle]", error);
    return jsonError(
      errorMessage(error, "Error al liquidar tickets.")
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
