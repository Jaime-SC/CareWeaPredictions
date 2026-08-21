import { NextRequest, NextResponse } from "next/server";
import {
  fetchUpcomingMatches,
  toErrorResponse,
} from "@/lib/api-football";
import {
  buildCacheKey,
  getCachedPayload,
  ttlMinutesForFixtureDate,
  upsertCachedPayload,
} from "@/lib/api-cache";
import {
  isFunStrategy,
  resolveStrategyMode,
} from "@/lib/parlay-defaults";
import { enrichMatchesFromLocalData } from "@/lib/fixture-context";
import { buildMatchPredictions } from "@/lib/parlay-generator";
import {
  syncAutomatedTeamProfileFlags,
  warmTeamProfileCache,
} from "@/lib/team-profiler";
import type { MatchPrediction, SafePickItem } from "@/lib/types";
import { chileDateString } from "@/lib/utils";

function isValidDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

type PredictSuccessBody = {
  success: true;
  source: string;
  date: string;
  minProb: number;
  count: number;
  safePickCount: number;
  daysFetched: number | null;
  poolMode: string | null;
  predictions: MatchPrediction[];
  safePicks: SafePickItem[];
  cached?: boolean;
};

/**
 * Optional: &refresh=1 to bypass the computed-payload SQLite cache.
 */
export async function GET(request: NextRequest) {
  try {
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
  const poolMode =
    poolParam === "expanded" || isFunStrategy(strategyMode)
      ? "expanded"
      : "core";
  const forceRefresh = searchParams.get("refresh") === "1";
  const cacheKey = buildCacheKey("predict", {
    date,
    pool: poolMode,
    strategy: strategyMode,
    safe: safeOnly ? "1" : "0",
    minProb,
    matchId: matchId || undefined,
  });

  if (!forceRefresh) {
    const hit = await getCachedPayload<PredictSuccessBody>(cacheKey);
    if (hit?.success && Array.isArray(hit.predictions)) {
      return NextResponse.json({
        ...hit,
        cached: true,
      });
    }
  }

  const { matches: rawMatches, source, daysFetched, poolMode: resolvedPool } =
      await fetchUpcomingMatches({
        date,
        poolMode,
        expandIfFewerThan: 8,
      });
    const matches = await enrichMatchesFromLocalData(rawMatches);
    // Auto DT / key absences → TeamProfile before Poisson λ & calibration
    await syncAutomatedTeamProfileFlags(matches);
    await warmTeamProfileCache(
      matches.flatMap((m) => [m.home.id, m.away.id])
    );

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
            contextFlags: m.contextFlags ?? p.contextFlags,
            contextNotes: p.contextNotes,
            confidenceModifier: m.confidenceModifier,
            referee: p.match.referee ?? null,
            venue: p.match.venue ?? null,
            knockoutContext: m.knockoutContext ?? p.knockoutContext,
          }))
      )
      .sort((a, b) => b.modelProbability - a.modelProbability);

    const body: PredictSuccessBody = {
      success: true,
      source,
      date,
      minProb,
      count: predictions.length,
      safePickCount: safePicks.length,
      daysFetched: daysFetched ?? null,
      poolMode: resolvedPool ?? null,
      predictions,
      safePicks,
    };

    await upsertCachedPayload(
      cacheKey,
      "predict",
      body,
      ttlMinutesForFixtureDate(date)
    );

    return NextResponse.json(body);
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

    const { matches: rawMatches, source } = await fetchUpcomingMatches({
      date,
    });
    const matches = await enrichMatchesFromLocalData(rawMatches);
    await syncAutomatedTeamProfileFlags(matches);
    await warmTeamProfileCache(
      matches.flatMap((m) => [m.home.id, m.away.id])
    );
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
