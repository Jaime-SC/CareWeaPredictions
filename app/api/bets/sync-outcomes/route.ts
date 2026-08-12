import { NextRequest, NextResponse } from "next/server";
import { syncOutcomesFromHistory } from "@/lib/bet-db";
import type { HistoryBet } from "@/lib/history-tracker";

/**
 * POST /api/bets/sync-outcomes
 * Push client-evaluated leg/ticket outcomes into SQLite after API-Football checks.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const bets = (body?.bets ?? []) as HistoryBet[];
    if (!Array.isArray(bets)) {
      return NextResponse.json(
        { success: false, error: "bets[] requerido" },
        { status: 400 }
      );
    }

    const updated = await syncOutcomesFromHistory(bets);
    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error("[api/bets/sync-outcomes]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error al sincronizar outcomes.",
      },
      { status: 500 }
    );
  }
}
