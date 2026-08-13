import type { GeneratedParlay, MarketType, ParlayLeg, StrategyMode } from "./types";
import { computePerformanceMetrics } from "./stats";
import { chileDateString } from "./utils";

const STORAGE_KEY = "parleylab_bet_history";
const BACKTEST_FLAG_KEY = "parleylab_history_is_backtest";

export type BetMode = "Segura" | "Diversion";
export type BetTimeframe = "Individual" | "Combinada" | "Diaria" | "Semanal";
export type BetStatus = "pending" | "won" | "lost" | "void";
export type LegStatus = "pending" | "won" | "lost" | "void";

export interface HistoryBetLeg {
  fixtureId: number;
  matchId: string;
  matchLabel: string;
  homeTeam?: string;
  awayTeam?: string;
  leagueName: string;
  kickoff: string;
  market: MarketType;
  marketLabel: string;
  odds: number;
  /** Per-leg outcome from API evaluation */
  status: LegStatus;
  homeGoals?: number | null;
  awayGoals?: number | null;
  /** e.g. "2 - 0" when score known */
  finalScore?: string | null;
  /** API-Football status.short: FT, 1H, HT, NS, … */
  statusShort?: string | null;
  /** Live minute when status is in-play */
  elapsed?: number | null;
  checkedAt?: string;
}

export interface HistoryBet {
  id: string;
  date: string;
  mode: BetMode;
  timeframe: BetTimeframe;
  strategyMode: StrategyMode;
  stakeCLP: number;
  totalOdds: number;
  potentialReturn: number;
  legs: HistoryBetLeg[];
  status: BetStatus;
  /** @deprecated Fake backtest — purged on load */
  isBacktest?: boolean;
  createdAt: string;
  settledAt?: string;
  lastCheckedAt?: string;
}

export interface HistorySummary {
  netProfit: number;
  totalStaked: number;
  totalReturned: number;
  roi: number;
  /** Hit rate of completed tickets (won / won+lost) */
  winRate: number;
  /** Correct legs / evaluated legs (excludes pending & void) */
  legAccuracy: number;
  legsWon: number;
  legsEvaluated: number;
  totalBets: number;
  won: number;
  lost: number;
  pending: number;
  voided: number;
  completed: number;
}

export interface BreakdownItem {
  key: string;
  label: string;
  won: number;
  lost: number;
  total: number;
  winRate: number;
}

export interface BankrollPoint {
  date: string;
  bankroll: number;
  profit: number;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function modeFromStrategy(strategyMode: StrategyMode): BetMode {
  return strategyMode.includes("fun") ? "Diversion" : "Segura";
}

export function timeframeFromStrategy(
  strategyMode: StrategyMode
): BetTimeframe {
  return strategyMode.includes("fun") ? "Combinada" : "Individual";
}

/** Extract API-Football fixture id from `live-{id}` match ids. */
export function parseFixtureId(matchId: string): number {
  const live = matchId.match(/^live-(\d+)$/i);
  if (live) return Number(live[1]);
  if (/^\d+$/.test(matchId)) return Number(matchId);
  return 0;
}

/** Parse "Home vs Away" labels into team names. */
export function splitMatchLabel(label: string): {
  homeTeam: string;
  awayTeam: string;
} {
  const parts = label.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2) {
    return { homeTeam: parts[0].trim(), awayTeam: parts.slice(1).join(" vs ").trim() };
  }
  return { homeTeam: label, awayTeam: "" };
}

function mapLegs(legs: ParlayLeg[]): HistoryBetLeg[] {
  return legs.map((leg) => {
    const { homeTeam, awayTeam } = splitMatchLabel(leg.matchLabel);
    return {
      fixtureId: parseFixtureId(leg.matchId),
      matchId: leg.matchId,
      matchLabel: leg.matchLabel,
      homeTeam,
      awayTeam,
      leagueName: leg.leagueName,
      kickoff: leg.kickoff,
      market: leg.market,
      marketLabel: leg.marketLabel,
      odds: leg.odds,
      status: "pending" as const,
      finalScore: null,
      statusShort: null,
      elapsed: null,
    };
  });
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `bet_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function inferMarketFromLabel(label: string): MarketType {
  const l = label.toLowerCase();
  if (l.includes("1x") || (l.includes("doble") && l.includes("1"))) return "1x";
  if (l.includes("x2") || (l.includes("doble") && l.includes("2"))) return "x2";
  if (l.includes("sin empate") && (l.includes("(2)") || l.includes("visita") || l.includes("away"))) {
    return "dnb_away";
  }
  if (l.includes("sin empate") || l.includes("dnb")) return "dnb_home";
  if (l.includes("2.5")) return "over_2_5";
  if (l.includes("1.5")) return "over_1_5";
  if (l.includes("0.5") && l.includes("under")) return "under_3_5";
  if (l.includes("0.5")) return "over_0_5";
  if (l.includes("under 4") || l.includes("4.5")) return "under_4_5";
  if (l.includes("under 3") || l.includes("3.5")) return "under_3_5";
  if (l.includes("local marca") || l.includes("casa marca")) return "home_scores";
  if (l.includes("visita marca") || l.includes("away")) return "away_scores";
  return "over_1_5";
}

function normalizeLeg(raw: Partial<HistoryBetLeg> & {
  matchLabel?: string;
  marketLabel?: string;
  odds?: number;
}): HistoryBetLeg | null {
  const matchId = raw.matchId ?? "";
  const fixtureId =
    typeof raw.fixtureId === "number" && raw.fixtureId > 0
      ? raw.fixtureId
      : parseFixtureId(matchId);

  if (!raw.matchLabel || !raw.marketLabel || typeof raw.odds !== "number") {
    return null;
  }

  const market =
    (raw.market as MarketType | undefined) ??
    inferMarketFromLabel(raw.marketLabel);

  const teams =
    raw.homeTeam && raw.awayTeam
      ? { homeTeam: raw.homeTeam, awayTeam: raw.awayTeam }
      : splitMatchLabel(raw.matchLabel);

  const homeGoals = raw.homeGoals ?? null;
  const awayGoals = raw.awayGoals ?? null;
  const finalScore =
    raw.finalScore ??
    (homeGoals != null && awayGoals != null
      ? `${homeGoals} - ${awayGoals}`
      : null);

  return {
    fixtureId,
    matchId: matchId || `live-${fixtureId}`,
    matchLabel: raw.matchLabel,
    homeTeam: teams.homeTeam,
    awayTeam: teams.awayTeam,
    leagueName: raw.leagueName ?? "",
    kickoff: raw.kickoff ?? "",
    market,
    marketLabel: raw.marketLabel,
    odds: raw.odds,
    status: (raw.status as LegStatus) ?? "pending",
    homeGoals,
    awayGoals,
    finalScore,
    statusShort: raw.statusShort ?? null,
    elapsed: raw.elapsed ?? null,
    checkedAt: raw.checkedAt,
  };
}

function normalizeBet(raw: HistoryBet): HistoryBet | null {
  if (raw.isBacktest) return null;
  if (!Array.isArray(raw.legs) || raw.legs.length === 0) return null;

  const legs = raw.legs
    .map((l) => normalizeLeg(l))
    .filter((l): l is HistoryBetLeg => l !== null);

  if (legs.length === 0) return null;

  return {
    ...raw,
    isBacktest: undefined,
    legs,
    status: raw.status ?? "pending",
  };
}

export function loadBets(): HistoryBet[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryBet[];
    if (!Array.isArray(parsed)) return [];

    const normalized = parsed
      .map((b) => normalizeBet(b))
      .filter((b): b is HistoryBet => b !== null)
      .sort((a, b) => b.date.localeCompare(a.date));

    // Persist cleanup if fake/invalid rows were dropped
    if (normalized.length !== parsed.length) {
      saveBets(normalized);
      localStorage.removeItem(BACKTEST_FLAG_KEY);
    }

    return normalized;
  } catch {
    return [];
  }
}

export function saveBets(bets: HistoryBet[]): void {
  if (!canUseStorage()) return;
  try {
    const clean = bets.filter((b) => !b.isBacktest);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    localStorage.removeItem(BACKTEST_FLAG_KEY);
  } catch (err) {
    console.warn("[history-tracker] Failed to save:", err);
  }
}

/** Remove any leftover mock/backtest rows. */
export function purgeFakeHistory(): void {
  if (!canUseStorage()) return;
  localStorage.removeItem(BACKTEST_FLAG_KEY);
  const bets = loadBets();
  const real = bets.filter((b) => !b.isBacktest);
  if (real.length !== bets.length) saveBets(real);
}

export function addBetFromParlay(
  parlay: GeneratedParlay,
  date = chileDateString()
): HistoryBet | null {
  if (!parlay.legs.length) return null;
  purgeFakeHistory();

  const strategyMode = parlay.strategyMode ?? "daily-fun";
  const existing = loadBets();

  // Same day + strategy is only a duplicate when odds and leg count match
  // (allows registering a manually filtered ticket vs. the full generated one).
  const duplicate = existing.find(
    (b) =>
      b.date === date &&
      b.strategyMode === strategyMode &&
      b.timeframe === "Combinada" &&
      b.status === "pending" &&
      b.legs.length === parlay.legs.length &&
      Math.abs(b.totalOdds - parlay.totalOdds) < 0.001
  );
  if (duplicate) return duplicate;

  const legs = mapLegs(parlay.legs);
  if (legs.some((l) => !l.fixtureId)) {
    console.warn(
      "[history-tracker] Some legs lack fixtureId; API checks may skip them."
    );
  }

  // Analytics use a fixed 1 Unit (1U) stake — ignore monetary parlay.stake
  const unitStake = 1;
  const bet: HistoryBet = {
    id: createId(),
    date,
    mode: modeFromStrategy(strategyMode),
    timeframe: "Combinada",
    strategyMode,
    stakeCLP: unitStake,
    totalOdds: parlay.totalOdds,
    potentialReturn: unitStake * parlay.totalOdds,
    legs,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  saveBets([bet, ...existing]);
  return bet;
}

export interface SinglePickInput {
  matchId: string;
  matchLabel: string;
  leagueName: string;
  kickoff: string;
  market: MarketType;
  marketLabel: string;
  odds: number;
}

/** Register one individual safe pick as its own history ticket (1U stake). */
export function addBetFromSinglePick(
  pick: SinglePickInput,
  _stakeCLP = 1,
  date = chileDateString()
): HistoryBet | null {
  purgeFakeHistory();
  const existing = loadBets();
  const fixtureId = parseFixtureId(pick.matchId);

  const duplicate = existing.find(
    (b) =>
      b.status === "pending" &&
      b.timeframe === "Individual" &&
      b.legs.length === 1 &&
      b.legs[0].fixtureId === fixtureId &&
      b.legs[0].market === pick.market
  );
  if (duplicate) return duplicate;

  const { homeTeam, awayTeam } = splitMatchLabel(pick.matchLabel);
  const odds = pick.odds > 0 ? pick.odds : 1;
  const unitStake = 1;
  const bet: HistoryBet = {
    id: createId(),
    date,
    mode: "Segura",
    timeframe: "Individual",
    strategyMode: "daily-safe",
    stakeCLP: unitStake,
    totalOdds: odds,
    potentialReturn: unitStake * odds,
    legs: [
      {
        fixtureId,
        matchId: pick.matchId,
        matchLabel: pick.matchLabel,
        homeTeam,
        awayTeam,
        leagueName: pick.leagueName,
        kickoff: pick.kickoff,
        market: pick.market,
        marketLabel: pick.marketLabel,
        odds,
        status: "pending",
        finalScore: null,
        statusShort: null,
        elapsed: null,
      },
    ],
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  saveBets([bet, ...existing]);
  return bet;
}

export function updateBetStatus(
  id: string,
  status: BetStatus
): HistoryBet | null {
  const bets = loadBets();
  const idx = bets.findIndex((b) => b.id === id);
  if (idx < 0) return null;

  const updated: HistoryBet = {
    ...bets[idx],
    status,
    settledAt:
      status === "pending" ? undefined : new Date().toISOString(),
  };
  bets[idx] = updated;
  saveBets(bets);
  return updated;
}

export function replaceBets(bets: HistoryBet[]): void {
  saveBets(bets);
}

/** Remove one ticket from localStorage history. Stats recompute from remaining bets. */
export function deleteBetById(betId: string): boolean {
  if (!betId || !canUseStorage()) return false;
  const bets = loadBets();
  const next = bets.filter((b) => b.id !== betId);
  if (next.length === bets.length) return false;
  saveBets(next);
  return true;
}

export function clearHistory(): void {
  if (!canUseStorage()) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(BACKTEST_FLAG_KEY);
}

/**
 * Performance (Win Rate, ROI, P&L) uses only Liquidados (WON / LOST).
 * Pending tickets are counted separately and never enter those formulas.
 */
export function computeSummary(bets: HistoryBet[]): HistorySummary {
  const perf = computePerformanceMetrics(
    bets.map((bet) => ({
      status: bet.status,
      stake: bet.stakeCLP,
      payout: bet.potentialReturn,
    }))
  );

  let totalReturned = 0;
  let legsWon = 0;
  let legsEvaluated = 0;

  for (const bet of bets) {
    if (bet.status === "won") totalReturned += bet.potentialReturn;
    for (const leg of bet.legs) {
      if (leg.status === "won") {
        legsWon += 1;
        legsEvaluated += 1;
      } else if (leg.status === "lost") {
        legsEvaluated += 1;
      }
    }
  }

  const legAccuracy = legsEvaluated > 0 ? legsWon / legsEvaluated : 0;

  return {
    netProfit: perf.netProfit,
    totalStaked: perf.totalStaked,
    totalReturned,
    roi: perf.roi,
    winRate: perf.winRate,
    legAccuracy,
    legsWon,
    legsEvaluated,
    totalBets: bets.length,
    won: perf.won,
    lost: perf.lost,
    pending: perf.pending,
    voided: perf.voided,
    completed: perf.settled,
  };
}

export function computeBankrollSeries(bets: HistoryBet[]): BankrollPoint[] {
  const settled = bets
    .filter((b) => b.status === "won" || b.status === "lost")
    .slice()
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return a.createdAt.localeCompare(b.createdAt);
    });

  let bankroll = 0;
  const byDate = new Map<string, number>();

  for (const bet of settled) {
    const delta =
      bet.status === "won"
        ? bet.potentialReturn - bet.stakeCLP
        : -bet.stakeCLP;
    bankroll += delta;
    byDate.set(bet.date, bankroll);
  }

  return Array.from(byDate.entries()).map(([date, value]) => ({
    date,
    bankroll: value,
    profit: value,
  }));
}

export function marketGroupLabel(market: MarketType | string, label?: string): string {
  const m = String(market);
  if (m === "1x" || m === "x2") return "Doble Oportunidad";
  if (m === "dnb_home" || m === "dnb_away") return "Apuesta sin empate";
  if (m === "over_1_5") return "+1.5 Goles";
  if (m === "over_2_5") return "+2.5 Goles";
  if (m === "over_0_5") return "+0.5 Goles";
  if (m === "under_3_5" || m === "under_4_5") return "Under Goles";
  if (m === "home_scores" || m === "away_scores") return "Equipo marca";
  if (label) return label;
  return m;
}

/** Per-leg accuracy by market (real evaluated matches only). */
export function computeMarketBreakdown(bets: HistoryBet[]): BreakdownItem[] {
  const map = new Map<string, { won: number; lost: number }>();

  for (const bet of bets) {
    for (const leg of bet.legs) {
      if (leg.status !== "won" && leg.status !== "lost") continue;
      const key = marketGroupLabel(leg.market, leg.marketLabel);
      const cur = map.get(key) ?? { won: 0, lost: 0 };
      if (leg.status === "won") cur.won += 1;
      else cur.lost += 1;
      map.set(key, cur);
    }
  }

  return Array.from(map.entries())
    .map(([key, v]) => {
      const total = v.won + v.lost;
      return {
        key,
        label: key,
        won: v.won,
        lost: v.lost,
        total,
        winRate: total > 0 ? v.won / total : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function computeStrategyBreakdown(bets: HistoryBet[]): BreakdownItem[] {
  const modes: BetMode[] = ["Segura", "Diversion"];
  return modes.map((mode) => {
    const subset = bets.filter(
      (b) =>
        b.mode === mode && (b.status === "won" || b.status === "lost")
    );
    const won = subset.filter((b) => b.status === "won").length;
    const lost = subset.filter((b) => b.status === "lost").length;
    const total = won + lost;
    return {
      key: mode,
      label: mode === "Segura" ? "Modo Segura" : "Modo Diversión",
      won,
      lost,
      total,
      winRate: total > 0 ? won / total : 0,
    };
  });
}

export function computeLeagueBreakdown(bets: HistoryBet[]): BreakdownItem[] {
  const map = new Map<string, { won: number; lost: number }>();

  for (const bet of bets) {
    for (const leg of bet.legs) {
      if (leg.status !== "won" && leg.status !== "lost") continue;
      const key = leg.leagueName || "Otros";
      const cur = map.get(key) ?? { won: 0, lost: 0 };
      if (leg.status === "won") cur.won += 1;
      else cur.lost += 1;
      map.set(key, cur);
    }
  }

  return Array.from(map.entries())
    .map(([key, v]) => {
      const total = v.won + v.lost;
      return {
        key,
        label: key,
        won: v.won,
        lost: v.lost,
        total,
        winRate: total > 0 ? v.won / total : 0,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

/** @deprecated Prefer formatSignedUnits — monetary UI is temporarily disabled */
export function formatSignedCLP(value: number): string {
  const abs = Math.round(Math.abs(value)).toLocaleString("es-CL");
  if (value > 0) return `+$${abs} CLP`;
  if (value < 0) return `-$${abs} CLP`;
  return `$0 CLP`;
}

/** Signed unit P&L (1U stake reference). */
export function formatSignedUnits(value: number, digits = 2): string {
  const abs = Math.abs(value).toFixed(digits);
  if (value > 0) return `+${abs}U`;
  if (value < 0) return `−${abs}U`;
  return `0.00U`;
}

/** Count won vs total legs for the "X / Y Acertadas" badge. */
export function countLegHits(legs: HistoryBetLeg[]): {
  won: number;
  lost: number;
  voided: number;
  pending: number;
  total: number;
} {
  let won = 0;
  let lost = 0;
  let voided = 0;
  let pending = 0;
  for (const leg of legs) {
    if (leg.status === "won") won += 1;
    else if (leg.status === "lost") lost += 1;
    else if (leg.status === "void") voided += 1;
    else pending += 1;
  }
  return { won, lost, voided, pending, total: legs.length };
}
