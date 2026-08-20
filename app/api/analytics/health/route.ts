import { NextRequest, NextResponse } from "next/server";
import { buildAlgorithmHealthReport } from "@/lib/algorithm-health";
import { buildReadinessReport } from "@/lib/readiness";
import { errorMessage, jsonError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/health
 * Bias / calibration breakdowns by market and league, plus professional
 * readiness gate (ROI, CLV, profit factor, p-value, drawdown).
 * Optional ?bankroll= for max-drawdown as % of a real bankroll.
 */
export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get("bankroll");
    const parsed = raw ? Number(raw) : NaN;
    const initialBankroll = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;

    const [report, readiness] = await Promise.all([
      buildAlgorithmHealthReport(),
      buildReadinessReport(initialBankroll),
    ]);
    return NextResponse.json({ success: true, ...report, readiness });
  } catch (error) {
    console.error("[api/analytics/health]", error);
    return jsonError(
      errorMessage(error, "Error al calcular salud del algoritmo.")
    );
  }
}
