/**
 * Walk-forward backtest using the same predictMatchMarkets engine as live.
 * Strict asOf = match kickoff; only prior FT rows inform features/profiles.
 */
import {
  buildTeamIndexAtCutoff,
  type LocalFixtureRowForTest,
} from "./fixture-context";
import {
  applyBrierLearningToWeightsAsOf,
  type BrierPickRow,
} from "./learning-engine";
import { loadModelWeights } from "./model-weights";
import { predictMatchMarkets } from "./poisson";
import type {
  BacktestMarket,
  BacktestSummary,
  FdMatchResult,
} from "./sources/football-data";
import { BACKTEST_FALLBACK_MIN_ODDS } from "./sources/football-data";
import {
  aggregateTeamEvents,
  getTeamProfileAt,
  loadTeamIdMaps,
  primeTeamProfileAt,
  resolveTeamId,
  type TeamProfileSnapshot,
} from "./team-profiler";
import type { LeagueId, MarketType, Match } from "./types";
import { valueMarginPercent } from "./value-finder";

const FD_COMPETITION: Record<
  string,
  { leagueId: string; leagueName: string; league: LeagueId }
> = {
  PL: { leagueId: "39", leagueName: "Premier League", league: "premier-league" },
  PD: { leagueId: "140", leagueName: "La Liga", league: "laliga" },
  SA: { leagueId: "135", leagueName: "Serie A", league: "serie-a" },
  BL1: { leagueId: "78", leagueName: "Bundesliga", league: "bundesliga" },
  FL1: { leagueId: "61", leagueName: "Ligue 1", league: "ligue-1" },
};

type TeamHistory = ReturnType<typeof buildTeamIndexAtCutoff> extends Map<
  string,
  infer H
>
  ? H
  : never;

function avg(values: number[], fallback: number): number {
  if (!values.length) return fallback;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function normalizeTeamKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamBrierFromWeights(
  rows: BrierPickRow[],
  asOf: Date,
  teamName: string,
  fallback: number | undefined
): number {
  if (!rows.length) return fallback ?? 1;
  const result = applyBrierLearningToWeightsAsOf(
    rows,
    asOf,
    loadModelWeights()
  );
  const key = normalizeTeamKey(teamName);
  const team =
    result.teams.find((t) => normalizeTeamKey(t.key) === key) ??
    result.teams.find(
      (t) =>
        normalizeTeamKey(t.key).includes(key) ||
        key.includes(normalizeTeamKey(t.key))
    );
  return team?.nextFactor ?? fallback ?? 1;
}

function findHistory(
  index: ReturnType<typeof buildTeamIndexAtCutoff>,
  teamName: string
): TeamHistory | null {
  const key = normalizeTeamKey(teamName);
  const exact = index.get(key);
  if (exact) return exact;
  for (const [k, hist] of index) {
    if (k.includes(key) || key.includes(k)) return hist;
  }
  return null;
}

function fdToLocalRows(matches: FdMatchResult[]): LocalFixtureRowForTest[] {
  return matches
    .filter((m) => m.homeGoals != null && m.awayGoals != null)
    .map((m) => ({
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      matchDate: new Date(m.utcDate),
      homeGoals: m.homeGoals!,
      awayGoals: m.awayGoals!,
    }));
}

function defaultTeam(name: string, id?: number): Match["home"] {
  return {
    id,
    name,
    shortName: name.slice(0, 3).toUpperCase(),
    form: [],
    goalsScoredAvg: 1.3,
    goalsConcededAvg: 1.2,
    homeGoalsScoredAvg: 1.4,
    homeGoalsConcededAvg: 1.1,
    awayGoalsScoredAvg: 1.1,
    awayGoalsConcededAvg: 1.3,
    lastMatchAt: null,
  };
}

function enrichTeamFromHistory(
  base: Match["home"],
  hist: TeamHistory | null
): Match["home"] {
  if (!hist) return base;
  const goalsScoredAvg = avg(hist.allScored, base.goalsScoredAvg);
  const goalsConcededAvg = avg(hist.allConceded, base.goalsConcededAvg);
  return {
    ...base,
    form: hist.form.length ? hist.form : base.form,
    goalsScoredAvg: Number(goalsScoredAvg.toFixed(3)),
    goalsConcededAvg: Number(goalsConcededAvg.toFixed(3)),
    homeGoalsScoredAvg: Number(
      avg(hist.homeScored, goalsScoredAvg).toFixed(3)
    ),
    homeGoalsConcededAvg: Number(
      avg(hist.homeConceded, goalsConcededAvg).toFixed(3)
    ),
    awayGoalsScoredAvg: Number(
      avg(hist.awayScored, goalsScoredAvg).toFixed(3)
    ),
    awayGoalsConcededAvg: Number(
      avg(hist.awayConceded, goalsConcededAvg).toFixed(3)
    ),
    lastMatchAt: hist.lastMatchAt ?? base.lastMatchAt ?? null,
  };
}

function fdEventsForTeam(
  teamName: string,
  prior: FdMatchResult[]
): Array<{
  at: number;
  venue: "home" | "away";
  scored: number;
  conceded: number;
  totalGoals: number;
  teamName: string;
}> {
  const events: Array<{
    at: number;
    venue: "home" | "away";
    scored: number;
    conceded: number;
    totalGoals: number;
    teamName: string;
  }> = [];
  for (const m of prior) {
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const at = Date.parse(m.utcDate);
    if (!Number.isFinite(at)) continue;
    const total = m.homeGoals + m.awayGoals;
    if (m.homeTeam === teamName) {
      events.push({
        at,
        venue: "home",
        scored: m.homeGoals,
        conceded: m.awayGoals,
        totalGoals: total,
        teamName,
      });
    }
    if (m.awayTeam === teamName) {
      events.push({
        at,
        venue: "away",
        scored: m.awayGoals,
        conceded: m.homeGoals,
        totalGoals: total,
        teamName,
      });
    }
  }
  return events;
}

function profileFromFdEvents(
  teamId: number,
  teamName: string,
  prior: FdMatchResult[],
  asOf: Date
): TeamProfileSnapshot | null {
  const asOfMs = asOf.getTime();
  const events = fdEventsForTeam(teamName, prior).filter((e) => e.at < asOfMs);
  if (!events.length) return null;
  const agg = aggregateTeamEvents(events);
  return {
    teamId,
    ...agg,
    keyAbsencesCount: 0,
    brierCalibrationFactor: 1,
    updatedAt: new Date().toISOString(),
  };
}

async function resolveProfileAt(
  teamId: number | null,
  teamName: string,
  prior: FdMatchResult[],
  asOf: Date
): Promise<TeamProfileSnapshot | null> {
  if (teamId != null && teamId > 0) {
    const db = await getTeamProfileAt(teamId, asOf);
    if (db) return db;
  }
  if (teamId == null || teamId <= 0) return null;
  return profileFromFdEvents(teamId, teamName, prior, asOf);
}

function buildH2h(
  prior: FdMatchResult[],
  homeName: string,
  awayName: string,
  kickoff: string
): Match["h2h"] {
  const kickoffMs = Date.parse(kickoff);
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let goalSum = 0;
  let n = 0;
  for (const fx of prior) {
    if (fx.homeGoals == null || fx.awayGoals == null) continue;
    if (Number.isFinite(kickoffMs) && Date.parse(fx.utcDate) >= kickoffMs) {
      continue;
    }
    const isPair =
      (fx.homeTeam === homeName && fx.awayTeam === awayName) ||
      (fx.homeTeam === awayName && fx.awayTeam === homeName);
    if (!isPair) continue;
    n += 1;
    goalSum += fx.homeGoals + fx.awayGoals;
    if (fx.homeTeam === homeName) {
      if (fx.homeGoals > fx.awayGoals) homeWins += 1;
      else if (fx.homeGoals === fx.awayGoals) draws += 1;
      else awayWins += 1;
    } else {
      if (fx.awayGoals > fx.homeGoals) homeWins += 1;
      else if (fx.awayGoals === fx.homeGoals) draws += 1;
      else awayWins += 1;
    }
  }
  return {
    homeWins,
    draws,
    awayWins,
    avgGoals: n > 0 ? Number((goalSum / n).toFixed(2)) : 2.4,
  };
}

function buildMatchFromFd(
  m: FdMatchResult,
  prior: FdMatchResult[],
  competition: string,
  homeId: number | null,
  awayId: number | null
): Match {
  const meta = FD_COMPETITION[competition] ?? {
    leagueId: "0",
    leagueName: competition,
    league: "other-domestic" as LeagueId,
  };
  const asOf = new Date(m.utcDate);
  const fixtures = fdToLocalRows(prior);
  const index = buildTeamIndexAtCutoff(fixtures, asOf);
  const homeBase = defaultTeam(m.homeTeam, homeId ?? undefined);
  const awayBase = defaultTeam(m.awayTeam, awayId ?? undefined);

  return {
    id: `fd-${m.id}`,
    league: meta.league,
    leagueName: meta.leagueName,
    leagueId: meta.leagueId,
    kickoff: m.utcDate,
    home: enrichTeamFromHistory(homeBase, findHistory(index, m.homeTeam)),
    away: enrichTeamFromHistory(awayBase, findHistory(index, m.awayTeam)),
    h2h: buildH2h(prior, m.homeTeam, m.awayTeam, m.utcDate),
    odds: {
      home: m.odds?.home,
      draw: m.odds?.draw,
      away: m.odds?.away,
      over25: m.odds?.over25,
      under25: m.odds?.under25,
      doubleChance1X: undefined,
      doubleChanceX2: undefined,
      over05: 1.08,
      over15: 1.3,
      under35: 1.4,
      under45: 1.15,
      bttsYes: 1.75,
      bttsNo: 2.0,
      dnbHome: undefined,
      dnbAway: undefined,
      homeScores: 1.35,
      awayScores: 1.42,
    },
  };
}

const MARKET_FILTER: Record<BacktestMarket, Set<MarketType> | null> = {
  ALL: null,
  "1X2": new Set(["home", "draw", "away", "1x", "x2"]),
  OVER_UNDER_2_5: new Set(["over_2_5", "under_2_5"]),
  DNB: new Set(["dnb_home", "dnb_away"]),
};

function marketWon(market: MarketType, hg: number, ag: number): boolean | null {
  const total = hg + ag;
  switch (market) {
    case "home":
      return hg > ag;
    case "draw":
      return hg === ag;
    case "away":
      return hg < ag;
    case "over_2_5":
      return total > 2.5;
    case "under_2_5":
      return total < 2.5;
    case "dnb_home":
      return hg > ag ? true : hg < ag ? false : null;
    case "dnb_away":
      return hg < ag ? true : hg > ag ? false : null;
    case "1x":
      return hg >= ag;
    case "x2":
      return hg <= ag;
    default:
      return null;
  }
}

export type ReplayBacktestOptions = {
  threshold?: number;
  market?: BacktestMarket;
  minOdds?: number;
  maxOdds?: number;
  competition?: string;
  brierRows?: BrierPickRow[];
  autoMinOddsFallback?: boolean;
};

export type ReplayBacktestSummary = BacktestSummary & {
  engine: "replay";
  unmappedTeams: number;
};

/**
 * Expanding-window replay: each match uses only data strictly before its kickoff.
 */
export async function runReplayBacktest(
  matches: FdMatchResult[],
  options: ReplayBacktestOptions = {}
): Promise<ReplayBacktestSummary> {
  const threshold = options.threshold ?? 3;
  const minOdds = options.minOdds ?? 1.4;
  const maxOdds = options.maxOdds ?? 1.85;
  const market = options.market ?? "ALL";
  const competition = options.competition ?? "PL";
  const filter = MARKET_FILTER[market];

  const sorted = [...matches]
    .filter((m) => m.homeGoals != null && m.awayGoals != null)
    .sort(
      (a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate) || a.id - b.id
    );

  const { byName } = await loadTeamIdMaps();
  let unmappedTeams = 0;
  let nBets = 0;
  let wins = 0;
  let stake = 0;
  let returns = 0;
  const byMarket: Record<string, { nBets: number; wins: number }> = {};

  const prior: FdMatchResult[] = [];
  const brierRows = options.brierRows ?? [];

  for (const m of sorted) {
    const asOf = new Date(m.utcDate);
    const homeId = resolveTeamId(m.homeTeam, undefined, byName);
    const awayId = resolveTeamId(m.awayTeam, undefined, byName);
    if (homeId == null) unmappedTeams += 1;
    if (awayId == null) unmappedTeams += 1;

    const homeProfile = await resolveProfileAt(
      homeId,
      m.homeTeam,
      prior,
      asOf
    );
    const awayProfile = await resolveProfileAt(
      awayId,
      m.awayTeam,
      prior,
      asOf
    );
    if (homeProfile) {
      const homeBrier = teamBrierFromWeights(
        brierRows,
        asOf,
        m.homeTeam,
        homeProfile.brierCalibrationFactor
      );
      homeProfile.brierCalibrationFactor = homeBrier;
      primeTeamProfileAt(homeProfile, asOf);
    }
    if (awayProfile) {
      const awayBrier = teamBrierFromWeights(
        brierRows,
        asOf,
        m.awayTeam,
        awayProfile.brierCalibrationFactor
      );
      awayProfile.brierCalibrationFactor = awayBrier;
      primeTeamProfileAt(awayProfile, asOf);
    }

    const match = buildMatchFromFd(m, prior, competition, homeId, awayId);

    const { markets: preds } = predictMatchMarkets(match, {
      asOf,
      minSafeOdds: minOdds,
      maxSafeOdds: maxOdds,
    });

    const hg = m.homeGoals!;
    const ag = m.awayGoals!;
    const isDraw = hg === ag;

    for (const p of preds) {
      if (filter && !filter.has(p.market)) continue;
      if (p.odds < minOdds || p.odds > maxOdds) continue;
      if (valueMarginPercent(p.modelProbability, p.odds) < threshold) continue;

      const won = marketWon(p.market, hg, ag);
      if (won === null) {
        if ((p.market === "dnb_home" || p.market === "dnb_away") && isDraw) {
          nBets += 1;
          stake += 1;
          returns += 1;
          const bucket = (byMarket[p.market] ??= { nBets: 0, wins: 0 });
          bucket.nBets += 1;
        }
        continue;
      }

      nBets += 1;
      stake += 1;
      const bucket = (byMarket[p.market] ??= { nBets: 0, wins: 0 });
      bucket.nBets += 1;
      if (won) {
        wins += 1;
        bucket.wins += 1;
        returns += p.odds;
      }
    }

    prior.push(m);
  }

  const roi = stake > 0 ? (returns - stake) / stake : 0;
  const summary: ReplayBacktestSummary = {
    engine: "replay",
    nMatches: sorted.length,
    nBets,
    wins,
    stakeUnits: stake,
    returnUnits: Number(returns.toFixed(2)),
    winRate: nBets > 0 ? Number(((wins / nBets) * 100).toFixed(2)) : 0,
    roi: Number((roi * 100).toFixed(2)),
    threshold,
    minOdds,
    maxOdds,
    market,
    byMarket,
    unmappedTeams,
    minOddsFallbackApplied: false,
  };

  if (
    options.autoMinOddsFallback !== false &&
    summary.nBets === 0 &&
    market === "1X2"
  ) {
    const fallback = await runReplayBacktest(matches, {
      ...options,
      minOdds: BACKTEST_FALLBACK_MIN_ODDS,
      autoMinOddsFallback: false,
    });
    return {
      ...fallback,
      minOdds: BACKTEST_FALLBACK_MIN_ODDS,
      minOddsFallbackApplied: true,
    };
  }

  return summary;
}
