import { NextRequest, NextResponse } from "next/server";
import { runReplayBacktest } from "@/lib/backtest-replay";
import { loadSettledPicksForBrier } from "@/lib/learning-engine";
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
 * GET ?competition=PL&season=2024&threshold=3&minOdds=1.4&maxOdds=1.85&market=ALL
 * market: ALL | 1X2 | OVER_UNDER_2_5 | DNB
 * threshold: ValueMarginPercent minimum (default 3.0)
 * minOdds / maxOdds: book line band (default 1.40–1.85)
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

    const thresholdRaw = Number(searchParams.get("threshold") ?? 3);
    const threshold =
      Number.isFinite(thresholdRaw) && thresholdRaw >= 0
        ? thresholdRaw
        : 3;

    const minOddsRaw = Number(searchParams.get("minOdds") ?? 1.4);
    const minOdds =
      Number.isFinite(minOddsRaw) && minOddsRaw > 1 ? minOddsRaw : 1.4;

    const maxOddsRaw = Number(searchParams.get("maxOdds") ?? 1.85);
    const maxOdds =
      Number.isFinite(maxOddsRaw) && maxOddsRaw > minOdds
        ? maxOddsRaw
        : 1.85;

    const market = parseBacktestMarket(searchParams.get("market"));
    const engine = (searchParams.get("engine") ?? "replay").trim().toLowerCase();

    const matches = await fetchHistoricalMatches(competition, season);
    if (matches.length === 0) {
      return NextResponse.json({
        success: true,
        competition,
        season,
        threshold,
        minOdds,
        maxOdds,
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

    const brierRows =
      engine === "replay"
        ? await loadSettledPicksForBrier().catch(() => [])
        : [];

    const summary =
      engine === "legacy"
        ? runPaperBacktest(matches, {
            threshold,
            minOdds,
            maxOdds,
            market,
          })
        : await runReplayBacktest(matches, {
            threshold,
            minOdds,
            maxOdds,
            market,
            competition,
            brierRows,
          });

    return NextResponse.json({
      success: true,
      engine: engine === "legacy" ? "legacy" : "replay",
      competition,
      season,
      ...summary,
    });
  } catch (error) {
    console.error("[api/backtest]", error);
    return jsonError(errorMessage(error, "Error en backtest."));
  }
}
