import { NextRequest, NextResponse } from "next/server";
import { authorizeBearerSecret, unauthorizedJson } from "@/lib/auth";
import { errorMessage, jsonError } from "@/lib/api-response";
import {
  bulkUpsertTimesfmForecasts,
  type TimesfmForecastUpdate,
} from "@/lib/timesfm-forecast";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type BulkBody = {
  updates?: TimesfmForecastUpdate[];
};

/**
 * POST /api/teams/timesfm/bulk-upsert
 * Idempotent upsert of TimesFM t+1 forecasts (PIT asOfDate).
 * Auth: Bearer CRON_SECRET
 */
export async function POST(request: NextRequest) {
  if (!authorizeBearerSecret(request)) return unauthorizedJson();

  let body: BulkBody;
  try {
    body = (await request.json()) as BulkBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const updates = body.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return jsonError("updates array required", 400);
  }

  try {
    const result = await bulkUpsertTimesfmForecasts(updates);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(errorMessage(err, "timesfm bulk upsert failed"), 500);
  }
}
