import { NextRequest, NextResponse } from "next/server";
import { authorizeBearerSecret, unauthorizedJson } from "@/lib/auth";
import { errorMessage, jsonError } from "@/lib/api-response";
import {
  bulkUpsertProfileSnapshots,
  type ProfileSnapshotUpdate,
} from "@/lib/team-profiler";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

type BulkBody = {
  updates?: ProfileSnapshotUpdate[];
};

/**
 * POST /api/teams/profiles/snapshot-bulk
 * Idempotent upsert of point-in-time TeamProfileSnapshot rows.
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
    const result = await bulkUpsertProfileSnapshots(updates);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(errorMessage(err, "snapshot bulk failed"), 500);
  }
}
