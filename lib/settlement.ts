/**
 * Server-side auto-settlement for PENDING accumulator tickets in SQLite.
 * Fetches finished scores (FT) and evaluates each leg via result-checker rules.
 */
import { prisma } from "./db";
import { fetchFixturesByIds } from "./api-football";
import {
  deriveTicketStatus,
  evaluateMarket,
  isFixtureFinished,
  type FixtureResult,
} from "./result-checker";
import type { MarketType } from "./types";
import type { BetStatus, HistoryBetLeg, LegStatus } from "./history-tracker";
import { UNIT_STAKE } from "./utils";

export type SettlementResult = {
  ok: boolean;
  checkedFixtures: number;
  ticketsScanned: number;
  ticketsUpdated: number;
  legsSettled: number;
  stillPending: number;
  winRate: number;
  roi: number;
  error?: string;
};

function toDbOutcome(status: LegStatus | BetStatus): string {
  switch (status) {
    case "won":
      return "WON";
    case "lost":
      return "LOST";
    case "void":
      return "VOID"; // DNB draw = PUSH (stake returned / odds 1.0)
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
      return "void";
    default:
      return "pending";
  }
}

function scoreText(home: number | null, away: number | null): string | null {
  if (home == null || away == null) return null;
  return `${home} - ${away}`;
}

/** Global Win Rate % and ROI (1U stake) over settled tickets. */
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

  let won = 0;
  let lost = 0;
  let pending = 0;
  let staked = 0;
  let profit = 0;

  for (const t of tickets) {
    const status = t.status.toUpperCase();
    const stake = t.stakeCLP > 0 ? t.stakeCLP : UNIT_STAKE;
    if (status === "PENDING") {
      pending += 1;
      continue;
    }
    staked += stake;
    if (status === "WON") {
      won += 1;
      profit += t.payoutCLP - stake;
    } else if (status === "LOST") {
      lost += 1;
      profit -= stake;
    }
    // VOID / PUSH: stake returned → 0 PnL
  }

  const decided = won + lost;
  return {
    winRate: decided > 0 ? won / decided : 0,
    roi: staked > 0 ? (profit / staked) * 100 : 0,
    won,
    lost,
    pending,
  };
}

/**
 * Settle all PENDING tickets whose fixtures have finished (status FT etc.).
 */
export async function settlePendingTickets(): Promise<SettlementResult> {
  const pendingTickets = await prisma.accumulatorTicket.findMany({
    where: { status: "PENDING" },
    include: {
      predictions: { include: { fixture: true } },
    },
  });

  if (pendingTickets.length === 0) {
    const metrics = await computeGlobalSettlementMetrics();
    return {
      ok: true,
      checkedFixtures: 0,
      ticketsScanned: 0,
      ticketsUpdated: 0,
      legsSettled: 0,
      stillPending: metrics.pending,
      winRate: metrics.winRate,
      roi: metrics.roi,
    };
  }

  const apiIds = new Set<number>();
  for (const ticket of pendingTickets) {
    for (const pred of ticket.predictions) {
      if (
        pred.outcome === "PENDING" &&
        pred.fixture.apiFixtureId > 0
      ) {
        apiIds.add(pred.fixture.apiFixtureId);
      }
    }
  }

  let fixtures: FixtureResult[] = [];
  try {
    if (apiIds.size > 0) {
      const ids = Array.from(apiIds);
      // Batch in chunks of 40 (API free-plan guard)
      for (let i = 0; i < ids.length; i += 40) {
        const chunk = await fetchFixturesByIds(ids.slice(i, i + 40));
        fixtures = fixtures.concat(chunk);
      }
    }
  } catch (err) {
    const metrics = await computeGlobalSettlementMetrics();
    return {
      ok: false,
      checkedFixtures: 0,
      ticketsScanned: pendingTickets.length,
      ticketsUpdated: 0,
      legsSettled: 0,
      stillPending: metrics.pending,
      winRate: metrics.winRate,
      roi: metrics.roi,
      error:
        err instanceof Error
          ? err.message
          : "No se pudieron obtener resultados de API-Football.",
    };
  }

  const byApiId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  let ticketsUpdated = 0;
  let legsSettled = 0;

  for (const ticket of pendingTickets) {
    let ticketChanged = false;
    const legStatuses: LegStatus[] = [];

    for (const pred of ticket.predictions) {
      // Prefer live API payload; fall back to local fixture cache
      const apiFx = byApiId.get(pred.fixture.apiFixtureId);
      let homeGoals: number | null = null;
      let awayGoals: number | null = null;
      let statusShort = pred.fixture.status;
      let finished = false;

      if (apiFx) {
        homeGoals = apiFx.homeGoals;
        awayGoals = apiFx.awayGoals;
        statusShort = apiFx.statusShort || statusShort;
        finished = apiFx.finished;
      } else if (
        isFixtureFinished(pred.fixture.status) &&
        pred.fixture.finalScore
      ) {
        const parts = pred.fixture.finalScore.split(/\s*-\s*/).map(Number);
        if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
          homeGoals = parts[0];
          awayGoals = parts[1];
          finished = true;
        }
      }

      const score = scoreText(homeGoals, awayGoals);

      // Always refresh fixture snapshot when we have data
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

      if (pred.outcome !== "PENDING") {
        legStatuses.push(fromDbOutcome(pred.outcome));
        continue;
      }

      if (
        !finished ||
        homeGoals == null ||
        awayGoals == null ||
        !pred.market
      ) {
        legStatuses.push("pending");
        continue;
      }

      const status = evaluateMarket(
        pred.market as MarketType,
        homeGoals,
        awayGoals
      );

      await prisma.prediction.update({
        where: { id: pred.id },
        data: { outcome: toDbOutcome(status) },
      });

      legStatuses.push(status);
      legsSettled += 1;
      ticketChanged = true;
    }

    const syntheticLegs = legStatuses.map(
      (status) => ({ status }) as HistoryBetLeg
    );
    const nextStatus = deriveTicketStatus(syntheticLegs);

    if (nextStatus !== "pending" || ticketChanged) {
      const dbStatus = toDbOutcome(nextStatus);
      if (ticket.status !== dbStatus) {
        await prisma.accumulatorTicket.update({
          where: { id: ticket.id },
          data: { status: dbStatus },
        });
        ticketsUpdated += 1;
      } else if (ticketChanged) {
        ticketsUpdated += 1;
      }
    }
  }

  const metrics = await computeGlobalSettlementMetrics();

  return {
    ok: true,
    checkedFixtures: fixtures.length,
    ticketsScanned: pendingTickets.length,
    ticketsUpdated,
    legsSettled,
    stillPending: metrics.pending,
    winRate: metrics.winRate,
    roi: metrics.roi,
  };
}
