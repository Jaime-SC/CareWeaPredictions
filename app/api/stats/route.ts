import { NextRequest, NextResponse } from "next/server";
import {
  buildStatsSummary,
  clearAllBets,
  deleteTicketById,
} from "@/lib/bet-db";
import { buildReadinessReport } from "@/lib/readiness";
import { errorMessage, jsonError } from "@/lib/api-response";

/** Uncached — stats must reflect latest settlement outcomes. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/**
 * GET /api/stats — alias of /api/stats/summary (force-dynamic, no-store).
 */
export async function GET() {
  try {
    const [payload, readiness] = await Promise.all([
      buildStatsSummary(),
      buildReadinessReport(),
    ]);
    return NextResponse.json(
      { success: true, ...payload, readiness },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("[api/stats]", error);
    return jsonError(errorMessage(error, "Error al calcular estadísticas."));
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body?.action === "clear") {
      await clearAllBets();
      return NextResponse.json(
        { success: true, cleared: true },
        { headers: NO_STORE }
      );
    }

    if (body?.action === "delete" && body.ticketId) {
      const deleted = await deleteTicketById(String(body.ticketId));
      const payload = await buildStatsSummary();
      return NextResponse.json(
        { success: true, deleted, ...payload },
        { headers: NO_STORE }
      );
    }

    return jsonError("Acción no reconocida.", 400);
  } catch (error) {
    console.error("[api/stats PATCH]", error);
    return jsonError(errorMessage(error, "Error al actualizar."));
  }
}
