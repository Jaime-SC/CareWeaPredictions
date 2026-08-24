/**
 * Server-side auto-settlement for PENDING accumulator tickets in Neon.
 * Fetches finished scores (FT / AET / PEN / EXTRA) and evaluates each leg.
 * POSTP / CANC / ABD / SUSP / INT → CANCELLED (void, odds 1.00).
 */
import { prisma } from "./db";
import { fetchFixturesByIds } from "./api-football";
import {
  deriveTicketStatus,
  evaluateMarket,
  type FixtureResult,
} from "./result-checker";
import {
  STALE_UNRESOLVED_DAYS,
  isCivilDateStale,
  isFixtureFinished,
  isFixtureLive,
  isFixtureStaleUnresolved,
  isFixtureVoided,
  isKickoffDueForSettlement,
} from "./match-status";
import type { MarketType } from "./types";
import type { BetStatus, HistoryBetLeg, LegStatus } from "./history-tracker";
import { UNIT_STAKE, chileDateString, toIsoDateTime } from "./utils";
import { computePerformanceMetrics } from "./stats";

export type SettlementDiagnostic = {
  ticketId: string;
  fixtureApiId: number;
  match: string;
  kickoff: string;
  statusShort: string;
  action: "settled" | "voided" | "skipped" | "unresolved";
  reason: string;
  outcome?: string;
};

export type SettlementResult = {
  ok: boolean;
  checkedFixtures: number;
  ticketsScanned: number;
  ticketsUpdated: number;
  ticketsWon: number;
  ticketsLost: number;
  ticketsVoided: number;
  legsSettled: number;
  stillPending: number;
  overduePending: number;
  winRate: number;
  roi: number;
  settledTicketsCount: number;
  updatedLegsCount: number;
  diagnostics: SettlementDiagnostic[];
  errors: string[];
  error?: string;
};

function toDbOutcome(status: LegStatus | BetStatus): string {
  switch (status) {
    case "won":
      return "WON";
    case "lost":
      return "LOST";
    case "void":
      return "VOID"; // CANCELLED / PUSH — stake returned / odds 1.0
    default:
      return "PENDING";
  }
}

function fromDbOutcome(outcome: string): LegStatus {
  switch (outcome.toUpperCase()) {
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

function scoreText(home: number | null, away: number | null): string | null {
  if (home == null || away == null) return null;
  return `${home} - ${away}`;
}

function parseCachedScore(finalScore: string | null): {
  home: number;
  away: number;
} | null {
  if (!finalScore) return null;
  const parts = finalScore.split(/\s*-\s*/).map(Number);
  if (
    parts.length === 2 &&
    Number.isFinite(parts[0]) &&
    Number.isFinite(parts[1])
  ) {
    return { home: parts[0], away: parts[1] };
  }
  return null;
}

function emptyResult(
  extra: Partial<SettlementResult> & { stillPending: number; winRate: number; roi: number }
): SettlementResult {
  const ticketsUpdated = extra.ticketsUpdated ?? 0;
  const legsSettled = extra.legsSettled ?? 0;
  return {
    ok: extra.ok ?? true,
    checkedFixtures: extra.checkedFixtures ?? 0,
    ticketsScanned: extra.ticketsScanned ?? 0,
    ticketsUpdated,
    ticketsWon: extra.ticketsWon ?? 0,
    ticketsLost: extra.ticketsLost ?? 0,
    ticketsVoided: extra.ticketsVoided ?? 0,
    legsSettled,
    stillPending: extra.stillPending,
    overduePending: extra.overduePending ?? extra.stillPending,
    winRate: extra.winRate,
    roi: extra.roi,
    settledTicketsCount: ticketsUpdated,
    updatedLegsCount: legsSettled,
    diagnostics: extra.diagnostics ?? [],
    errors: extra.errors ?? [],
    error: extra.error,
  };
}

function matchLabel(homeTeam: string, awayTeam: string): string {
  return `${homeTeam} vs ${awayTeam}`;
}

function isOverduePendingTicket(
  ticket: {
    date: string;
    predictions: Array<{ outcome: string; fixture: { matchDate: Date } }>;
  },
  nowMs: number
): boolean {
  const today = chileDateString(new Date(nowMs));
  if (ticket.date && ticket.date < today) return true;
  return ticket.predictions.some(
    (pred) =>
      pred.outcome === "PENDING" &&
      isKickoffDueForSettlement(pred.fixture.matchDate, nowMs)
  );
}

/** Global Win Rate % and ROI (1U stake) over settled tickets only (WON / LOST). */
export async function computeGlobalSettlementMetrics(): Promise<{
  winRate: number;
  roi: number;
  won: number;
  lost: number;
  pending: number;
}> {
  const tickets = await prisma.accumulatorTicket.findMany({
    select: { status: true, stakeCLP: true, payoutCLP: true },
  });

  const perf = computePerformanceMetrics(
    tickets.map((t) => ({
      status: t.status,
      stake: t.stakeCLP > 0 ? t.stakeCLP : UNIT_STAKE,
      payout: t.payoutCLP,
    }))
  );

  return {
    winRate: perf.winRate,
    roi: perf.roi,
    won: perf.won,
    lost: perf.lost,
    pending: perf.pending,
  };
}

function effectiveOdds(
  legs: Array<{ status: LegStatus; odds: number }>
): number {
  return legs.reduce((acc, leg) => {
    if (leg.status === "void") return acc * 1;
    return acc * (leg.odds > 0 ? leg.odds : 1);
  }, 1);
}

/**
 * Settle any ticket that still has PENDING legs (kickoff already in the past).
 * Includes combinadas already WON/LOST/VOID: one lost leg closes the ticket,
 * but remaining FT legs must still be evaluated for the history UI and accuracy.
 */
export async function settlePendingTickets(): Promise<SettlementResult> {
  const nowMs = Date.now();
  const diagnostics: SettlementDiagnostic[] = [];

  const pendingTickets = await prisma.accumulatorTicket.findMany({
    where: { predictions: { some: { outcome: "PENDING" } } },
    include: {
      predictions: { include: { fixture: true } },
    },
  });

  if (pendingTickets.length === 0) {
    const metrics = await computeGlobalSettlementMetrics();
    return emptyResult({
      ticketsScanned: 0,
      stillPending: metrics.pending,
      overduePending: 0,
      winRate: metrics.winRate,
      roi: metrics.roi,
    });
  }

  const errors: string[] = [];
  const apiIds = new Set<number>();
  const kickoffsById: Record<number, string> = {};

  for (const ticket of pendingTickets) {
    for (const pred of ticket.predictions) {
      if (pred.outcome !== "PENDING" || pred.fixture.apiFixtureId <= 0) {
        continue;
      }
      // Past-kickoff pending legs only
      if (!isKickoffDueForSettlement(pred.fixture.matchDate, nowMs)) continue;
      apiIds.add(pred.fixture.apiFixtureId);
      kickoffsById[pred.fixture.apiFixtureId] = toIsoDateTime(
        pred.fixture.matchDate
      );
    }
  }

  let fixtures: FixtureResult[] = [];
  try {
    if (apiIds.size > 0) {
      // Always force live refresh for due PENDING legs so tickets do not stick
      // behind a stale CachedApiResponse (uncached settlement).
      fixtures = await fetchFixturesByIds(Array.from(apiIds), {
        forceRefresh: true,
        kickoffsById,
      });
    }
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "No se pudieron obtener resultados de API-Football.";
    errors.push(message);
    // Continue with cached SQLite scores so yesterday's FT still settles.
  }

  const byApiId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  let ticketsUpdated = 0;
  let ticketsWon = 0;
  let ticketsLost = 0;
  let ticketsVoided = 0;
  let legsSettled = 0;

  const fixturePatches = new Map<
    string,
    {
      finalScore?: string;
      status?: string;
      homeTeam?: string;
      awayTeam?: string;
    }
  >();
  const predictionWonIds: string[] = [];
  const predictionLostIds: string[] = [];
  const predictionVoidIds: string[] = [];
  const ticketPatches: Array<{
    id: string;
    status: string;
    totalOdds: number;
    payoutCLP: number;
  }> = [];

  for (const ticket of pendingTickets) {
    const legStatuses: Array<{ status: LegStatus; odds: number }> = [];

    for (const pred of ticket.predictions) {
      const apiFx = byApiId.get(pred.fixture.apiFixtureId);
      let homeGoals: number | null = null;
      let awayGoals: number | null = null;
      let statusShort = pred.fixture.status;
      let finished = isFixtureFinished(statusShort);
      let voided = isFixtureVoided(statusShort);
      let live = isFixtureLive(statusShort);
      const label = matchLabel(pred.fixture.homeTeam, pred.fixture.awayTeam);
      const kickoffIso = toIsoDateTime(pred.fixture.matchDate);
      const due = isKickoffDueForSettlement(pred.fixture.matchDate, nowMs);

      if (apiFx) {
        homeGoals = apiFx.homeGoals;
        awayGoals = apiFx.awayGoals;
        statusShort = apiFx.statusShort || statusShort;
        finished = apiFx.finished || isFixtureFinished(statusShort);
        voided = Boolean(apiFx.voided) || isFixtureVoided(statusShort);
        live = isFixtureLive(statusShort);
      } else {
        const cached = parseCachedScore(pred.fixture.finalScore);
        if (cached && isFixtureFinished(pred.fixture.status)) {
          homeGoals = cached.home;
          awayGoals = cached.away;
          finished = true;
        }
      }

      // Unexpected short code + score + kickoff already past, but not in-play.
      if (
        !finished &&
        !voided &&
        !live &&
        due &&
        homeGoals != null &&
        awayGoals != null
      ) {
        finished = true;
      }

      const score = scoreText(homeGoals, awayGoals);

      if (apiFx && (score || statusShort)) {
        const prev = fixturePatches.get(pred.fixtureId) ?? {};
        fixturePatches.set(pred.fixtureId, {
          ...prev,
          ...(score ? { finalScore: score } : {}),
          ...(statusShort ? { status: statusShort } : {}),
          ...(apiFx.homeName ? { homeTeam: apiFx.homeName } : {}),
          ...(apiFx.awayName ? { awayTeam: apiFx.awayName } : {}),
        });
      }

      const baseDiag = {
        ticketId: ticket.id,
        fixtureApiId: pred.fixture.apiFixtureId,
        match: label,
        kickoff: kickoffIso,
        statusShort: statusShort || "NS",
      };

      if (pred.outcome !== "PENDING") {
        legStatuses.push({
          status: fromDbOutcome(pred.outcome),
          odds: pred.odds,
        });
        continue;
      }

      if (!due && !finished && !voided) {
        diagnostics.push({
          ...baseDiag,
          action: "skipped",
          reason: "Kickoff aún no ocurre.",
        });
        legStatuses.push({ status: "pending", odds: pred.odds });
        continue;
      }

      let nextLeg: LegStatus = "pending";
      let reason = "";

      if (voided) {
        nextLeg = "void";
        reason = `Partido ${statusShort || "anulado"} → CANCELLED (cuota 1.00).`;
      } else if (live) {
        reason = `Partido en curso (${statusShort || "LIVE"}); no se liquida todavía.`;
      } else if (finished && homeGoals != null && awayGoals != null && pred.market) {
        nextLeg = evaluateMarket(
          pred.market as MarketType,
          homeGoals,
          awayGoals
        );
        reason = `Finalizado ${statusShort || "FT"} ${score ?? ""} → ${toDbOutcome(nextLeg)}.`;
      } else if (finished && (homeGoals == null || awayGoals == null)) {
        nextLeg = "void";
        reason = `Finalizado ${statusShort || "FT"} sin marcador usable → CANCELLED.`;
      } else if (
        due &&
        !apiFx &&
        (isFixtureStaleUnresolved(pred.fixture.matchDate, nowMs) ||
          isCivilDateStale(ticket.date, nowMs))
      ) {
        nextLeg = "void";
        reason = `Sin resultado API tras ${STALE_UNRESOLVED_DAYS} días (fixture ${pred.fixture.apiFixtureId}). Anulado.`;
      } else {
        if (pred.fixture.apiFixtureId <= 0) {
          reason = "Sin ID de API-Football para este fixture.";
        } else if (due && !apiFx) {
          reason = `Sin payload API para fixture ${pred.fixture.apiFixtureId} (${label}).`;
        } else {
          reason = `API devolvió ${statusShort || "NS"} sin marcador final.`;
        }
        diagnostics.push({
          ...baseDiag,
          action: "unresolved",
          reason,
        });
        legStatuses.push({ status: "pending", odds: pred.odds });
        continue;
      }

      if (nextLeg === "pending") {
        diagnostics.push({
          ...baseDiag,
          action: "unresolved",
          reason,
        });
        legStatuses.push({ status: "pending", odds: pred.odds });
        continue;
      }

      const dbOutcome = toDbOutcome(nextLeg);
      if (dbOutcome === "WON") predictionWonIds.push(pred.id);
      else if (dbOutcome === "LOST") predictionLostIds.push(pred.id);
      else if (dbOutcome === "VOID") predictionVoidIds.push(pred.id);

      diagnostics.push({
        ...baseDiag,
        action: nextLeg === "void" ? "voided" : "settled",
        reason,
        outcome: toDbOutcome(nextLeg),
      });

      legStatuses.push({
        status: nextLeg,
        odds: nextLeg === "void" ? 1 : pred.odds,
      });
      legsSettled += 1;
    }

    const syntheticLegs = legStatuses.map(
      (leg) => ({ status: leg.status }) as HistoryBetLeg
    );
    const nextStatus = deriveTicketStatus(syntheticLegs);

    if (nextStatus === "pending") {
      continue;
    }

    const dbStatus = toDbOutcome(nextStatus);
    if (ticket.status === dbStatus) {
      continue;
    }

    const odds = effectiveOdds(legStatuses);
    const stake = ticket.stakeCLP > 0 ? ticket.stakeCLP : UNIT_STAKE;
    const payout =
      nextStatus === "won"
        ? stake * odds
        : nextStatus === "void"
          ? stake
          : 0;

    ticketPatches.push({
      id: ticket.id,
      status: dbStatus,
      totalOdds: odds,
      payoutCLP: payout,
    });
    ticketsUpdated += 1;
    if (nextStatus === "won") ticketsWon += 1;
    else if (nextStatus === "lost") ticketsLost += 1;
    else if (nextStatus === "void") ticketsVoided += 1;
  }

  // Neon HTTP rejects Prisma transactions. Avoid Promise.all batches and
  // updateMany/createMany (Prisma 5.22 wraps those in an internal txn).
  for (const [id, data] of fixturePatches) {
    await prisma.matchFixture.update({ where: { id }, data });
  }
  for (const id of predictionWonIds) {
    await prisma.prediction.update({
      where: { id },
      data: { outcome: "WON" },
    });
  }
  for (const id of predictionLostIds) {
    await prisma.prediction.update({
      where: { id },
      data: { outcome: "LOST" },
    });
  }
  for (const id of predictionVoidIds) {
    await prisma.prediction.update({
      where: { id },
      data: { outcome: "VOID", odds: 1 },
    });
  }
  for (const patch of ticketPatches) {
    await prisma.accumulatorTicket.update({
      where: { id: patch.id },
      data: {
        status: patch.status,
        totalOdds: patch.totalOdds,
        payoutCLP: patch.payoutCLP,
      },
    });
  }

  const metrics = await computeGlobalSettlementMetrics();
  const remainingPending = await prisma.accumulatorTicket.findMany({
    where: { status: "PENDING" },
    select: {
      date: true,
      predictions: {
        select: {
          outcome: true,
          fixture: { select: { matchDate: true } },
        },
      },
    },
  });
  const overdueRemaining = remainingPending.filter((t) =>
    isOverduePendingTicket(t, nowMs)
  ).length;

  return {
    ok:
      ticketsUpdated > 0 ||
      errors.length === 0 ||
      fixtures.length > 0,
    checkedFixtures: fixtures.length,
    ticketsScanned: pendingTickets.length,
    ticketsUpdated,
    ticketsWon,
    ticketsLost,
    ticketsVoided,
    legsSettled,
    stillPending: metrics.pending,
    overduePending: overdueRemaining,
    winRate: metrics.winRate,
    roi: metrics.roi,
    settledTicketsCount: ticketsUpdated,
    updatedLegsCount: legsSettled,
    diagnostics,
    errors,
    error: errors[0],
  };
}
