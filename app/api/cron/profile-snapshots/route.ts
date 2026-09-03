import { NextRequest, NextResponse } from "next/server";
import { authorizeBearerSecret, unauthorizedJson } from "@/lib/auth";
import { errorMessage, jsonError } from "@/lib/api-response";
import { materializeMatchdaySnapshots } from "@/lib/team-profiler";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

/**
 * GET/POST /api/cron/profile-snapshots
 * Materialize TeamProfileSnapshot for the current UTC day (matchDate < now).
 * Auth: Bearer CRON_SECRET
 */
async function handle(request: NextRequest) {
  if (!authorizeBearerSecret(request)) return unauthorizedJson();

  try {
    const asOf = new Date();
    const result = await materializeMatchdaySnapshots(asOf);
    return NextResponse.json({
      success: true,
      asOf: asOf.toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("[api/cron/profile-snapshots]", error);
    return jsonError(errorMessage(error, "Error al materializar snapshots."));
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
