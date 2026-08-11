import { NextRequest, NextResponse } from "next/server";
import {
  fetchUpcomingMatches,
  toErrorResponse,
} from "@/lib/api-football";
import {
  getStrategyPreset,
  isFunStrategy,
  resolveStrategyMode,
} from "@/lib/parlay-defaults";
import {
  formatParlayClipboard,
  generateParlay,
} from "@/lib/parlay-generator";
import { chileDateString } from "@/lib/utils";

/**
 * One-click fun accumulator generator for a specific date.
 * Body/query: { strategyMode, date }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return buildAutoParlayResponse(body?.strategyMode, body?.date);
}

export async function GET(request: NextRequest) {
  const strategyMode = request.nextUrl.searchParams.get("strategyMode");
  const date = request.nextUrl.searchParams.get("date");
  return buildAutoParlayResponse(strategyMode, date);
}

async function buildAutoParlayResponse(
  strategyModeRaw: unknown,
  dateRaw: unknown
) {
  try {
    const strategyMode = resolveStrategyMode(strategyModeRaw);
    // Safe mode no longer builds parlays — clients should use /api/predict
    if (!isFunStrategy(strategyMode)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Modo Segura usa picks individuales. Consulta /api/predict?safeOnly=true.",
          code: "SAFE_MODE_SINGLES",
        },
        { status: 400 }
      );
    }

    const date =
      typeof dateRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
        ? dateRaw
        : chileDateString();

    const preset = getStrategyPreset(strategyMode);
    const config = { ...preset };
    const { matches, source, daysFetched, poolMode } =
      await fetchUpcomingMatches({
        date,
        poolMode: "expanded",
        expandIfFewerThan: 12,
      });
    const parlay = generateParlay(matches, config);
    const clipboard = formatParlayClipboard(parlay);

    return NextResponse.json({
      success: true,
      source,
      date,
      config,
      daysAhead: 0,
      daysFetched: daysFetched ?? null,
      poolMode: poolMode ?? null,
      matchPoolSize: matches.length,
      parlay,
      clipboard,
    });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
