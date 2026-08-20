import { NextRequest, NextResponse } from "next/server";
import {
  fetchUpcomingMatches,
  toErrorResponse,
} from "@/lib/api-football";
import { enrichMatchesFromLocalData } from "@/lib/fixture-context";
import { chileDateString } from "@/lib/utils";

export const revalidate = 30;

function isValidDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const leagues = searchParams.get("leagues")?.split(",").filter(Boolean);
  const dateParam = searchParams.get("date");
  const daysParam = searchParams.get("days");
  const daysAhead = daysParam ? Number(daysParam) : 0;
  const poolModeParam = searchParams.get("pool");
  const poolMode =
    poolModeParam === "expanded" || poolModeParam === "wide"
      ? poolModeParam
      : poolModeParam === "core"
        ? "core"
        : undefined;

  const date = isValidDate(dateParam) ? dateParam : undefined;

  try {
    const { matches: rawMatches, source, daysFetched, poolMode: usedPool } =
      await fetchUpcomingMatches({
        leagues,
        date,
        daysAhead: date
          ? 0
          : Number.isFinite(daysAhead)
            ? daysAhead
            : 0,
        poolMode,
        expandIfFewerThan: poolMode === "expanded" ? 12 : 10,
      });
    const matches = await enrichMatchesFromLocalData(rawMatches);

    return NextResponse.json({
      success: true,
      source,
      count: matches.length,
      date: date ?? chileDateString(),
      daysAhead: date ? 0 : Number.isFinite(daysAhead) ? daysAhead : 0,
      daysFetched: daysFetched ?? null,
      poolMode: usedPool ?? null,
      matches,
    });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
