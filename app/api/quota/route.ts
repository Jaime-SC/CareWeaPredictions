import { NextResponse } from "next/server";
import { getApiQuota } from "@/lib/api-cache";
import { chileDateString } from "@/lib/utils";

/**
 * GET /api/quota
 * Daily API-Football live-call counter (cache hits do not increment).
 */
export async function GET() {
  try {
    const quota = await getApiQuota(chileDateString());
    return NextResponse.json({
      success: true,
      ...quota,
      label: `API Quota: ${quota.used} / ${quota.limit} llamadas hoy`,
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
