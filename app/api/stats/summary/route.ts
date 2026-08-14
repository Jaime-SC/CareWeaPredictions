import { NextRequest, NextResponse } from "next/server";
import {
  buildStatsSummary,
  clearAllBets,
  deleteTicketById,
} from "@/lib/bet-db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/stats/summary
 * Aggregated analytics: by league, by date+market, training export vectors.
 * Settlement runs separately via POST /api/settle (called on stats page load).
 */
export async function GET() {
  try {
    const payload = await buildStatsSummary();
    return NextResponse.json(
      {
        success: true,
        ...payload,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error("[api/stats/summary]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error al calcular estadísticas.",
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/stats/summary
 * Single delete or clear-all. Ticket outcomes come only from settlement.
 * Body:
 *   { action: "delete", ticketId }
 *   | { action: "clear" }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body?.action === "clear") {
      await clearAllBets();
      return NextResponse.json({ success: true, cleared: true });
    }

    if (body?.action === "delete" && body.ticketId) {
      const deleted = await deleteTicketById(String(body.ticketId));
      const payload = await buildStatsSummary();
      return NextResponse.json({
        success: true,
        deleted,
        ...payload,
      });
    }

    return NextResponse.json(
      { success: false, error: "Acción no reconocida." },
      { status: 400 }
    );
  } catch (error) {
    console.error("[api/stats/summary PATCH]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Error al actualizar.",
      },
      { status: 500 }
    );
  }
}
