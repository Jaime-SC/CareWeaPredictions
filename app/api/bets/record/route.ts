import { NextRequest, NextResponse } from "next/server";
import { recordBet, type RecordBetInput } from "@/lib/bet-db";
import type { StrategyMode } from "@/lib/types";

/**
 * POST /api/bets/record
 * Persist an accumulator or single-pick ticket into SQLite via Prisma.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | (Partial<RecordBetInput> & { parlay?: unknown })
      | null;

    if (!body || !Array.isArray(body.legs) || body.legs.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Body inválido: se requiere legs[] con al menos una selección.",
        },
        { status: 400 }
      );
    }

    if (
      typeof body.stakeCLP !== "number" ||
      typeof body.totalOdds !== "number" ||
      typeof body.payoutCLP !== "number"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Body inválido: stakeCLP, totalOdds y payoutCLP son requeridos.",
        },
        { status: 400 }
      );
    }

    const result = await recordBet({
      date: typeof body.date === "string" ? body.date : undefined,
      mode: body.mode,
      strategyMode: body.strategyMode as StrategyMode | undefined,
      stakeCLP: body.stakeCLP,
      totalOdds: body.totalOdds,
      payoutCLP: body.payoutCLP,
      legs: body.legs.map((leg) => ({
        matchId: String(leg.matchId ?? ""),
        matchLabel: String(leg.matchLabel ?? ""),
        leagueName: String(leg.leagueName ?? ""),
        leagueId:
          typeof leg.leagueId === "string" ? leg.leagueId : undefined,
        kickoff: String(leg.kickoff ?? ""),
        market: leg.market,
        marketLabel: String(leg.marketLabel ?? ""),
        odds: Number(leg.odds),
        modelProbability:
          typeof leg.modelProbability === "number"
            ? leg.modelProbability
            : undefined,
      })),
    });

    return NextResponse.json({
      success: true,
      ticketId: result.ticketId,
      duplicate: result.duplicate,
      message: result.duplicate
        ? "Ticket pendiente equivalente ya registrado."
        : "Apuesta registrada en SQLite.",
    });
  } catch (error) {
    console.error("[api/bets/record]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error al registrar la apuesta en la base de datos.",
      },
      { status: 500 }
    );
  }
}
