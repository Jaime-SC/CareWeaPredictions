import type { BetMode, HistoryBet } from "./history-tracker";
import { remapLocalBetId } from "./history-tracker";
import type { StrategyMode } from "./types";

export type RecordBetPayload = {
  date?: string;
  mode?: BetMode | string;
  strategyMode?: StrategyMode;
  stakeCLP: number;
  totalOdds: number;
  payoutCLP?: number;
  legs: Array<{
    matchId: string;
    matchLabel: string;
    leagueName: string;
    leagueId?: string;
    kickoff: string;
    market: string;
    marketLabel: string;
    odds: number;
    modelProbability?: number;
  }>;
};

export type RecordBetResponse = {
  success: boolean;
  ticketId?: string;
  duplicate?: boolean;
  message?: string;
  error?: string;
  saved?: number;
  failed?: number;
  results?: Array<{
    localId: string;
    ticketId?: string;
    duplicate?: boolean;
    ok: boolean;
    error?: string;
  }>;
};

function asErrorMessage(data: RecordBetResponse, fallback: string): string {
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  return fallback;
}

export async function postBetRecord(
  input: RecordBetPayload
): Promise<RecordBetResponse> {
  const res = await fetch("/api/bets/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as RecordBetResponse;
  if (!res.ok || !data.success) {
    return {
      success: false,
      error: asErrorMessage(
        data,
        "No se pudo guardar la apuesta en la base de datos."
      ),
    };
  }
  return data;
}

export async function syncHistoryBetsToDb(
  tickets: HistoryBet[]
): Promise<RecordBetResponse> {
  if (tickets.length === 0) {
    return { success: true, results: [] };
  }
  const res = await fetch("/api/bets/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickets }),
  });
  const data = (await res.json().catch(() => ({}))) as RecordBetResponse;
  for (const row of data.results ?? []) {
    if (row.ok && row.ticketId) {
      remapLocalBetId(row.localId, row.ticketId);
    }
  }
  if (!res.ok || !data.success) {
    return {
      success: false,
      error: asErrorMessage(
        data,
        "No se pudo sincronizar el historial local con la base de datos."
      ),
      results: data.results,
      saved: data.saved,
      failed: data.failed,
    };
  }
  return data;
}
