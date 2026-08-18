import {
  individualPickKey,
  type HistoryBet,
} from "./history-tracker";
import { getStrategyPreset } from "./parlay-defaults";
import { recalculateParlay } from "./parlay-recalc";
import type { GeneratedParlay, SafePickItem, StrategyMode } from "./types";

const LEGACY_BUILDER_PREFIXES = [
  "parleylab_data_",
  "parleylab_mode_",
  "parleylab_parlay_",
];

/** One-shot wipe of the old builder localStorage cache. */
export function purgeLegacyBuilderLocalStorage(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (LEGACY_BUILDER_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) localStorage.removeItem(key);
}

export async function fetchBuilderTickets(): Promise<HistoryBet[]> {
  try {
    const res = await fetch("/api/stats/summary", { cache: "no-store" });
    const data = (await res.json()) as {
      success?: boolean;
      tickets?: HistoryBet[];
    };
    if (!res.ok || !data.success) return [];
    return data.tickets ?? [];
  } catch {
    return [];
  }
}

function newestFirst(a: HistoryBet, b: HistoryBet): number {
  if (a.status === "pending" && b.status !== "pending") return -1;
  if (b.status === "pending" && a.status !== "pending") return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

export function selectParlayTicket(
  tickets: HistoryBet[],
  strategyMode: StrategyMode,
  date: string
): HistoryBet | null {
  return (
    tickets
      .filter(
        (ticket) =>
          ticket.strategyMode === strategyMode &&
          ticket.date === date &&
          ticket.legs.length >= 2
      )
      .sort(newestFirst)[0] ?? null
  );
}

export function selectSafeTickets(
  tickets: HistoryBet[],
  date: string
): HistoryBet[] {
  return tickets
    .filter(
      (ticket) =>
        ticket.strategyMode === "daily-safe" &&
        ticket.date === date &&
        ticket.legs.length === 1
    )
    .sort(newestFirst);
}

export function ticketToParlay(ticket: HistoryBet): GeneratedParlay {
  const preset = getStrategyPreset(ticket.strategyMode);
  const legs = ticket.legs.map((leg) => ({
    matchId: leg.matchId,
    matchLabel: leg.matchLabel,
    leagueName: leg.leagueName,
    kickoff: leg.kickoff,
    market: leg.market,
    marketLabel: leg.marketLabel,
    odds: leg.odds,
    modelProbability: leg.modelProbability ?? 0,
    edge: 0,
  }));
  return recalculateParlay(legs, {
    stake: ticket.stakeCLP || preset.stake,
    strategyMode: ticket.strategyMode,
    strategyLabel: preset.title,
    riskTier: preset.riskTier,
    targetMultiplier: preset.targetMultiplier,
  });
}

export function ticketsToSafePicks(tickets: HistoryBet[]): SafePickItem[] {
  const seen = new Set<string>();
  const picks: SafePickItem[] = [];
  for (const ticket of tickets) {
    const leg = ticket.legs[0];
    if (!leg) continue;
    const key = individualPickKey(leg.matchId, leg.market);
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({
      matchId: leg.matchId,
      matchLabel: leg.matchLabel,
      leagueName: leg.leagueName,
      kickoff: leg.kickoff,
      market: leg.market,
      marketLabel: leg.marketLabel,
      odds: leg.odds,
      modelProbability: leg.modelProbability ?? 0,
      edge: 0,
      stakeCLP: ticket.stakeCLP,
      registered: true,
    });
  }
  return picks;
}

/** Keep already-registered picks and overlay freshly generated ones (new + updated odds). */
export function mergeSafePicks(
  registered: SafePickItem[],
  generated: SafePickItem[]
): SafePickItem[] {
  const byKey = new Map<string, SafePickItem>();
  for (const pick of registered) {
    byKey.set(individualPickKey(pick.matchId, pick.market), pick);
  }
  for (const pick of generated) {
    byKey.set(individualPickKey(pick.matchId, pick.market), pick);
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.modelProbability - a.modelProbability
  );
}
