import { NextRequest, NextResponse } from "next/server";
import {
  fetchHistoricalMatches,
  parseBacktestMarket,
  runPaperBacktest,
} from "@/lib/sources/football-data";
import { errorMessage, jsonError } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Paper-trade backtest from Football-Data.org closing odds + season Poisson.
 *
 * GET ?competition=PL&season=2024&threshold=2&market=ALL
 * market: ALL | 1X2 | OVER_UNDER_2_5 | DNB
 * threshold: ValueMarginPercent minimum (default 2.0)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const competition = (searchParams.get("competition") ?? "PL").trim();
    const seasonRaw = Number(
      searchParams.get("season") ?? new Date().getFullYear() - 1
    );
    const season = Number.isFinite(seasonRaw)
      ? Math.floor(seasonRaw)
      : new Date().getFullYear() - 1;

    const thresholdRaw = Number(searchParams.get("threshold") ?? 2);
    const threshold =
      Number.isFinite(thresholdRaw) && thresholdRaw >= 0
        ? thresholdRaw
        : 2;

    const market = parseBacktestMarket(searchParams.get("market"));

    const matches = await fetchHistoricalMatches(competition, season);
    if (matches.length === 0) {
      return NextResponse.json({
        success: true,
        competition,
        season,
        threshold,
        market,
        nMatches: 0,
        nBets: 0,
        wins: 0,
        stakeUnits: 0,
        returnUnits: 0,
        winRate: 0,
        roi: 0,
        message:
          "Sin partidos. Configura FOOTBALL_DATA_API_KEY o verifica competition/season.",
      });
    }

    const summary = runPaperBacktest(matches, { threshold, market });

    return NextResponse.json({
      success: true,
      competition,
      season,
      ...summary,
    });
  } catch (error) {
    console.error("[api/backtest]", error);
    return jsonError(errorMessage(error, "Error en backtest."));
  }
}
