import type { MarketType, SettlementFacts } from "./types";
import {
  isFixtureFinished,
  isFixtureLive,
  isFixtureVoided,
  isKickoffDueForSettlement,
} from "./match-status";
import {
  needsFixtureStatSettlement,
  needsHtScoreSettlement,
} from "./phase2-markets";
import {
  type BetStatus,
  type HistoryBet,
  type HistoryBetLeg,
  type LegStatus,
  loadBets,
  saveBets,
} from "./history-tracker";
import { chileDateString, formatKickoffTime } from "./utils";

export type FixtureResult = {
  fixtureId: number;
  statusShort: string;
  finished: boolean;
  voided?: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  homeName?: string;
  awayName?: string;
  date?: string;
  /** Live minute from API-Football (null if not in-play) */
  elapsed?: number | null;
  htHomeGoals?: number | null;
  htAwayGoals?: number | null;
  cornersHome?: number | null;
  cornersAway?: number | null;
  corners1hTotal?: number | null;
  yellowHome?: number | null;
  yellowAway?: number | null;
};

export type UpdatePendingResult = {
  ok: boolean;
  checkedFixtures: number;
  updatedTickets: number;
  stillPending: number;
  error?: string;
  bets: HistoryBet[];
};

export {
  isFixtureFinished,
  isFixtureLive,
  isFixtureVoided,
} from "./match-status";

export type MarketEvalResult = Exclude<LegStatus, "pending"> | "need_stats";

function overLine(total: number, line: number): boolean {
  return total > line;
}
function underLine(total: number, line: number): boolean {
  return total < line;
}

/**
 * Evaluate a market against settlement facts.
 * Returns won | lost | void | need_stats (caller keeps pending / fetches stats).
 */
export function evaluateMarket(
  market: MarketType,
  factsOrHome: SettlementFacts | number,
  awayGoalsArg?: number
): MarketEvalResult {
  const facts: SettlementFacts =
    typeof factsOrHome === "number"
      ? { homeGoals: factsOrHome, awayGoals: awayGoalsArg ?? 0 }
      : factsOrHome;

  const { homeGoals, awayGoals } = facts;
  const total = homeGoals + awayGoals;

  if (needsHtScoreSettlement(market)) {
    if (facts.htHomeGoals == null || facts.htAwayGoals == null) {
      return "need_stats";
    }
    const htH = facts.htHomeGoals;
    const htA = facts.htAwayGoals;
    const htT = htH + htA;
    switch (market) {
      case "ht_home":
        return htH > htA ? "won" : "lost";
      case "ht_draw":
        return htH === htA ? "won" : "lost";
      case "ht_away":
        return htA > htH ? "won" : "lost";
      case "ht_over_0_5":
        return overLine(htT, 0.5) ? "won" : "lost";
      case "ht_under_0_5":
        return underLine(htT, 0.5) ? "won" : "lost";
      case "ht_over_1_5":
        return overLine(htT, 1.5) ? "won" : "lost";
      case "ht_under_1_5":
        return underLine(htT, 1.5) ? "won" : "lost";
      default:
        break;
    }
  }

  if (needsFixtureStatSettlement(market)) {
    if (market.startsWith("corners_1h_")) {
      if (facts.corners1hTotal == null) return "void";
      const c = facts.corners1hTotal;
      switch (market) {
        case "corners_1h_over_3_5":
          return overLine(c, 3.5) ? "won" : "lost";
        case "corners_1h_under_3_5":
          return underLine(c, 3.5) ? "won" : "lost";
        case "corners_1h_over_4_5":
          return overLine(c, 4.5) ? "won" : "lost";
        case "corners_1h_under_4_5":
          return underLine(c, 4.5) ? "won" : "lost";
        default:
          return "lost";
      }
    }

    if (market.startsWith("corners_home_") || market.startsWith("corners_away_")) {
      if (facts.cornersHome == null || facts.cornersAway == null) {
        return "need_stats";
      }
      const side = market.startsWith("corners_home_")
        ? facts.cornersHome
        : facts.cornersAway;
      if (market.includes("over_3_5")) return overLine(side, 3.5) ? "won" : "lost";
      if (market.includes("under_3_5")) return underLine(side, 3.5) ? "won" : "lost";
      if (market.includes("over_4_5")) return overLine(side, 4.5) ? "won" : "lost";
      if (market.includes("under_4_5")) return underLine(side, 4.5) ? "won" : "lost";
      return "lost";
    }

    if (market.startsWith("corners_")) {
      if (facts.cornersHome == null || facts.cornersAway == null) {
        return "need_stats";
      }
      const c = facts.cornersHome + facts.cornersAway;
      switch (market) {
        case "corners_over_7_5":
          return overLine(c, 7.5) ? "won" : "lost";
        case "corners_under_7_5":
          return underLine(c, 7.5) ? "won" : "lost";
        case "corners_over_8_5":
          return overLine(c, 8.5) ? "won" : "lost";
        case "corners_under_8_5":
          return underLine(c, 8.5) ? "won" : "lost";
        case "corners_over_9_5":
          return overLine(c, 9.5) ? "won" : "lost";
        case "corners_under_9_5":
          return underLine(c, 9.5) ? "won" : "lost";
        case "corners_over_10_5":
          return overLine(c, 10.5) ? "won" : "lost";
        case "corners_under_10_5":
          return underLine(c, 10.5) ? "won" : "lost";
        default:
          return "lost";
      }
    }

    if (market.startsWith("cards_home_") || market.startsWith("cards_away_")) {
      if (facts.yellowHome == null || facts.yellowAway == null) {
        return "need_stats";
      }
      const side = market.startsWith("cards_home_")
        ? facts.yellowHome
        : facts.yellowAway;
      if (market.includes("over_1_5")) return overLine(side, 1.5) ? "won" : "lost";
      if (market.includes("under_1_5")) return underLine(side, 1.5) ? "won" : "lost";
      if (market.includes("over_2_5")) return overLine(side, 2.5) ? "won" : "lost";
      if (market.includes("under_2_5")) return underLine(side, 2.5) ? "won" : "lost";
      return "lost";
    }

    if (market.startsWith("cards_")) {
      if (facts.yellowHome == null || facts.yellowAway == null) {
        return "need_stats";
      }
      const c = facts.yellowHome + facts.yellowAway;
      switch (market) {
        case "cards_over_3_5":
          return overLine(c, 3.5) ? "won" : "lost";
        case "cards_under_3_5":
          return underLine(c, 3.5) ? "won" : "lost";
        case "cards_over_4_5":
          return overLine(c, 4.5) ? "won" : "lost";
        case "cards_under_4_5":
          return underLine(c, 4.5) ? "won" : "lost";
        case "cards_over_5_5":
          return overLine(c, 5.5) ? "won" : "lost";
        case "cards_under_5_5":
          return underLine(c, 5.5) ? "won" : "lost";
        default:
          return "lost";
      }
    }
  }

  switch (market) {
    case "home":
      return homeGoals > awayGoals ? "won" : "lost";
    case "draw":
      return homeGoals === awayGoals ? "won" : "lost";
    case "away":
      return awayGoals > homeGoals ? "won" : "lost";
    case "1x":
      return homeGoals >= awayGoals ? "won" : "lost";
    case "x2":
      return awayGoals >= homeGoals ? "won" : "lost";
    case "over_0_5":
      return total > 0 ? "won" : "lost";
    case "over_1_5":
      return total > 1 ? "won" : "lost";
    case "over_2_5":
      return total > 2 ? "won" : "lost";
    case "under_3_5":
      return total < 3.5 ? "won" : "lost";
    case "under_4_5":
      return total < 4.5 ? "won" : "lost";
    case "home_scores":
      return homeGoals > 0 ? "won" : "lost";
    case "away_scores":
      return awayGoals > 0 ? "won" : "lost";
    case "home_over_1_5":
      return homeGoals > 1.5 ? "won" : "lost";
    case "away_over_1_5":
      return awayGoals > 1.5 ? "won" : "lost";
    case "dnb_home":
      if (homeGoals === awayGoals) return "void";
      return homeGoals > awayGoals ? "won" : "lost";
    case "dnb_away":
      if (homeGoals === awayGoals) return "void";
      return awayGoals > homeGoals ? "won" : "lost";
    case "btts_yes":
      return homeGoals > 0 && awayGoals > 0 ? "won" : "lost";
    case "btts_no":
      return homeGoals === 0 || awayGoals === 0 ? "won" : "lost";
    default:
      return "lost";
  }
}

export function factsFromFixture(fixture: FixtureResult): SettlementFacts {
  return {
    homeGoals: fixture.homeGoals ?? 0,
    awayGoals: fixture.awayGoals ?? 0,
    htHomeGoals: fixture.htHomeGoals,
    htAwayGoals: fixture.htAwayGoals,
    cornersHome: fixture.cornersHome,
    cornersAway: fixture.cornersAway,
    corners1hTotal: fixture.corners1hTotal,
    yellowHome: fixture.yellowHome,
    yellowAway: fixture.yellowAway,
  };
}

// --- rest of file preserved below via read+append if needed ---

export function deriveTicketStatus(legs: HistoryBetLeg[]): BetStatus {
  if (legs.some((l) => l.status === "lost")) return "lost";
  if (legs.some((l) => l.status === "pending")) return "pending";

  const actionable = legs.filter((l) => l.status !== "void");
  if (actionable.length === 0) return "void";
  if (actionable.every((l) => l.status === "won")) return "won";
  return "pending";
}

function scoreText(
  homeGoals: number | null | undefined,
  awayGoals: number | null | undefined
): string | null {
  if (homeGoals == null || awayGoals == null) return null;
  return `${homeGoals} - ${awayGoals}`;
}

/**
 * Human-readable score / schedule line for a leg.
 * Examples: "3 - 1 (FT)", "En Vivo 65'", "Hoy 18:00"
 */
export function formatLegMatchStatus(leg: HistoryBetLeg): string {
  const short = (leg.statusShort ?? "").toUpperCase();
  const score =
    leg.finalScore ?? scoreText(leg.homeGoals, leg.awayGoals);

  if (isFixtureVoided(short)) {
    if (short === "CANC" || short === "CAN") return "Cancelado (PUSH)";
    if (short === "SUSP" || short === "INT") return "Suspendido (PUSH)";
    if (short === "ABD") return "Abandonado (PUSH)";
    return "Aplazado (PUSH)";
  }

  if (isFixtureFinished(short) && score) {
    return `${score} (${short || "FT"})`;
  }

  if (isFixtureLive(short)) {
    const minute =
      leg.elapsed != null ? `${leg.elapsed}'` : short || "LIVE";
    if (score) return `${score} -� En Vivo ${minute}`;
    return `En Vivo ${minute}`;
  }

  if (score && short && short !== "NS" && short !== "TBD") {
    return `${score} (${short})`;
  }

  if (leg.kickoff) {
    const today = chileDateString();
    const kickDate = chileDateString(new Date(leg.kickoff));
    const time = formatKickoffTime(leg.kickoff);
    if (kickDate === today) return `Hoy ${time}`;
    try {
      const day = new Intl.DateTimeFormat("es-CL", {
        timeZone: "America/Santiago",
        weekday: "short",
        day: "2-digit",
        month: "short",
      }).format(new Date(leg.kickoff));
      return `${day} ${time}`;
    } catch {
      return time || "Pendiente";
    }
  }

  return "Pendiente";
}

function legSnapshot(leg: HistoryBetLeg): string {
  return [
    leg.status,
    leg.homeGoals,
    leg.awayGoals,
    leg.finalScore,
    leg.statusShort,
    leg.elapsed,
    leg.homeTeam,
    leg.awayTeam,
  ].join("|");
}

/**
 * Apply fixture payload to a single leg.
 * Always stores per-leg status + score metadata (won | lost | pending | void).
 * Live/unfinished matches stay pending but get score/minute updates.
 */
export function applyFixtureToLeg(
  leg: HistoryBetLeg,
  fixture: FixtureResult
): HistoryBetLeg {
  const homeTeam = fixture.homeName || leg.homeTeam;
  const awayTeam = fixture.awayName || leg.awayTeam;
  const matchLabel =
    homeTeam && awayTeam
      ? `${homeTeam} vs ${awayTeam}`
      : leg.matchLabel;
  const finalScore = scoreText(fixture.homeGoals, fixture.awayGoals);

  const enriched: HistoryBetLeg = {
    ...leg,
    homeTeam,
    awayTeam,
    matchLabel,
    statusShort: fixture.statusShort || leg.statusShort || null,
    elapsed: fixture.elapsed ?? leg.elapsed ?? null,
    homeGoals: fixture.homeGoals ?? leg.homeGoals ?? null,
    awayGoals: fixture.awayGoals ?? leg.awayGoals ?? null,
    finalScore: finalScore ?? leg.finalScore ?? null,
    checkedAt: new Date().toISOString(),
  };

  // Keep settled outcome; still refresh score display above
  if (leg.status !== "pending") {
    return enriched;
  }

  if (fixture.voided || isFixtureVoided(fixture.statusShort)) {
    return { ...enriched, status: "void" };
  }

  const finished =
    fixture.finished || isFixtureFinished(fixture.statusShort);
  if (
    !finished ||
    fixture.homeGoals == null ||
    fixture.awayGoals == null ||
    !leg.market
  ) {
    return { ...enriched, status: "pending" };
  }

  const status = evaluateMarket(leg.market, factsFromFixture(fixture));
  if (status === "need_stats") {
    return { ...enriched, status: "pending" };
  }

  return {
    ...enriched,
    status,
  };
}

export function applyFixturesToBets(
  bets: HistoryBet[],
  fixtures: FixtureResult[]
): { bets: HistoryBet[]; updatedTickets: number } {
  const byId = new Map(fixtures.map((f) => [f.fixtureId, f]));
  let updatedTickets = 0;

  const next = bets.map((bet) => {
    const hasRelevant = bet.legs.some((l) => byId.has(l.fixtureId));
    if (!hasRelevant) return bet;

    let changed = false;
    const legs = bet.legs.map((leg) => {
      const fixture = byId.get(leg.fixtureId);
      if (!fixture) return leg;
      const updated = applyFixtureToLeg(leg, fixture);
      if (legSnapshot(updated) !== legSnapshot(leg)) changed = true;
      return updated;
    });

    if (!changed) return bet;

    const status = deriveTicketStatus(legs);
    updatedTickets += 1;
    return {
      ...bet,
      legs,
      status,
      settledAt:
        status === "pending" ? undefined : new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
    };
  });

  return { bets: next, updatedTickets };
}

export function collectPendingFixtureIds(bets: HistoryBet[]): number[] {
  const ids = new Set<number>();
  const now = Date.now();
  for (const bet of bets) {
    for (const leg of bet.legs) {
      if (leg.status !== "pending" || leg.fixtureId <= 0) continue;
      if (leg.kickoff && !isKickoffDueForSettlement(leg.kickoff, now)) {
        continue;
      }
      ids.add(leg.fixtureId);
    }
  }
  return Array.from(ids);
}

export function collectPendingKickoffsById(
  bets: HistoryBet[]
): Record<number, string> {
  const map: Record<number, string> = {};
  const now = Date.now();
  for (const bet of bets) {
    for (const leg of bet.legs) {
      if (leg.status !== "pending" || leg.fixtureId <= 0 || !leg.kickoff) {
        continue;
      }
      if (!isKickoffDueForSettlement(leg.kickoff, now)) continue;
      map[leg.fixtureId] = leg.kickoff;
    }
  }
  return map;
}

/**
 * Client-side: query `/api/results`, evaluate legs, persist.
 * Each leg stores its own status (won | lost | pending | void) + finalScore.
 */
export async function updatePendingBets(): Promise<UpdatePendingResult> {
  const bets = loadBets();
  const fixtureIds = collectPendingFixtureIds(bets);
  const kickoffsById = collectPendingKickoffsById(bets);

  if (fixtureIds.length === 0) {
    const stillPending = bets.filter((b) => b.status === "pending").length;
    return {
      ok: true,
      checkedFixtures: 0,
      updatedTickets: 0,
      stillPending,
      bets,
    };
  }

  try {
    const res = await fetch("/api/results", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixtureIds, kickoffsById }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        checkedFixtures: 0,
        updatedTickets: 0,
        stillPending: bets.filter((b) => b.status === "pending").length,
        error:
          typeof data.error === "string"
            ? data.error
            : "No se pudieron obtener resultados de API-Football.",
        bets,
      };
    }

    const fixtures = (data.fixtures ?? []) as FixtureResult[];
    const { bets: updated, updatedTickets } = applyFixturesToBets(
      bets,
      fixtures
    );
    saveBets(updated);

    // Mirror outcomes into SQLite for /stats analytics
    try {
      await fetch("/api/bets/sync-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bets: updated }),
      });
    } catch {
      // Non-fatal: local history still updated
    }

    return {
      ok: true,
      checkedFixtures: fixtures.length,
      updatedTickets,
      stillPending: updated.filter((b) => b.status === "pending").length,
      bets: updated,
    };
  } catch {
    return {
      ok: false,
      checkedFixtures: 0,
      updatedTickets: 0,
      stillPending: bets.filter((b) => b.status === "pending").length,
      error: "Error de red al consultar resultados.",
      bets,
    };
  }
}

