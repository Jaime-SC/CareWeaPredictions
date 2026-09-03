import { NextRequest, NextResponse } from "next/server";
import { settlePendingTickets } from "@/lib/settlement";
import { errorMessage, jsonError } from "@/lib/api-response";
import { authorizeBearerSecret, unauthorizedJson } from "@/lib/auth";
import { maybeUpdateTeamProfilesAfterSettlement } from "@/lib/team-profiler";
import { hydrateModelWeightsFromDb } from "@/lib/model-weights";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * GET/POST /api/cron/settle
 * Auto-settle PENDING tickets against finished (FT) match results.
 * Calibration lives on /api/cron/calibrate (kickoff < now).
 *
 * Protect with CRON_SECRET when set (production requires it):
 *   Authorization: Bearer <CRON_SECRET>
 */
async function handle(request: NextRequest) {
  if (!authorizeBearerSecret(request)) {
    return unauthorizedJson();
  }

  try {
    await hydrateModelWeightsFromDb();
    const result = await settlePendingTickets();
    const newlySettledCount = result.updatedLegsCount;

    const teamProfiles =
      await maybeUpdateTeamProfilesAfterSettlement(newlySettledCount);

    return NextResponse.json({
      success: result.ok,
      ...result,
      newlySettledCount,
      winRatePct: Number((result.winRate * 100).toFixed(2)),
      roiPct: Number(result.roi.toFixed(2)),
      calibration: null,
      brierLearning: null,
      deferredTo: "/api/cron/calibrate",
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
