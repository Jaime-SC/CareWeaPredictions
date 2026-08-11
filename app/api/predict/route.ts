import { NextRequest, NextResponse } from "next/server";
import {
  fetchUpcomingMatches,
  toErrorResponse,
} from "@/lib/api-football";
import {
  isFunStrategy,
  resolveStrategyMode,
} from "@/lib/parlay-defaults";
import { buildMatchPredictions } from "@/lib/parlay-generator";
import { chileDateString } from "@/lib/utils";

function isValidDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * GET /api/predict?date=YYYY-MM-DD&safeOnly=true&minProb=0.85
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("matchId");
  const safeOnly = searchParams.get("safeOnly") === "true";
  const dateParam = searchParams.get("date");
  const date = isValidDate(dateParam) ? dateParam : chileDateString();
  const minProbRaw = Number(searchParams.get("minProb"));
  const minProb =
    Number.isFinite(minProbRaw) && minProbRaw > 0 ? minProbRaw : 0.85;
  const poolParam = searchParams.get("pool");
  const strategyMode = resolveStrategyMode(
    searchParams.get("strategyMode") ?? "daily-safe"
  );

  try {
    const { matches, source, daysFetched, poolMode } =
      await fetchUpcomingMatches({
        date,
        poolMode:
          poolParam === "expanded" || isFunStrategy(strategyMode)
            ? "expanded"
            : "core",
        expandIfFewerThan: 8,
      });

    let predictions = buildMatchPredictions(matches, {
      minSafeProbability: minProb,
      minSafeOdds: 1.15,
      maxSafeOdds: 1.4,
      safeMarketsOnly: true,
    });

    if (matchId) {
      predictions = predictions.filter((p) => p.matchId === matchId);
    }

    if (safeOnly) {
      predictions = predictions.filter((p) => p.bestSafePick !== null);
    }

    const safePicks = predictions
      .flatMap((p) =>
        p.markets
          .filter(
            (m) => m.isSafePick && m.modelProbability >= minProb
          )
          .map((m) => ({
            matchId: p.matchId,
            matchLabel: `${p.match.home.name} vs ${p.match.away.name}`,
            leagueName: p.match.leagueName,
            kickoff: p.match.kickoff,
            expectedGoals: p.expectedGoals,
            market: m.market,
            marketLabel: m.label,
            label: m.label,
            odds: m.odds,
            modelProbability: m.modelProbability,
            impliedProbability: m.impliedProbability,
            edge: m.edge,
            isSafePick: m.isSafePick,
          }))
      )
      .sort((a, b) => b.modelProbability - a.modelProbability);

    return NextResponse.json({
      success: true,
      source,
      date,
      minProb,
      count: predictions.length,
      safePickCount: safePicks.length,
      daysFetched: daysFetched ?? null,
      poolMode: poolMode ?? null,
      predictions,
      safePicks,
    });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const matchIds: string[] | undefined = body.matchIds;
    const date =
      typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : chileDateString();
    const minProb =
      typeof body.minProb === "number" && body.minProb > 0
        ? body.minProb
        : 0.85;

    const { matches, source } = await fetchUpcomingMatches({ date });
    const filtered = matchIds
      ? matches.filter((m) => matchIds.includes(m.id))
      : matches;

    const predictions = buildMatchPredictions(filtered, {
      minSafeProbability: minProb,
      safeMarketsOnly: true,
    });

    return NextResponse.json({
      success: true,
      source,
      date,
      predictions,
    });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
