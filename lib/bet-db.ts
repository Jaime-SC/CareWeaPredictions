import { prisma } from "./db";
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
import { chileDateString, UNIT_STAKE } from "./utils";
import { computePerformanceMetrics } from "./stats";

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
  const key = mode.toLowerCase();
  if (key.includes("monopoly") || key.includes("asimet")) {
    return "monopoly-asymmetry";
  }
  return key.includes("divers") || key.includes("fun")
    ? "daily-fun"
    : "daily-safe";
}

function legsFingerprint(legs: Array<{ matchId?: string; market?: string }>): string {
  return legs
    .map((leg) => `${parseFixtureId(String(leg.matchId ?? ""))}:${String(leg.market ?? "")}`)
    .sort()
    .join("|");
}

async function upsertFixture(leg: RecordBetLegInput) {
  const apiFixtureId = parseFixtureId(leg.matchId);
  const { homeTeam, awayTeam } = splitMatchLabel(leg.matchLabel);
  const matchDate = leg.kickoff ? new Date(leg.kickoff) : new Date();

  if (apiFixtureId > 0) {
    return prisma.matchFixture.upsert({
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

  return prisma.matchFixture.create({
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

async function attachLegsToTicket(
  ticketId: string,
  legs: RecordBetLegInput[]
) {
  for (const leg of legs) {
    const fixture = await upsertFixture(leg);
    await prisma.prediction.create({
      data: {
        fixtureId: fixture.id,
        ticketId,
        market: String(leg.market),
        selection: leg.marketLabel,
        odds: leg.odds,
        modelProbability: leg.modelProbability ?? 0,
        outcome: "PENDING",
      },
    });
  }
}

function ticketFingerprint(
  predictions: Array<{ fixture: { apiFixtureId: number }; market: string }>
): string {
  return predictions
    .map((p) => `${p.fixture.apiFixtureId}:${p.market}`)
    .sort()
    .join("|");
}

/** Existing individual (Segura) ticket for this fixture+market, any status. */
async function findExistingIndividualTicketId(
  leg: RecordBetLegInput,
  date: string
): Promise<string | null> {
  const apiFixtureId = parseFixtureId(leg.matchId);
  if (apiFixtureId > 0) {
    const found = await prisma.prediction.findFirst({
      where: {
        market: String(leg.market),
        ticketId: { not: null },
        fixture: { apiFixtureId },
        ticket: { mode: "Segura" },
      },
      select: { ticketId: true },
    });
    return found?.ticketId ?? null;
  }

  const { homeTeam, awayTeam } = splitMatchLabel(leg.matchLabel);
  const found = await prisma.prediction.findFirst({
    where: {
      market: String(leg.market),
      ticketId: { not: null },
      ticket: { mode: "Segura", date },
      fixture: { homeTeam, awayTeam },
    },
    select: { ticketId: true },
  });
  return found?.ticketId ?? null;
}

/** Persist an accumulator or single-pick ticket + predictions. */
export async function recordBet(input: RecordBetInput) {
  if (!input.legs.length) {
    throw new Error("Se requiere al menos una selección.");
  }

  const date = input.date ?? chileDateString();
  const strategyMode = input.strategyMode ?? "daily-fun";
  const mode = input.mode ?? modeFromStrategy(strategyMode);
  const isCombinada = input.legs.length >= 2;
  const stakeCLP = Number(input.stakeCLP);
  if (!Number.isFinite(stakeCLP) || stakeCLP <= 0) {
    throw new Error("El monto a apostar debe ser mayor a 0.");
  }
  const payoutCLP = stakeCLP * input.totalOdds;

  if (!isCombinada) {
    const existingId = await findExistingIndividualTicketId(input.legs[0], date);
    if (existingId) {
      return { ticketId: existingId, duplicate: true as const };
    }
  }

  const wanted = legsFingerprint(input.legs);
  const pending = await prisma.accumulatorTicket.findMany({
    where: {
      date,
      mode: String(mode),
      status: "PENDING",
    },
    include: {
      predictions: { include: { fixture: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const existingSame = pending.find(
    (ticket) => ticketFingerprint(ticket.predictions) === wanted
  );
  const pendingCombinadas = pending.filter(
    (ticket) => ticket.predictions.length >= 2 || ticket.predictions.length === 0
  );

  if (existingSame) {
    if (isCombinada) {
      const extras = pendingCombinadas.filter((t) => t.id !== existingSame.id);
      for (const extra of extras) {
        await prisma.accumulatorTicket.delete({ where: { id: extra.id } });
      }
    }
    return { ticketId: existingSame.id, duplicate: true as const };
  }

  // One pending combinada per day+mode: overwrite the original ticket.
  if (isCombinada && pendingCombinadas.length > 0) {
    const keep = pendingCombinadas[0];
    await prisma.prediction.deleteMany({ where: { ticketId: keep.id } });
    await prisma.accumulatorTicket.update({
      where: { id: keep.id },
      data: {
        stakeCLP,
        totalOdds: input.totalOdds,
        payoutCLP,
        status: "PENDING",
      },
    });

    try {
      await attachLegsToTicket(keep.id, input.legs);
    } catch (err) {
      await prisma.prediction.deleteMany({ where: { ticketId: keep.id } });
      throw err;
    }

    for (const extra of pendingCombinadas.slice(1)) {
      await prisma.accumulatorTicket.delete({ where: { id: extra.id } });
    }

    return { ticketId: keep.id, duplicate: false as const };
  }

  const ticket = await prisma.accumulatorTicket.create({
    data: {
      date,
      mode: String(mode),
      stakeCLP,
      totalOdds: input.totalOdds,
      payoutCLP,
      status: "PENDING",
    },
  });

  try {
    await attachLegsToTicket(ticket.id, input.legs);
  } catch (err) {
    await prisma.prediction.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.accumulatorTicket.delete({ where: { id: ticket.id } });
    throw err;
  }

  return { ticketId: ticket.id, duplicate: false as const };
}

/** Persist a combinada; overwrites the pending ticket for that date+mode. */
export async function recordBetFromParlay(
  parlay: GeneratedParlay,
  date = chileDateString()
) {
  const strategyMode = parlay.strategyMode ?? "daily-fun";
  return recordBet({
    date,
    strategyMode,
    mode: modeFromStrategy(strategyMode),
    stakeCLP: UNIT_STAKE,
    totalOdds: parlay.totalOdds,
    payoutCLP: UNIT_STAKE * parlay.totalOdds,
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

/** Insert only new individual picks; already registered fixture+market rows are kept. */
export async function recordSafePicks(
  picks: RecordBetLegInput[],
  date = chileDateString()
) {
  let saved = 0;
  let duplicates = 0;
  for (const pick of picks) {
    const result = await recordBet({
      date,
      strategyMode: "daily-safe",
      mode: "Segura",
      stakeCLP: UNIT_STAKE,
      totalOdds: pick.odds,
      payoutCLP: UNIT_STAKE * pick.odds,
      legs: [pick],
    });
    if (result.duplicate) duplicates += 1;
    else saved += 1;
  }
  return { saved, duplicates };
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
      modelProbability: p.modelProbability,
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

export async function listSafeHistoryForDate(date: string): Promise<HistoryBet[]> {
  const rows = await prisma.accumulatorTicket.findMany({
    where: { date, mode: "Segura" },
    include: {
      predictions: { include: { fixture: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows
    .filter((row) => row.predictions.length === 1)
    .map(mapTicketToHistory);
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

/** Delete a single accumulator ticket (predictions cascade via Prisma). */
export async function deleteTicketById(ticketId: string): Promise<boolean> {
  const existing = await prisma.accumulatorTicket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!existing) return false;

  await prisma.accumulatorTicket.delete({
    where: { id: ticketId },
  });
  return true;
}

/** Build analytics payload for /stats and AI training export. */
export async function buildStatsSummary(): Promise<StatsSummaryPayload> {
  const tickets = await listTicketsAsHistory();

  const perf = computePerformanceMetrics(
    tickets.map((bet) => ({
      status: bet.status,
      stake: bet.stakeCLP,
      payout: bet.potentialReturn,
    }))
  );

  let legsWon = 0;
  let legsEvaluated = 0;
  for (const bet of tickets) {
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
      settledTickets: perf.settled,
      pending: perf.pending,
      won: perf.won,
      lost: perf.lost,
      voided: perf.voided,
      totalStaked: perf.totalStaked,
      netProfit: perf.netProfit,
      roi: perf.roi,
      legsWon,
      legsEvaluated,
      legAccuracy: legsEvaluated > 0 ? legsWon / legsEvaluated : 0,
    },
    byLeague,
    byDateMarket,
    trainingExport,
  };
}
