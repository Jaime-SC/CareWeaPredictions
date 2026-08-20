import { NextRequest, NextResponse } from "next/server";
import { syncOutcomesFromHistory } from "@/lib/bet-db";
import { errorMessage, jsonError } from "@/lib/api-response";
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
      return jsonError("bets[] requerido", 400);
    }

    const updated = await syncOutcomesFromHistory(bets);
    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error("[api/bets/sync-outcomes]", error);
    return jsonError(errorMessage(error, "Error al sincronizar outcomes."));
  }
}
