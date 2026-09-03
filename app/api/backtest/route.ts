import { NextRequest, NextResponse } from "next/server";
import { loadHistoricalDataFromDb } from "@/lib/auto-tuner";
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
export const maxDuration = 120;

function deltaNum(a?: number, b?: number): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  return Number((a - b).toFixed(4));
}

/**
 * Paper-trade / walk-forward backtest from Football-Data.org.
 *
 * GET ?competition=PL&season=2024&threshold=3&minOdds=1.4&maxOdds=1.85&market=ALL
 * engine: replay (default) | compare
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

    if (engine === "legacy") {
      return NextResponse.json(
        {
          success: false,
          error: "engine=legacy is retired (season-wide leakage).",
          hint: "use engine=replay (default) or engine=compare",
        },
        { status: 400 }
      );
    }

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
        engine,
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

    const opts = { threshold, minOdds, maxOdds, market };

    if (engine === "compare") {
      const [brierRows, tunerRows] = await Promise.all([
        loadSettledPicksForBrier().catch(() => []),
        loadHistoricalDataFromDb().catch(() => []),
      ]);
      const legacy = runPaperBacktest(matches, opts);
      const replay = await runReplayBacktest(matches, {
        ...opts,
        competition,
        brierRows,
        tunerRows,
      });
      return NextResponse.json({
        success: true,
        engine: "compare",
        competition,
        season,
        legacy,
        replay,
        delta: {
          roi: deltaNum(replay.roi, legacy.roi),
          winRate: deltaNum(replay.winRate, legacy.winRate),
          meanBrier: deltaNum(replay.meanBrier, legacy.meanBrier),
          meanLogLoss: deltaNum(replay.meanLogLoss, legacy.meanLogLoss),
          nBets: replay.nBets - legacy.nBets,
        },
      });
    }

    const [brierRows, tunerRows] = await Promise.all([
      loadSettledPicksForBrier().catch(() => []),
      loadHistoricalDataFromDb().catch(() => []),
    ]);
    const summary = await runReplayBacktest(matches, {
      ...opts,
      competition,
      brierRows,
      tunerRows,
    });

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
