/**
 * Server-side auto-settlement for PENDING accumulator tickets in SQLite.
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
  isFixtureFinished,
  isFixtureLive,
  isFixtureVoided,
  isKickoffDueForSettlement,
} from "./match-status";
import type { MarketType } from "./types";
import type { BetStatus, HistoryBetLeg, LegStatus } from "./history-tracker";
import { UNIT_STAKE, chileDateString } from "./utils";
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
 * Settle PENDING tickets whose kickoff is already in the past (kickoff < NOW).
 * Always force-refreshes API-Football so yesterday's FT/AET/PEN is not served
 * from a stale NS cache.
 */
export async function settlePendingTickets(): Promise<SettlementResult> {
  const nowMs = Date.now();
  const diagnostics: SettlementDiagnostic[] = [];

  const pendingTickets = await prisma.accumulatorTicket.findMany({
    where: { status: "PENDING" },
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
  let needsLiveRefresh = false;

  for (const ticket of pendingTickets) {
    for (const pred of ticket.predictions) {
      if (pred.outcome !== "PENDING" || pred.fixture.apiFixtureId <= 0) {
        continue;
      }
      // Past-kickoff pending legs only
      if (!isKickoffDueForSettlement(pred.fixture.matchDate, nowMs)) continue;
      apiIds.add(pred.fixture.apiFixtureId);
      kickoffsById[pred.fixture.apiFixtureId] =
        pred.fixture.matchDate.toISOString();
      const st = pred.fixture.status;
      const hasTerminalCache =
        (isFixtureFinished(st) && Boolean(pred.fixture.finalScore)) ||
        isFixtureVoided(st);
      if (!hasTerminalCache) needsLiveRefresh = true;
    }
  }

  let fixtures: FixtureResult[] = [];
  try {
    if (apiIds.size > 0) {
      // Free plan: fetch by Chile civil date (1 call/day), not ?ids= (Pro-only).
      // forceRefresh only when SQLite still lacks FT/void — otherwise reuse cache.
      fixtures = await fetchFixturesByIds(Array.from(apiIds), {
        forceRefresh: needsLiveRefresh,
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
      const kickoffIso = pred.fixture.matchDate.toISOString();
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
        await prisma.matchFixture.update({
          where: { id: pred.fixtureId },
          data: {
            ...(score ? { finalScore: score } : {}),
            ...(statusShort ? { status: statusShort } : {}),
            ...(apiFx.homeName ? { homeTeam: apiFx.homeName } : {}),
            ...(apiFx.awayName ? { awayTeam: apiFx.awayName } : {}),
          },
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
      } else {
        if (pred.fixture.apiFixtureId <= 0) {
          reason = "Sin ID de API-Football para este fixture.";
        } else if (due && !apiFx) {
          reason = `Sin payload API para fixture ${pred.fixture.apiFixtureId} (${label}).`;
          errors.push(reason);
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

      await prisma.prediction.update({
        where: { id: pred.id },
        data: {
          outcome: toDbOutcome(nextLeg),
          ...(nextLeg === "void" ? { odds: 1 } : {}),
        },
      });

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
    const odds = effectiveOdds(legStatuses);
    const stake = ticket.stakeCLP > 0 ? ticket.stakeCLP : UNIT_STAKE;
    const payout =
      nextStatus === "won"
        ? stake * odds
        : nextStatus === "void"
          ? stake
          : 0;

    await prisma.accumulatorTicket.update({
      where: { id: ticket.id },
      data: {
        status: dbStatus,
        totalOdds: odds,
        payoutCLP: payout,
      },
    });
    ticketsUpdated += 1;
    if (nextStatus === "won") ticketsWon += 1;
    else if (nextStatus === "lost") ticketsLost += 1;
    else if (nextStatus === "void") ticketsVoided += 1;
  }

  const metrics = await computeGlobalSettlementMetrics();
  const remainingPending = await prisma.accumulatorTicket.findMany({
    where: { status: "PENDING" },
    include: { predictions: { include: { fixture: true } } },
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
