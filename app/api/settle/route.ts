import { NextResponse } from "next/server";
import { maybeRecalibrateAfterSettlement } from "@/lib/auto-tuner";
import { errorMessage, jsonError } from "@/lib/api-response";
import { settlePendingTickets } from "@/lib/settlement";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/**
 * POST /api/settle
 * Force-sync PENDING tickets against live API-Football scores (FT/AET/PEN/EXTRA)
 * and void POSTP/CANC/ABD/SUSP/INT as CANCELLED (odds 1.00).
 */
export async function POST() {
  try {
    const result = await settlePendingTickets();
    const calibration = await maybeRecalibrateAfterSettlement(
      result.updatedLegsCount
    );
    return NextResponse.json(
      {
        success: result.ok,
        settledTicketsCount: result.settledTicketsCount,
        updatedLegsCount: result.updatedLegsCount,
        ticketsWon: result.ticketsWon,
        ticketsLost: result.ticketsLost,
        ticketsVoided: result.ticketsVoided,
        stillPending: result.stillPending,
        overduePending: result.overduePending,
        checkedFixtures: result.checkedFixtures,
        ticketsScanned: result.ticketsScanned,
        diagnostics: result.diagnostics,
        errors: result.errors,
        error: result.error,
        winRatePct: Number((result.winRate * 100).toFixed(2)),
        roiPct: Number(result.roi.toFixed(2)),
        calibration: calibration
          ? {
              leaguesAdjusted: calibration.leaguesAdjusted,
              marketsAdjusted: calibration.marketsAdjusted,
              sampleSize: calibration.sampleSize,
              calibratedAt: calibration.weights.calibratedAt,
              message: calibration.message,
            }
          : null,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[api/settle]", error);
    return jsonError(errorMessage(error, "Error al sincronizar marcadores."), 500, {
      settledTicketsCount: 0,
      updatedLegsCount: 0,
      ticketsWon: 0,
      ticketsLost: 0,
      ticketsVoided: 0,
      diagnostics: [],
      errors: [
        error instanceof Error
          ? error.message
          : "Error al sincronizar marcadores.",
      ],
    }, { headers: NO_STORE_HEADERS });
  }
}

export async function GET() {
  return POST();
}
