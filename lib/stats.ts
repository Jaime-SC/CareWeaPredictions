/**
 * Performance metrics over accumulator tickets.
 * Win Rate, ROI and P&L use ONLY settled tickets (WON / LOST).
 * PENDING (en juego) and VOID never enter those denominators.
 */

export type StatsTicketStatus = "pending" | "won" | "lost" | "void";

export interface PerformanceTicket {
  status: string;
  stake: number;
  payout: number;
}

export interface PerformanceMetrics {
  won: number;
  lost: number;
  pending: number;
  voided: number;
  /** WON + LOST — the only tickets that count toward WR / ROI */
  settled: number;
  totalTickets: number;
  /** Stake sum of settled tickets only */
  totalStaked: number;
  /** Σ(payout − stake) for WON − Σ(stake) for LOST */
  netProfit: number;
  /** netProfit / totalStaked * 100 (settled only) */
  roi: number;
  /** won / (won + lost) */
  winRate: number;
}

export function normalizeTicketStatus(status: string): StatsTicketStatus {
  switch (status.trim().toUpperCase()) {
    case "WON":
      return "won";
    case "LOST":
      return "lost";
    case "VOID":
    case "PUSH":
    case "CANCELLED":
      return "void";
    default:
      return "pending";
  }
}

export function isSettledStatus(status: string): boolean {
  const s = normalizeTicketStatus(status);
  return s === "won" || s === "lost";
}

export function isPendingStatus(status: string): boolean {
  return normalizeTicketStatus(status) === "pending";
}

export function partitionBySettlement<T extends { status: string }>(
  tickets: T[]
): { settled: T[]; pending: T[]; voided: T[] } {
  const settled: T[] = [];
  const pending: T[] = [];
  const voided: T[] = [];

  for (const ticket of tickets) {
    const status = normalizeTicketStatus(ticket.status);
    if (status === "won" || status === "lost") settled.push(ticket);
    else if (status === "void") voided.push(ticket);
    else pending.push(ticket);
  }

  return { settled, pending, voided };
}

/**
 * Win Rate % = GANADOS / (GANADOS + PERDIDOS)
 * ROI % = netProfit / stakeSettled
 * Pending tickets are counted but excluded from both formulas.
 */
export function computePerformanceMetrics(
  tickets: PerformanceTicket[]
): PerformanceMetrics {
  let won = 0;
  let lost = 0;
  let pending = 0;
  let voided = 0;
  let totalStaked = 0;
  let netProfit = 0;

  for (const ticket of tickets) {
    const status = normalizeTicketStatus(ticket.status);
    const stake = ticket.stake > 0 ? ticket.stake : 0;

    if (status === "pending") {
      pending += 1;
      continue;
    }
    if (status === "void") {
      voided += 1;
      continue;
    }

    totalStaked += stake;
    if (status === "won") {
      won += 1;
      netProfit += ticket.payout - stake;
    } else {
      lost += 1;
      netProfit -= stake;
    }
  }

  const settled = won + lost;
  return {
    won,
    lost,
    pending,
    voided,
    settled,
    totalTickets: tickets.length,
    totalStaked,
    netProfit,
    roi: totalStaked > 0 ? (netProfit / totalStaked) * 100 : 0,
    winRate: settled > 0 ? won / settled : 0,
  };
}
