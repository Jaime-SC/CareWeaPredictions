import { NextResponse } from "next/server";
import {
  getApiQuota,
  refreshApiQuotaFromStatus,
} from "@/lib/api-cache";
import { chileDateString } from "@/lib/utils";

/**
 * GET /api/quota
 * Official API-Football daily quota mirrored from response headers
 * (x-ratelimit-requests-limit / x-ratelimit-requests-remaining).
 *
 * If today's row was never synced from headers (legacy local ++ counter),
 * performs one live /status call to overwrite with dashboard values.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceSync = url.searchParams.get("sync") === "1";
    let quota = await getApiQuota(chileDateString());

    if (forceSync || !quota.fromHeaders) {
      const apiKey = process.env.FOOTBALL_API_KEY?.trim();
      if (apiKey) {
        const synced = await refreshApiQuotaFromStatus(apiKey);
        if (synced) quota = { ...synced, fromHeaders: true };
      }
    }

    return NextResponse.json({
      success: true,
      ...quota,
      label: `API Quota: ${quota.used} / ${quota.limit} llamadas hoy · ${quota.remaining} restantes`,
    });
  } catch (error) {
    console.error("[api/quota]", error);
    return NextResponse.json(
      {
        success: false,
        error: "No se pudo leer la cuota diaria de API.",
      },
      { status: 500 }
    );
  }
}
