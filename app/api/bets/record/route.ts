import { NextRequest, NextResponse } from "next/server";
import {
  recordBet,
  recordBetsFromHistory,
  type RecordBetInput,
} from "@/lib/bet-db";
import { errorMessage, jsonError } from "@/lib/api-response";
import { requireMutationAuth } from "@/lib/auth";
import type { HistoryBet } from "@/lib/history-tracker";
import type { StrategyMode } from "@/lib/types";

function isHistoryTicketArray(value: unknown): value is HistoryBet[] {
  return Array.isArray(value) && value.length > 0;
}

function parseSingleBody(
  body: Partial<RecordBetInput>
): RecordBetInput | { error: string } {
  if (!Array.isArray(body.legs) || body.legs.length === 0) {
    return { error: "Body inválido: se requiere legs[] con al menos una selección." };
  }
  if (typeof body.totalOdds !== "number") {
    return { error: "Body inválido: totalOdds es requerido." };
  }
  const unitStake = Number(body.stakeCLP);
  if (!Number.isFinite(unitStake) || unitStake <= 0) {
    return { error: "Indica el monto a apostar en pesos chilenos (CLP)." };
  }
  return {
    date: typeof body.date === "string" ? body.date : undefined,
    mode: body.mode,
    strategyMode: body.strategyMode as StrategyMode | undefined,
    stakeCLP: unitStake,
    totalOdds: body.totalOdds,
    payoutCLP: unitStake * body.totalOdds,
    legs: body.legs.map((leg) => ({
      matchId: String(leg.matchId ?? ""),
      matchLabel: String(leg.matchLabel ?? ""),
      leagueName: String(leg.leagueName ?? ""),
      leagueId: typeof leg.leagueId === "string" ? leg.leagueId : undefined,
      kickoff: String(leg.kickoff ?? ""),
      market: leg.market,
      marketLabel: String(leg.marketLabel ?? ""),
      odds: Number(leg.odds),
      modelProbability:
        typeof leg.modelProbability === "number"
          ? leg.modelProbability
          : undefined,
    })),
  };
}

/**
 * POST /api/bets/record
 * Persist an accumulator or single-pick ticket into Postgres via Prisma.
 * Also accepts `{ tickets: HistoryBet[] }` to sync localStorage leftovers.
 */
export async function POST(request: NextRequest) {
  const denied = requireMutationAuth(request);
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => null)) as
      | (Partial<RecordBetInput> & { tickets?: unknown; parlay?: unknown })
      | null;

    if (!body) {
      return jsonError("Body inválido.", 400);
    }

    if (isHistoryTicketArray(body.tickets)) {
      const results = await recordBetsFromHistory(body.tickets);
      const failed = results.filter((row) => !row.ok);
      return NextResponse.json({
        success: failed.length === 0,
        saved: results.filter((row) => row.ok).length,
        failed: failed.length,
        results,
        error:
          failed.length > 0
            ? failed[0]?.error ?? "Algunos tickets no se pudieron guardar."
            : undefined,
      });
    }

    const parsed = parseSingleBody(body);
    if ("error" in parsed) {
      return jsonError(parsed.error, 400);
    }

    const result = await recordBet(parsed);

    return NextResponse.json({
      success: true,
      ticketId: result.ticketId,
      duplicate: result.duplicate,
      message: result.duplicate
        ? "Ticket pendiente equivalente ya registrado."
        : "Apuesta registrada en la base de datos.",
    });
  } catch (error) {
    console.error("[api/bets/record]", error);
    return jsonError(
      errorMessage(error, "Error al registrar la apuesta en la base de datos.")
    );
  }
}
