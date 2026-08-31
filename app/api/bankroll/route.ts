import { NextRequest, NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/api-response";
import { requireMutationAuth } from "@/lib/auth";
import {
  adjustBankrollTotal,
  debitBankrollTotal,
  getOrCreateBankroll,
  patchBankrollSettings,
  putBankroll,
  refundBankrollTotal,
  setBankrollTotal,
  type BankrollRow,
} from "@/lib/bankroll-db";

function jsonSettings(row: BankrollRow, extra?: Record<string, unknown>) {
  return NextResponse.json({
    success: true as const,
    settings: {
      totalBankroll: row.totalBankroll,
      currency: row.currency,
      minBookmakerStake: row.minBookmakerStake,
      maxRiskSingle: row.maxRiskSingle,
      maxRiskParlay: row.maxRiskParlay,
    },
    virgin: row.virgin,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    ...extra,
  });
}

/**
 * GET /api/bankroll — singleton settings (creates defaults if missing).
 */
export async function GET() {
  try {
    const row = await getOrCreateBankroll();
    return jsonSettings(row);
  } catch (error) {
    console.error("[api/bankroll GET]", error);
    return jsonError(
      errorMessage(error, "Error al leer la banca.")
    );
  }
}

/**
 * PUT /api/bankroll — replace full settings.
 */
export async function PUT(request: NextRequest) {
  const denied = requireMutationAuth(request);
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonError("Body inválido.", 400);
    }
    const row = await putBankroll(body);
    return jsonSettings(row);
  } catch (error) {
    console.error("[api/bankroll PUT]", error);
    return jsonError(
      errorMessage(error, "Error al guardar la banca.")
    );
  }
}

type PatchBody =
  | { op: "set"; totalBankroll: number }
  | { op: "adjust"; delta: number }
  | { op: "debit"; amount: number }
  | { op: "refund"; amount: number }
  | { op: "patch"; totalBankroll?: number; currency?: string; minBookmakerStake?: number; maxRiskSingle?: number; maxRiskParlay?: number };

/**
 * PATCH /api/bankroll — atomic set / adjust / debit / refund / patch.
 */
export async function PATCH(request: NextRequest) {
  const denied = requireMutationAuth(request);
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => null)) as PatchBody | null;
    if (!body || typeof body !== "object" || !("op" in body)) {
      return jsonError("Body inválido: se requiere op.", 400);
    }

    switch (body.op) {
      case "set": {
        if (typeof body.totalBankroll !== "number") {
          return jsonError("Body inválido: totalBankroll.", 400);
        }
        return jsonSettings(await setBankrollTotal(body.totalBankroll));
      }
      case "adjust": {
        if (typeof body.delta !== "number") {
          return jsonError("Body inválido: delta.", 400);
        }
        return jsonSettings(await adjustBankrollTotal(body.delta));
      }
      case "debit": {
        if (typeof body.amount !== "number") {
          return jsonError("Body inválido: amount.", 400);
        }
        const result = await debitBankrollTotal(body.amount);
        if (!result.ok) {
          return NextResponse.json(
            {
              success: false as const,
              error:
                result.reason === "insufficient"
                  ? "Banca insuficiente."
                  : "Monto inválido.",
              reason: result.reason,
              settings: {
                totalBankroll: result.settings.totalBankroll,
                currency: result.settings.currency,
                minBookmakerStake: result.settings.minBookmakerStake,
                maxRiskSingle: result.settings.maxRiskSingle,
                maxRiskParlay: result.settings.maxRiskParlay,
              },
            },
            { status: 409 }
          );
        }
        return jsonSettings(result.settings);
      }
      case "refund": {
        if (typeof body.amount !== "number") {
          return jsonError("Body inválido: amount.", 400);
        }
        return jsonSettings(await refundBankrollTotal(body.amount));
      }
      case "patch": {
        const { op: _op, ...patch } = body;
        return jsonSettings(await patchBankrollSettings(patch));
      }
      default:
        return jsonError("op desconocida.", 400);
    }
  } catch (error) {
    console.error("[api/bankroll PATCH]", error);
    return jsonError(
      errorMessage(error, "Error al actualizar la banca.")
    );
  }
}
