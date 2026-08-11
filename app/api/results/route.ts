import {
  fetchFixturesByIds,
  toErrorResponse,
} from "@/lib/api-football";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/results
 * Body: { fixtureIds: number[] }
 * Returns real API-Football fixture statuses and final scores.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawIds = Array.isArray(body.fixtureIds) ? body.fixtureIds : [];
    const fixtureIds = rawIds
      .map((id: unknown) => Number(id))
      .filter((id: number) => Number.isFinite(id) && id > 0);

    if (fixtureIds.length === 0) {
      return NextResponse.json({ success: true, fixtures: [] });
    }

    // Cap to protect free-plan rate limits
    const capped = fixtureIds.slice(0, 40);
    const fixtures = await fetchFixturesByIds(capped);

    return NextResponse.json({
      success: true,
      fixtures,
      requested: fixtureIds.length,
      returned: fixtures.length,
    });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
