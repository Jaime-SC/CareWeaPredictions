import { NextResponse } from "next/server";
import { buildAlgorithmHealthReport } from "@/lib/algorithm-health";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/health
 * Bias / calibration breakdowns by market and league.
 */
export async function GET() {
  try {
    const report = await buildAlgorithmHealthReport();
    return NextResponse.json({ success: true, ...report });
  } catch (error) {
    console.error("[api/analytics/health]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error al calcular salud del algoritmo.",
      },
      { status: 500 }
    );
  }
}
