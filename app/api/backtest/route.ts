import { NextRequest, NextResponse } from "next/server";
import { runHistoricalBacktest } from "@/lib/backtest";
import { errorMessage, jsonError } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET/POST /api/backtest
 * Query/body: { days?: 30|60|90 }
 */
async function handle(request: NextRequest) {
  try {
    let days: number | undefined;
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      days = body?.days != null ? Number(body.days) : undefined;
    } else {
      const q = request.nextUrl.searchParams.get("days");
      days = q != null ? Number(q) : undefined;
    }

    const result = await runHistoricalBacktest({ days });
    return NextResponse.json({
      success: true,
      ...result,
      winRatePct: Number((result.winRate * 100).toFixed(2)),
      roiPct: Number(result.roiPct.toFixed(2)),
    });
  } catch (error) {
    console.error("[api/backtest]", error);
    return jsonError(errorMessage(error, "Error al ejecutar el backtest."));
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
