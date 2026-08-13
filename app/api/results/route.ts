import {
  fetchFixturesByIds,
  toErrorResponse,
} from "@/lib/api-football";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/results
 * Body: { fixtureIds: number[], kickoffsById?: Record<string, string> }
 * Free plan: resolves scores via /fixtures?date= (Ids parameter is Pro-only).
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

    const kickoffsById: Record<number, string> = {};
    const rawKickoffs = body.kickoffsById;
    if (rawKickoffs && typeof rawKickoffs === "object") {
      for (const [k, v] of Object.entries(rawKickoffs)) {
        const id = Number(k);
        if (Number.isFinite(id) && typeof v === "string" && v) {
          kickoffsById[id] = v;
        }
      }
    }

    // Cap dates indirectly by limiting ids — one date query covers many fixtures
    const capped = fixtureIds.slice(0, 80);
    const fixtures = await fetchFixturesByIds(capped, {
      forceRefresh: true,
      kickoffsById,
    });

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
