import { NextRequest, NextResponse } from "next/server";
import { authorizeBearerSecret, unauthorizedJson } from "@/lib/auth";
import { errorMessage, jsonError } from "@/lib/api-response";
import {
  bulkUpdateAdvancedMetrics,
  type AdvancedMetricsUpdate,
} from "@/lib/team-profiler";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type BulkBody = {
  updates?: AdvancedMetricsUpdate[];
};

/**
 * POST /api/teams/profiles/bulk-update
 * Idempotent PATCH of advanced TeamProfile metrics (npxG, PPDA, corners, cards).
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
    const result = await bulkUpdateAdvancedMetrics(updates);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(errorMessage(err, "bulk update failed"), 500);
  }
}
