/**
 * Historical backtesting: replay the active accumulator algorithm over
 * finished MatchFixture rows stored in SQLite (30–90 day windows).
 */
import { prisma } from "./db";
import {
  DEFAULT_TARGET_LEG_COUNT,
  MIN_LEG_PROBABILITY,
  generateParlay,
} from "./parlay-generator";
import { getStrategyPreset } from "./parlay-defaults";
import { evaluateMarket } from "./result-checker";
import { ensureMatchOdds } from "./poisson";
import type { GeneratedParlay, LeagueId, MarketType, Match, MatchOdds } from "./types";
import { chileDateString, UNIT_STAKE } from "./utils";

export type BacktestOptions = {
  /** Lookback window in days (clamped 30–90). Default 60. */
  days?: number;
  targetLegCount?: number;
  minProbability?: number;
};

export type BacktestTicketResult = {
  date: string;
  legs: number;
  totalOdds: number;
  jointProbability: number;
  status: "WON" | "LOST" | "VOID" | "INCOMPLETE";
  /** Net units at 1U stake (void = 0). */
  pnlUnits: number;
};

export type BacktestResult = {
  days: number;
  fromDate: string;
  toDate: string;
  fixturesAvailable: number;
  daysWithPool: number;
  totalSimulatedTickets: number;
  won: number;
  lost: number;
  voided: number;
  incomplete: number;
  winRate: number;
  /** Total simulated ROI in units (sum of PnL at 1U). */
  totalRoiUnits: number;
  /** ROI % over staked units (excluding incomplete). */
  roiPct: number;
  avgWinningOdds: number;
  avgLosingOdds: number;
  tickets: BacktestTicketResult[];
};

type FinishedRow = {
  apiFixtureId: number;
  homeTeam: string;
  awayTeam: string;
  leagueId: string;
  leagueName: string;
  matchDate: Date;
  finalScore: string;
  status: string;
  homeGoals: number;
  awayGoals: number;
  dateKey: string;
};

function parseScore(finalScore: string): { home: number; away: number } | null {
  const parts = finalScore.split(/\s*-\s*/).map((p) => Number(p.trim()));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return null;
  }
  return { home: parts[0], away: parts[1] };
}

function clampDays(days: number | undefined): number {
  const n = typeof days === "number" && Number.isFinite(days) ? days : 60;
  return Math.min(90, Math.max(30, Math.round(n)));
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1].slice(0, 2)).toUpperCase();
}

function mapLeagueSlug(leagueId: string): LeagueId {
  const n = Number(leagueId);
  const map: Record<number, LeagueId> = {
    2: "champions-league",
    3: "europa-league",
    11: "copa-sudamericana",
    13: "copa-libertadores",
    39: "premier-league",
    61: "ligue-1",
    71: "brasileirao",
    78: "bundesliga",
    128: "liga-profesional",
    135: "serie-a",
    140: "laliga",
    239: "primera-colombia",
    242: "liga-pro-ecuador",
    253: "mls",
    262: "liga-mx",
    265: "primera-chile",
    267: "primera-chile",
    848: "conference-league",
  };
  return map[n] ?? "premier-league";
}

/** Apply ~4% overround so fair model odds behave like bookmaker prices. */
function applyBookMargin(fair: MatchOdds, margin = 1.04): MatchOdds {
  const scale = (o: number) => (o > 1 ? Math.max(1.01, o / margin) : o);
  return {
    home: scale(fair.home),
    draw: scale(fair.draw),
    away: scale(fair.away),
    doubleChance1X: scale(fair.doubleChance1X),
    doubleChanceX2: scale(fair.doubleChanceX2),
    over05: scale(fair.over05),
    over15: scale(fair.over15),
    over25: scale(fair.over25),
    under35: scale(fair.under35),
    under45: scale(fair.under45),
    homeScores: scale(fair.homeScores),
    awayScores: scale(fair.awayScores),
    dnbHome: scale(fair.dnbHome),
    dnbAway: scale(fair.dnbAway),
  };
}

type TeamAgg = {
  form: ("W" | "D" | "L")[];
  scored: number[];
  conceded: number[];
  homeScored: number[];
  homeConceded: number[];
  awayScored: number[];
  awayConceded: number[];
};

function emptyAgg(): TeamAgg {
  return {
    form: [],
    scored: [],
    conceded: [],
    homeScored: [],
    homeConceded: [],
    awayScored: [],
    awayConceded: [],
  };
}

function avg(xs: number[], fallback: number): number {
  if (!xs.length) return fallback;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pushResult(
  agg: TeamAgg,
  scored: number,
  conceded: number,
  venue: "home" | "away"
) {
  const r: "W" | "D" | "L" =
    scored > conceded ? "W" : scored === conceded ? "D" : "L";
  if (agg.form.length < 5) agg.form.push(r);
  if (agg.scored.length < 12) {
    agg.scored.push(scored);
    agg.conceded.push(conceded);
  }
  if (venue === "home" && agg.homeScored.length < 12) {
    agg.homeScored.push(scored);
    agg.homeConceded.push(conceded);
  }
  if (venue === "away" && agg.awayScored.length < 12) {
    agg.awayScored.push(scored);
    agg.awayConceded.push(conceded);
  }
}

async function loadFinishedRows(from: Date, to: Date): Promise<FinishedRow[]> {
  const rows = await prisma.matchFixture.findMany({
    where: {
      matchDate: { gte: from, lte: to },
      finalScore: { not: null },
      status: { in: ["FT", "AET", "PEN", "AWD", "WO"] },
    },
    orderBy: { matchDate: "asc" },
  });

  const out: FinishedRow[] = [];
  for (const row of rows) {
    if (!row.finalScore) continue;
    const score = parseScore(row.finalScore);
    if (!score) continue;
    out.push({
      apiFixtureId: row.apiFixtureId,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      leagueId: row.leagueId,
      leagueName: row.leagueName,
      matchDate: row.matchDate,
      finalScore: row.finalScore,
      status: row.status,
      homeGoals: score.home,
      awayGoals: score.away,
      dateKey: chileDateString(row.matchDate),
    });
  }
  return out;
}

function buildMatchFromRow(
  row: FinishedRow,
  teamIndex: Map<string, TeamAgg>
): Match {
  const homeHist = teamIndex.get(normalize(row.homeTeam)) ?? emptyAgg();
  const awayHist = teamIndex.get(normalize(row.awayTeam)) ?? emptyAgg();

  const match: Match = {
    id: `bt-${row.apiFixtureId}`,
    league: mapLeagueSlug(row.leagueId),
    leagueName: row.leagueName,
    kickoff: row.matchDate.toISOString(),
    home: {
      name: row.homeTeam,
      shortName: shortName(row.homeTeam),
      form: [...homeHist.form],
      goalsScoredAvg: avg(homeHist.scored, 1.3),
      goalsConcededAvg: avg(homeHist.conceded, 1.2),
      homeGoalsScoredAvg: avg(homeHist.homeScored, avg(homeHist.scored, 1.35)),
      homeGoalsConcededAvg: avg(
        homeHist.homeConceded,
        avg(homeHist.conceded, 1.15)
      ),
    },
    away: {
      name: row.awayTeam,
      shortName: shortName(row.awayTeam),
      form: [...awayHist.form],
      goalsScoredAvg: avg(awayHist.scored, 1.15),
      goalsConcededAvg: avg(awayHist.conceded, 1.35),
      awayGoalsScoredAvg: avg(awayHist.awayScored, avg(awayHist.scored, 1.1)),
      awayGoalsConcededAvg: avg(
        awayHist.awayConceded,
        avg(awayHist.conceded, 1.4)
      ),
    },
    h2h: { homeWins: 0, draws: 0, awayWins: 0, avgGoals: 2.4 },
    odds: {
      home: 0,
      draw: 0,
      away: 0,
      doubleChance1X: 0,
      doubleChanceX2: 0,
      over05: 0,
      over15: 0,
      over25: 0,
      under35: 0,
      under45: 0,
      homeScores: 0,
      awayScores: 0,
      dnbHome: 0,
      dnbAway: 0,
    },
  };

  const withFair = ensureMatchOdds(match);
  return { ...withFair, odds: applyBookMargin(withFair.odds) };
}

function settleParlay(
  parlay: GeneratedParlay,
  scoreByMatchId: Map<string, { home: number; away: number }>
): BacktestTicketResult["status"] {
  let anyLost = false;
  let anyPending = false;
  let actionableWon = 0;
  let actionable = 0;

  for (const leg of parlay.legs) {
    const score = scoreByMatchId.get(leg.matchId);
    if (!score) {
      anyPending = true;
      continue;
    }
    const outcome = evaluateMarket(
      leg.market as MarketType,
      score.home,
      score.away
    );
    if (outcome === "lost") anyLost = true;
    else if (outcome === "void") {
      // PUSH — neutral
    } else if (outcome === "won") {
      actionable += 1;
      actionableWon += 1;
    }
  }

  if (anyLost) return "LOST";
  if (anyPending) return "INCOMPLETE";
  if (actionable === 0) return "VOID";
  if (actionableWon === actionable) return "WON";
  return "INCOMPLETE";
}

/**
 * Run historical simulation with active algorithm params
 * (MIN_LEG_PROBABILITY = 0.80, 15 legs / daily-fun preset).
 */
export async function runHistoricalBacktest(
  options: BacktestOptions = {}
): Promise<BacktestResult> {
  const days = clampDays(options.days);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const preset = getStrategyPreset("daily-fun");
  const targetLegCount =
    options.targetLegCount ??
    preset.targetLegCount ??
    DEFAULT_TARGET_LEG_COUNT;
  const minProbability = Math.max(
    MIN_LEG_PROBABILITY,
    options.minProbability ?? preset.minProbability ?? MIN_LEG_PROBABILITY
  );

  // Load a wider history window so team form exists before the backtest range
  const historyFrom = new Date(from.getTime() - 60 * 24 * 60 * 60 * 1000);
  const allRows = await loadFinishedRows(historyFrom, to);
  const backtestRows = allRows.filter((r) => r.matchDate >= from);

  const byDate = new Map<string, FinishedRow[]>();
  for (const row of backtestRows) {
    const list = byDate.get(row.dateKey) ?? [];
    list.push(row);
    byDate.set(row.dateKey, list);
  }

  const teamIndex = new Map<string, TeamAgg>();
  // Seed team stats with history before `from`
  for (const row of allRows) {
    if (row.matchDate >= from) break;
    const hk = normalize(row.homeTeam);
    const ak = normalize(row.awayTeam);
    if (!teamIndex.has(hk)) teamIndex.set(hk, emptyAgg());
    if (!teamIndex.has(ak)) teamIndex.set(ak, emptyAgg());
    pushResult(teamIndex.get(hk)!, row.homeGoals, row.awayGoals, "home");
    pushResult(teamIndex.get(ak)!, row.awayGoals, row.homeGoals, "away");
  }

  const tickets: BacktestTicketResult[] = [];
  const sortedDates = Array.from(byDate.keys()).sort();

  for (const dateKey of sortedDates) {
    const dayRows = byDate.get(dateKey) ?? [];
    if (dayRows.length < Math.min(5, targetLegCount)) {
      // Still update team index for chronological continuity
      for (const row of dayRows) {
        const hk = normalize(row.homeTeam);
        const ak = normalize(row.awayTeam);
        if (!teamIndex.has(hk)) teamIndex.set(hk, emptyAgg());
        if (!teamIndex.has(ak)) teamIndex.set(ak, emptyAgg());
        pushResult(teamIndex.get(hk)!, row.homeGoals, row.awayGoals, "home");
        pushResult(teamIndex.get(ak)!, row.awayGoals, row.homeGoals, "away");
      }
      continue;
    }

    const matches = dayRows.map((row) => buildMatchFromRow(row, teamIndex));
    const scoreByMatchId = new Map(
      dayRows.map((row) => [
        `bt-${row.apiFixtureId}`,
        { home: row.homeGoals, away: row.awayGoals },
      ])
    );

    const parlay = generateParlay(matches, {
      ...preset,
      strategyMode: "daily-fun",
      targetLegCount,
      minProbability,
      maxLegs: targetLegCount,
      stake: UNIT_STAKE,
    });

    if (parlay.legs.length === 0) {
      for (const row of dayRows) {
        const hk = normalize(row.homeTeam);
        const ak = normalize(row.awayTeam);
        if (!teamIndex.has(hk)) teamIndex.set(hk, emptyAgg());
        if (!teamIndex.has(ak)) teamIndex.set(ak, emptyAgg());
        pushResult(teamIndex.get(hk)!, row.homeGoals, row.awayGoals, "home");
        pushResult(teamIndex.get(ak)!, row.awayGoals, row.homeGoals, "away");
      }
      continue;
    }

    const status = settleParlay(parlay, scoreByMatchId);
    let pnlUnits = 0;
    if (status === "WON") pnlUnits = parlay.totalOdds * UNIT_STAKE - UNIT_STAKE;
    else if (status === "LOST") pnlUnits = -UNIT_STAKE;
    // VOID / INCOMPLETE → 0

    tickets.push({
      date: dateKey,
      legs: parlay.legs.length,
      totalOdds: parlay.totalOdds,
      jointProbability: parlay.jointProbability,
      status,
      pnlUnits,
    });

    // Update team history AFTER the day's simulation (no look-ahead)
    for (const row of dayRows) {
      const hk = normalize(row.homeTeam);
      const ak = normalize(row.awayTeam);
      if (!teamIndex.has(hk)) teamIndex.set(hk, emptyAgg());
      if (!teamIndex.has(ak)) teamIndex.set(ak, emptyAgg());
      pushResult(teamIndex.get(hk)!, row.homeGoals, row.awayGoals, "home");
      pushResult(teamIndex.get(ak)!, row.awayGoals, row.homeGoals, "away");
    }
  }

  const won = tickets.filter((t) => t.status === "WON");
  const lost = tickets.filter((t) => t.status === "LOST");
  const voided = tickets.filter((t) => t.status === "VOID");
  const incomplete = tickets.filter((t) => t.status === "INCOMPLETE");
  const decided = won.length + lost.length;
  const staked = decided * UNIT_STAKE;
  const totalRoiUnits = tickets
    .filter((t) => t.status === "WON" || t.status === "LOST")
    .reduce((s, t) => s + t.pnlUnits, 0);

  const avgWinningOdds =
    won.length > 0
      ? won.reduce((s, t) => s + t.totalOdds, 0) / won.length
      : 0;
  const avgLosingOdds =
    lost.length > 0
      ? lost.reduce((s, t) => s + t.totalOdds, 0) / lost.length
      : 0;

  return {
    days,
    fromDate: chileDateString(from),
    toDate: chileDateString(to),
    fixturesAvailable: backtestRows.length,
    daysWithPool: sortedDates.filter(
      (d) => (byDate.get(d)?.length ?? 0) >= Math.min(5, targetLegCount)
    ).length,
    totalSimulatedTickets: tickets.length,
    won: won.length,
    lost: lost.length,
    voided: voided.length,
    incomplete: incomplete.length,
    winRate: decided > 0 ? won.length / decided : 0,
    totalRoiUnits,
    roiPct: staked > 0 ? (totalRoiUnits / staked) * 100 : 0,
    avgWinningOdds,
    avgLosingOdds,
    tickets,
  };
}
