import type { MarketType } from "./types";
import {
  type BetStatus,
  type HistoryBet,
  type HistoryBetLeg,
  type LegStatus,
  loadBets,
  saveBets,
  purgeFakeHistory,
} from "./history-tracker";
import { chileDateString, formatKickoffTime } from "./utils";

export type FixtureResult = {
  fixtureId: number;
  statusShort: string;
  finished: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  homeName?: string;
  awayName?: string;
  date?: string;
  /** Live minute from API-Football (null if not in-play) */
  elapsed?: number | null;
};

export type UpdatePendingResult = {
  ok: boolean;
  checkedFixtures: number;
  updatedTickets: number;
  stillPending: number;
  error?: string;
  bets: HistoryBet[];
};

const FINISHED_STATUSES = new Set([
  "FT",
  "AET",
  "PEN",
  "AWD",
  "WO",
]);

const LIVE_STATUSES = new Set([
  "1H",
  "2H",
  "HT",
  "ET",
  "BT",
  "P",
  "LIVE",
  "INT",
]);

export function isFixtureFinished(statusShort: string): boolean {
  return FINISHED_STATUSES.has(statusShort.toUpperCase());
}

export function isFixtureLive(statusShort: string): boolean {
  return LIVE_STATUSES.has(statusShort.toUpperCase());
}

/**
 * Evaluate a market against a final score.
 * Returns won | lost | void. Caller must ensure the match is finished.
 */
export function evaluateMarket(
  market: MarketType,
  homeGoals: number,
  awayGoals: number
): Exclude<LegStatus, "pending"> {
  const total = homeGoals + awayGoals;

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
    case "dnb_home":
      if (homeGoals === awayGoals) return "void";
      return homeGoals > awayGoals ? "won" : "lost";
    case "dnb_away":
      if (homeGoals === awayGoals) return "void";
      return awayGoals > homeGoals ? "won" : "lost";
    default:
      return "lost";
  }
}

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

  if (isFixtureFinished(short) && score) {
    return `${score} (${short || "FT"})`;
  }

  if (isFixtureLive(short)) {
    const minute =
      leg.elapsed != null ? `${leg.elapsed}'` : short || "LIVE";
    if (score) return `${score} · En Vivo ${minute}`;
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

  if (
    !fixture.finished ||
    fixture.homeGoals == null ||
    fixture.awayGoals == null ||
    !leg.market
  ) {
    return { ...enriched, status: "pending" };
  }

  const status = evaluateMarket(
    leg.market,
    fixture.homeGoals,
    fixture.awayGoals
  );

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
  for (const bet of bets) {
    for (const leg of bet.legs) {
      // Re-check pending legs; also refresh live metadata
      if (leg.status === "pending" && leg.fixtureId > 0) {
        ids.add(leg.fixtureId);
      }
    }
  }
  return Array.from(ids);
}

/**
 * Client-side: purge fake data, query `/api/results`, evaluate legs, persist.
 * Each leg stores its own status (won | lost | pending | void) + finalScore.
 */
export async function updatePendingBets(): Promise<UpdatePendingResult> {
  purgeFakeHistory();
  const bets = loadBets();
  const fixtureIds = collectPendingFixtureIds(bets);

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixtureIds }),
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
