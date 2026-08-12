import { NextRequest, NextResponse } from "next/server";
import {
  buildStatsSummary,
  clearAllBets,
  updateTicketStatusInDb,
} from "@/lib/bet-db";
import type { BetStatus } from "@/lib/history-tracker";

/**
 * GET /api/stats/summary
 * Aggregated analytics: by league, by date+market, training export vectors.
 */
export async function GET() {
  try {
    const payload = await buildStatsSummary();
    return NextResponse.json({
      success: true,
      ...payload,
    });
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
 * Manual ticket status override or clear-all.
 * Body: { action: "status", ticketId, status } | { action: "clear" }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body?.action === "clear") {
      await clearAllBets();
      return NextResponse.json({ success: true, cleared: true });
    }

    if (body?.action === "status" && body.ticketId && body.status) {
      const status = body.status as BetStatus;
      if (!["pending", "won", "lost", "void"].includes(status)) {
        return NextResponse.json(
          { success: false, error: "status inválido" },
          { status: 400 }
        );
      }
      await updateTicketStatusInDb(String(body.ticketId), status);
      const payload = await buildStatsSummary();
      return NextResponse.json({ success: true, ...payload });
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
