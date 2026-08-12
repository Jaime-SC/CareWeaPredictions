import { prisma } from "./db";
import type { Prisma } from "@prisma/client";
import {
  modeFromStrategy,
  marketGroupLabel,
  parseFixtureId,
  splitMatchLabel,
  type BetMode,
  type BetStatus,
  type HistoryBet,
  type HistoryBetLeg,
  type LegStatus,
} from "./history-tracker";
import type {
  DateMarketStatsRow,
  LeagueStatsRow,
  PredictionOutcome,
  StatsSummaryMeta,
  TrainingFeatureRow,
} from "./bet-types";
import type { GeneratedParlay, MarketType, StrategyMode } from "./types";
import { chileDateString } from "./utils";

export type {
  DateMarketStatsRow,
  LeagueStatsRow,
  PredictionOutcome,
  TicketStatus,
  TrainingFeatureRow,
} from "./bet-types";

export interface RecordBetLegInput {
  matchId: string;
  matchLabel: string;
  leagueName: string;
  leagueId?: string;
  kickoff: string;
  market: MarketType | string;
  marketLabel: string;
  odds: number;
  modelProbability?: number;
}

export interface RecordBetInput {
  date?: string;
  mode?: BetMode | string;
  strategyMode?: StrategyMode;
  stakeCLP: number;
  totalOdds: number;
  payoutCLP: number;
  legs: RecordBetLegInput[];
}

export interface StatsSummaryPayload {
  tickets: HistoryBet[];
  summary: StatsSummaryMeta;
  byLeague: LeagueStatsRow[];
  byDateMarket: DateMarketStatsRow[];
  trainingExport: TrainingFeatureRow[];
}

function toDbOutcome(status: LegStatus | BetStatus): PredictionOutcome {
  switch (status) {
    case "won":
      return "WON";
    case "lost":
      return "LOST";
    case "void":
      return "VOID";
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
      return "void";
    default:
      return "pending";
  }
}

function fromDbTicketStatus(status: string): BetStatus {
  switch (status.toUpperCase()) {
    case "WON":
      return "won";
    case "LOST":
      return "lost";
    case "VOID":
      return "void";
    default:
      return "pending";
  }
}

function strategyFromMode(mode: string): StrategyMode {
  return mode.toLowerCase().includes("divers") ||
    mode.toLowerCase().includes("fun")
    ? "daily-fun"
    : "daily-safe";
}

async function upsertFixtureInTx(
  tx: Prisma.TransactionClient,
  leg: RecordBetLegInput
) {
  const apiFixtureId = parseFixtureId(leg.matchId);
  const { homeTeam, awayTeam } = splitMatchLabel(leg.matchLabel);
  const matchDate = leg.kickoff ? new Date(leg.kickoff) : new Date();

  if (apiFixtureId > 0) {
    return tx.matchFixture.upsert({
      where: { apiFixtureId },
      create: {
        apiFixtureId,
        homeTeam: homeTeam || "Unknown",
        awayTeam: awayTeam || "Unknown",
        leagueId: leg.leagueId || "unknown",
        leagueName: leg.leagueName || "Otros",
        matchDate,
        status: "NS",
      },
      update: {
        homeTeam: homeTeam || undefined,
        awayTeam: awayTeam || undefined,
        leagueName: leg.leagueName || undefined,
        matchDate,
      },
    });
  }

  return tx.matchFixture.create({
    data: {
      apiFixtureId: -(Date.now() + Math.floor(Math.random() * 100_000)),
      homeTeam: homeTeam || "Unknown",
      awayTeam: awayTeam || "Unknown",
      leagueId: leg.leagueId || "unknown",
      leagueName: leg.leagueName || "Otros",
      matchDate,
      status: "NS",
    },
  });
}

/** Persist an accumulator or single-pick ticket + predictions. */
export async function recordBet(input: RecordBetInput) {
  if (!input.legs.length) {
    throw new Error("Se requiere al menos una selección.");
  }

  const date = input.date ?? chileDateString();
  const strategyMode = input.strategyMode ?? "daily-fun";
  const mode = input.mode ?? modeFromStrategy(strategyMode);

  const existing = await prisma.accumulatorTicket.findFirst({
    where: {
      date,
      mode: String(mode),
      status: "PENDING",
    },
    include: { predictions: true },
  });

  if (
    existing &&
    existing.predictions.length === input.legs.length &&
    Math.abs(existing.totalOdds - input.totalOdds) < 0.001
  ) {
    return { ticketId: existing.id, duplicate: true as const };
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.accumulatorTicket.create({
      data: {
        date,
        mode: String(mode),
        stakeCLP: input.stakeCLP,
        totalOdds: input.totalOdds,
        payoutCLP: input.payoutCLP,
        status: "PENDING",
      },
    });

    for (const leg of input.legs) {
      const fixture = await upsertFixtureInTx(tx, leg);
      await tx.prediction.create({
        data: {
          fixtureId: fixture.id,
          ticketId: created.id,
          market: String(leg.market),
          selection: leg.marketLabel,
          odds: leg.odds,
          modelProbability: leg.modelProbability ?? 0,
          outcome: "PENDING",
        },
      });
    }

    return created;
  });

  return { ticketId: ticket.id, duplicate: false as const };
}

export async function recordBetFromParlay(
  parlay: GeneratedParlay,
  date = chileDateString()
) {
  const strategyMode = parlay.strategyMode ?? "daily-fun";
  return recordBet({
    date,
    strategyMode,
    mode: modeFromStrategy(strategyMode),
    stakeCLP: parlay.stake,
    totalOdds: parlay.totalOdds,
    payoutCLP: parlay.potentialPayout,
    legs: parlay.legs.map((leg) => ({
      matchId: leg.matchId,
      matchLabel: leg.matchLabel,
      leagueName: leg.leagueName,
      kickoff: leg.kickoff,
      market: leg.market,
      marketLabel: leg.marketLabel,
      odds: leg.odds,
      modelProbability: leg.modelProbability,
    })),
  });
}

function mapTicketToHistory(row: {
  id: string;
  date: string;
  mode: string;
  stakeCLP: number;
  totalOdds: number;
  payoutCLP: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  predictions: Array<{
    id: string;
    market: string;
    selection: string;
    odds: number;
    modelProbability: number;
    outcome: string;
    fixture: {
      apiFixtureId: number;
      homeTeam: string;
      awayTeam: string;
      leagueName: string;
      matchDate: Date;
      finalScore: string | null;
      status: string;
    };
  }>;
}): HistoryBet {
  const strategyMode = strategyFromMode(row.mode);
  const legs: HistoryBetLeg[] = row.predictions.map((p) => {
    const scoreParts = p.fixture.finalScore?.split(/\s*-\s*/);
    const homeGoals =
      scoreParts && scoreParts.length === 2
        ? Number(scoreParts[0])
        : null;
    const awayGoals =
      scoreParts && scoreParts.length === 2
        ? Number(scoreParts[1])
        : null;

    return {
      fixtureId: Math.max(0, p.fixture.apiFixtureId),
      matchId:
        p.fixture.apiFixtureId > 0
          ? `live-${p.fixture.apiFixtureId}`
          : `db-${p.id}`,
      matchLabel: `${p.fixture.homeTeam} vs ${p.fixture.awayTeam}`,
      homeTeam: p.fixture.homeTeam,
      awayTeam: p.fixture.awayTeam,
      leagueName: p.fixture.leagueName,
      kickoff: p.fixture.matchDate.toISOString(),
      market: p.market as MarketType,
      marketLabel: p.selection,
      odds: p.odds,
      status: fromDbOutcome(p.outcome),
      homeGoals: Number.isFinite(homeGoals) ? homeGoals : null,
      awayGoals: Number.isFinite(awayGoals) ? awayGoals : null,
      finalScore: p.fixture.finalScore,
      statusShort: p.fixture.status || null,
    };
  });

  return {
    id: row.id,
    date: row.date,
    mode: (row.mode === "Segura" ? "Segura" : "Diversion") as BetMode,
    timeframe: legs.length > 1 ? "Combinada" : "Individual",
    strategyMode,
    stakeCLP: row.stakeCLP,
    totalOdds: row.totalOdds,
    potentialReturn: row.payoutCLP,
    legs,
    status: fromDbTicketStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    settledAt:
      row.status.toUpperCase() === "PENDING"
        ? undefined
        : row.updatedAt.toISOString(),
  };
}

export async function listTicketsAsHistory(): Promise<HistoryBet[]> {
  const rows = await prisma.accumulatorTicket.findMany({
    include: {
      predictions: { include: { fixture: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return rows.map(mapTicketToHistory);
}

export async function updateTicketStatusInDb(
  ticketId: string,
  status: BetStatus
): Promise<void> {
  const dbStatus = toDbOutcome(status);
  await prisma.accumulatorTicket.update({
    where: { id: ticketId },
    data: { status: dbStatus },
  });

  if (status === "won" || status === "lost" || status === "void") {
    // Manual override: mark all legs accordingly when ticket-level override
    if (status === "void") {
      await prisma.prediction.updateMany({
        where: { ticketId },
        data: { outcome: "VOID" },
      });
    }
  }
}

export async function syncOutcomesFromHistory(
  bets: HistoryBet[]
): Promise<number> {
  let updated = 0;
  for (const bet of bets) {
    const ticket = await prisma.accumulatorTicket.findUnique({
      where: { id: bet.id },
      include: { predictions: { include: { fixture: true } } },
    });
    if (!ticket) continue;

    const dbStatus = toDbOutcome(bet.status);
    if (ticket.status !== dbStatus) {
      await prisma.accumulatorTicket.update({
        where: { id: bet.id },
        data: { status: dbStatus },
      });
      updated += 1;
    }

    for (const leg of bet.legs) {
      const pred = ticket.predictions.find(
        (p) =>
          p.fixture.apiFixtureId === leg.fixtureId &&
          p.market === leg.market
      );
      if (!pred) continue;

      const outcome = toDbOutcome(leg.status);
      const score = leg.finalScore ?? null;
      const statusShort = leg.statusShort ?? pred.fixture.status;

      if (
        pred.outcome !== outcome ||
        (score && pred.fixture.finalScore !== score)
      ) {
        await prisma.prediction.update({
          where: { id: pred.id },
          data: { outcome },
        });
        if (score || statusShort) {
          await prisma.matchFixture.update({
            where: { id: pred.fixtureId },
            data: {
              ...(score ? { finalScore: score } : {}),
              ...(statusShort ? { status: statusShort } : {}),
            },
          });
        }
        updated += 1;
      }
    }
  }
  return updated;
}

export async function clearAllBets(): Promise<void> {
  await prisma.prediction.deleteMany();
  await prisma.accumulatorTicket.deleteMany();
}

/** Build analytics payload for /stats and AI training export. */
export async function buildStatsSummary(): Promise<StatsSummaryPayload> {
  const tickets = await listTicketsAsHistory();

  let totalStaked = 0;
  let netProfit = 0;
  let won = 0;
  let lost = 0;
  let pending = 0;
  let voided = 0;
  let legsWon = 0;
  let legsEvaluated = 0;

  for (const bet of tickets) {
    totalStaked += bet.stakeCLP;
    if (bet.status === "won") {
      won += 1;
      netProfit += bet.potentialReturn - bet.stakeCLP;
    } else if (bet.status === "lost") {
      lost += 1;
      netProfit -= bet.stakeCLP;
    } else if (bet.status === "pending") {
      pending += 1;
      netProfit -= bet.stakeCLP;
    } else {
      voided += 1;
    }

    for (const leg of bet.legs) {
      if (leg.status === "won") {
        legsWon += 1;
        legsEvaluated += 1;
      } else if (leg.status === "lost") {
        legsEvaluated += 1;
      }
    }
  }

  const predictions = await prisma.prediction.findMany({
    include: { fixture: true, ticket: true },
    orderBy: { createdAt: "desc" },
  });

  // --- By competition ---
  const leagueMap = new Map<
    string,
    { won: number; lost: number; stakeShare: number; profit: number }
  >();

  for (const p of predictions) {
    if (p.outcome !== "WON" && p.outcome !== "LOST") continue;
    const key = p.fixture.leagueName || "Otros";
    const cur = leagueMap.get(key) ?? {
      won: 0,
      lost: 0,
      stakeShare: 0,
      profit: 0,
    };
    const ticketStake = p.ticket?.stakeCLP ?? 0;
    const legCount = Math.max(1, predictions.filter((x) => x.ticketId === p.ticketId).length);
    const share = ticketStake / legCount;

    cur.stakeShare += share;
    if (p.outcome === "WON") {
      cur.won += 1;
      cur.profit += share * (p.odds - 1);
    } else {
      cur.lost += 1;
      cur.profit -= share;
    }
    leagueMap.set(key, cur);
  }

  const byLeague: LeagueStatsRow[] = Array.from(leagueMap.entries())
    .map(([leagueName, v]) => {
      const total = v.won + v.lost;
      return {
        leagueName,
        total,
        won: v.won,
        lost: v.lost,
        winRate: total > 0 ? v.won / total : 0,
        netRoi: v.stakeShare > 0 ? (v.profit / v.stakeShare) * 100 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  // --- By date & market ---
  const dmMap = new Map<
    string,
    { date: string; market: string; marketLabel: string; won: number; lost: number }
  >();

  for (const p of predictions) {
    if (p.outcome !== "WON" && p.outcome !== "LOST") continue;
    const date =
      p.ticket?.date ??
      chileDateString(p.fixture.matchDate);
    const marketLabel = marketGroupLabel(p.market, p.selection);
    const key = `${date}::${marketLabel}`;
    const cur = dmMap.get(key) ?? {
      date,
      market: p.market,
      marketLabel,
      won: 0,
      lost: 0,
    };
    if (p.outcome === "WON") cur.won += 1;
    else cur.lost += 1;
    dmMap.set(key, cur);
  }

  const byDateMarket: DateMarketStatsRow[] = Array.from(dmMap.values())
    .map((v) => {
      const total = v.won + v.lost;
      return {
        date: v.date,
        market: v.market,
        marketLabel: v.marketLabel,
        total,
        won: v.won,
        lost: v.lost,
        winRate: total > 0 ? v.won / total : 0,
      };
    })
    .sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      return b.total - a.total;
    });

  const trainingExport: TrainingFeatureRow[] = predictions.map((p) => ({
    league: p.fixture.leagueName,
    market: p.market,
    selection: p.selection,
    modelProbability: p.modelProbability,
    odds: p.odds,
    outcome: p.outcome as PredictionOutcome,
    matchDate: p.fixture.matchDate.toISOString(),
    homeTeam: p.fixture.homeTeam,
    awayTeam: p.fixture.awayTeam,
  }));

  return {
    tickets,
    summary: {
      totalTickets: tickets.length,
      pending,
      won,
      lost,
      voided,
      totalStaked,
      netProfit,
      roi: totalStaked > 0 ? (netProfit / totalStaked) * 100 : 0,
      legsWon,
      legsEvaluated,
      legAccuracy: legsEvaluated > 0 ? legsWon / legsEvaluated : 0,
    },
    byLeague,
    byDateMarket,
    trainingExport,
  };
}
