/**
 * Football-Data.org — historical results + closing odds for paper backtests.
 * Auth: X-Auth-Token. Free plan ~10 req/min — honor quota headers + 429 backoff.
 */
import {
  buildCacheKey,
  CACHE_TTL_MINUTES,
  getCachedPayload,
  getCachedPayloadAllowStale,
  upsertCachedPayload,
} from "../api-cache";
import {
  buildScoreMatrix,
  matchOutcomeProbabilities,
  overUnderProbability,
} from "../poisson";
import { valueMarginPercent } from "../value-finder";

export type FdMatchOdds = {
  /** Closing 1X2 (homeWin / PSH aliases). */
  home?: number;
  draw?: number;
  away?: number;
  /** Closing Over 2.5 when present (BbAv>2.5 / over25). */
  over25?: number;
  under25?: number;
};

export type FdMatchResult = {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
  odds?: FdMatchOdds;
};

export type BacktestMarket =
  | "ALL"
  | "1X2"
  | "OVER_UNDER_2_5"
  | "DNB";

export type BacktestSummary = {
  nMatches: number;
  nBets: number;
  wins: number;
  stakeUnits: number;
  returnUnits: number;
  winRate: number;
  roi: number;
  threshold: number;
  market: BacktestMarket;
  byMarket: Record<string, { nBets: number; wins: number }>;
};

type FdApiMatch = {
  id?: number;
  utcDate?: string;
  status?: string;
  homeTeam?: { name?: string; id?: number };
  awayTeam?: { name?: string; id?: number };
  score?: {
    fullTime?: { home?: number | null; away?: number | null };
  };
  odds?: Record<string, number | string | undefined | null>;
};

type FdQuota = {
  availableMinute: number | null;
  resetSeconds: number | null;
};

/** Earliest time we may hit the API again (ms). */
let throttleUntilMs = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Parse Football-Data.org rate-limit headers after each response. */
export function parseFootballDataQuota(headers: Headers): FdQuota {
  return {
    availableMinute: headerInt(headers, "X-Requests-Available-Minute"),
    resetSeconds: headerInt(headers, "X-RequestCounter-Reset"),
  };
}

function noteQuota(headers: Headers): void {
  const q = parseFootballDataQuota(headers);
  if (q.availableMinute != null && q.availableMinute <= 0) {
    const waitSec = Math.max(1, q.resetSeconds ?? 60);
    throttleUntilMs = Math.max(throttleUntilMs, Date.now() + waitSec * 1000);
    console.warn(
      `[football-data] quota exhausted — throttle ${waitSec}s (reset=${q.resetSeconds})`
    );
  }
}

async function awaitThrottle(): Promise<void> {
  const wait = throttleUntilMs - Date.now();
  if (wait > 0) {
    console.warn(`[football-data] waiting ${Math.ceil(wait / 1000)}s for rate limit`);
    await sleep(Math.min(wait, 65_000));
  }
}

function authToken(): string | null {
  const token = process.env.FOOTBALL_DATA_API_KEY?.trim() || null;
  console.log(
    "[FootballData] Key loaded:",
    process.env.FOOTBALL_DATA_API_KEY ? "YES" : "NO"
  );
  return token;
}

function numOdds(value: unknown): number | undefined {
  if (typeof value === "number" && value > 1) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) && n > 1 ? n : undefined;
  }
  return undefined;
}

/** Map FD JSON + CSV-style aliases (PSH/PSD/PSA, BbAv>2.5). */
function mapOdds(raw: FdApiMatch["odds"]): FdMatchOdds | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const home =
    numOdds(raw.homeWin) ??
    numOdds(raw.home) ??
    numOdds(raw.PSH) ??
    numOdds(raw.psh) ??
    numOdds(raw.B365H);
  const draw =
    numOdds(raw.draw) ??
    numOdds(raw.PSD) ??
    numOdds(raw.psd) ??
    numOdds(raw.B365D);
  const away =
    numOdds(raw.awayWin) ??
    numOdds(raw.away) ??
    numOdds(raw.PSA) ??
    numOdds(raw.psa) ??
    numOdds(raw.B365A);
  const over25 =
    numOdds(raw.over25) ??
    numOdds(raw.over_2_5) ??
    numOdds(raw["BbAv>2.5"]) ??
    numOdds(raw["bbav>2.5"]) ??
    numOdds(raw["B365>2.5"]);
  const under25 =
    numOdds(raw.under25) ??
    numOdds(raw.under_2_5) ??
    numOdds(raw["BbAv<2.5"]) ??
    numOdds(raw["B365<2.5"]);

  if (!home && !draw && !away && !over25 && !under25) return undefined;
  return { home, draw, away, over25, under25 };
}

function mapMatches(rows: FdApiMatch[]): FdMatchResult[] {
  return rows
    .filter((m) => m.id != null)
    .map((m) => ({
      id: m.id as number,
      utcDate: m.utcDate ?? "",
      status: m.status ?? "FINISHED",
      homeTeam: m.homeTeam?.name ?? "Home",
      awayTeam: m.awayTeam?.name ?? "Away",
      homeGoals: m.score?.fullTime?.home ?? null,
      awayGoals: m.score?.fullTime?.away ?? null,
      odds: mapOdds(m.odds),
    }));
}

type FdFetchResult = {
  status: number;
  raw: string;
  ok: boolean;
};

async function fdFetch(
  url: string,
  apiKey: string,
  attempt = 0
): Promise<FdFetchResult | null> {
  await awaitThrottle();

  const res = await fetch(url, {
    headers: {
      "X-Auth-Token": apiKey,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  noteQuota(res.headers);
  const raw = await res.text();
  console.log("[FootballData] status:", res.status);
  console.log("[FootballData] raw response:", raw);

  if (res.status === 429) {
    const q = parseFootballDataQuota(res.headers);
    const waitSec = Math.max(1, q.resetSeconds ?? 60);
    throttleUntilMs = Math.max(throttleUntilMs, Date.now() + waitSec * 1000);
    console.warn(
      `[football-data] 429 Too Many Requests — backoff ${waitSec}s (attempt=${attempt})`
    );
    if (attempt < 1) {
      await sleep(Math.min(waitSec * 1000, 65_000));
      return fdFetch(url, apiKey, attempt + 1);
    }
    return null;
  }

  return { status: res.status, raw, ok: res.ok };
}

/** Common competition codes: PL, PD, SA, BL1, FL1, CL, … */
export async function fetchHistoricalMatches(
  competition: string,
  season: number
): Promise<FdMatchResult[]> {
  const code = competition.trim().toUpperCase();
  if (!code || !Number.isFinite(season)) return [];

  const cacheKey = buildCacheKey("football_data", {
    competition: code,
    season,
  });
  const cached = await getCachedPayload<FdMatchResult[]>(cacheKey);
  if (cached) return cached;

  const apiKey = authToken();
  if (!apiKey) {
    console.warn("[football-data] FOOTBALL_DATA_API_KEY missing — empty set");
    return (await getCachedPayloadAllowStale<FdMatchResult[]>(cacheKey)) ?? [];
  }

  const url =
    `https://api.football-data.org/v4/competitions/${encodeURIComponent(code)}` +
    `/matches?season=${season}&status=FINISHED`;

  try {
    const res = await fdFetch(url, apiKey);
    if (!res || !res.ok) {
      if (res) {
        console.warn(`[football-data] HTTP ${res.status} ${code}/${season}`);
      }
      const stale = await getCachedPayloadAllowStale<FdMatchResult[]>(cacheKey);
      if (stale) {
        console.warn(
          `[football-data] falling back to stale cache ${code}/${season} (n=${stale.length})`
        );
        return stale;
      }
      return [];
    }

    const data = JSON.parse(res.raw) as { matches?: FdApiMatch[] };
    const rows = mapMatches(data.matches ?? []);

    const ttl =
      season < new Date().getFullYear() ? null : CACHE_TTL_MINUTES.FOOTBALL_DATA;
    await upsertCachedPayload(cacheKey, "football_data", rows, ttl);
    return rows;
  } catch (err) {
    console.warn("[football-data] fetch failed:", err);
    return (
      (await getCachedPayloadAllowStale<FdMatchResult[]>(cacheKey)) ?? []
    );
  }
}

type TeamAgg = {
  homeFor: number;
  homeAgainst: number;
  homeN: number;
  awayFor: number;
  awayAgainst: number;
  awayN: number;
};

function emptyAgg(): TeamAgg {
  return {
    homeFor: 0,
    homeAgainst: 0,
    homeN: 0,
    awayFor: 0,
    awayAgainst: 0,
    awayN: 0,
  };
}

/** Season team avgs → Poisson λ (leave-one-out soft: use full season sample). */
function buildTeamAggs(matches: FdMatchResult[]): {
  byTeam: Map<string, TeamAgg>;
  leagueHomeAvg: number;
  leagueAwayAvg: number;
} {
  const byTeam = new Map<string, TeamAgg>();
  let homeGoals = 0;
  let awayGoals = 0;
  let n = 0;

  for (const m of matches) {
    if (m.homeGoals == null || m.awayGoals == null) continue;
    n += 1;
    homeGoals += m.homeGoals;
    awayGoals += m.awayGoals;

    const home = byTeam.get(m.homeTeam) ?? emptyAgg();
    home.homeFor += m.homeGoals;
    home.homeAgainst += m.awayGoals;
    home.homeN += 1;
    byTeam.set(m.homeTeam, home);

    const away = byTeam.get(m.awayTeam) ?? emptyAgg();
    away.awayFor += m.awayGoals;
    away.awayAgainst += m.homeGoals;
    away.awayN += 1;
    byTeam.set(m.awayTeam, away);
  }

  return {
    byTeam,
    leagueHomeAvg: n > 0 ? homeGoals / n : 1.35,
    leagueAwayAvg: n > 0 ? awayGoals / n : 1.15,
  };
}

function teamRate(
  scored: number,
  n: number,
  leagueAvg: number
): number {
  if (n <= 0) return 1;
  return Math.max(0.4, Math.min(2.5, scored / n / leagueAvg));
}

function estimateLambdas(
  m: FdMatchResult,
  byTeam: Map<string, TeamAgg>,
  leagueHomeAvg: number,
  leagueAwayAvg: number
): { home: number; away: number } {
  const home = byTeam.get(m.homeTeam) ?? emptyAgg();
  const away = byTeam.get(m.awayTeam) ?? emptyAgg();
  const homeAttack = teamRate(home.homeFor, home.homeN, leagueHomeAvg);
  const awayDefense = teamRate(away.awayAgainst, away.awayN, leagueHomeAvg);
  const awayAttack = teamRate(away.awayFor, away.awayN, leagueAwayAvg);
  const homeDefense = teamRate(home.homeAgainst, home.homeN, leagueAwayAvg);
  const homeAdv = 1.08;
  return {
    home: Math.max(
      0.2,
      Math.min(4.5, leagueHomeAvg * homeAttack * awayDefense * homeAdv)
    ),
    away: Math.max(
      0.2,
      Math.min(4.5, leagueAwayAvg * awayAttack * homeDefense)
    ),
  };
}

function dnbOddsFrom1x2(
  homeOdds?: number,
  awayOdds?: number
): { dnbHome?: number; dnbAway?: number } {
  if (!(homeOdds && homeOdds > 1 && awayOdds && awayOdds > 1)) return {};
  const pH = 1 / homeOdds;
  const pA = 1 / awayOdds;
  const denom = pH + pA;
  if (!(denom > 0)) return {};
  return {
    dnbHome: Number((1 / (pH / denom)).toFixed(3)),
    dnbAway: Number((1 / (pA / denom)).toFixed(3)),
  };
}

type Candidate = {
  market: string;
  modelP: number;
  odds: number;
  won: boolean;
};

function candidatesForMatch(
  m: FdMatchResult,
  model: {
    home: number;
    draw: number;
    away: number;
    over25: number;
    dnbHome: number;
    dnbAway: number;
  },
  market: BacktestMarket
): Candidate[] {
  const out: Candidate[] = [];
  const hg = m.homeGoals!;
  const ag = m.awayGoals!;
  const total = hg + ag;
  const dnbBook = dnbOddsFrom1x2(m.odds?.home, m.odds?.away);

  const want1x2 = market === "ALL" || market === "1X2";
  const wantOu = market === "ALL" || market === "OVER_UNDER_2_5";
  const wantDnb = market === "ALL" || market === "DNB";

  if (want1x2) {
    if (m.odds?.home && m.odds.home > 1) {
      out.push({
        market: "home",
        modelP: model.home,
        odds: m.odds.home,
        won: hg > ag,
      });
    }
    if (m.odds?.draw && m.odds.draw > 1) {
      out.push({
        market: "draw",
        modelP: model.draw,
        odds: m.odds.draw,
        won: hg === ag,
      });
    }
    if (m.odds?.away && m.odds.away > 1) {
      out.push({
        market: "away",
        modelP: model.away,
        odds: m.odds.away,
        won: hg < ag,
      });
    }
  }

  if (wantOu) {
    if (m.odds?.over25 && m.odds.over25 > 1) {
      out.push({
        market: "over_2_5",
        modelP: model.over25,
        odds: m.odds.over25,
        won: total > 2.5,
      });
    }
    if (m.odds?.under25 && m.odds.under25 > 1) {
      out.push({
        market: "under_2_5",
        modelP: 1 - model.over25,
        odds: m.odds.under25,
        won: total < 2.5,
      });
    }
  }

  if (wantDnb) {
    if (dnbBook.dnbHome && dnbBook.dnbHome > 1) {
      out.push({
        market: "dnb_home",
        modelP: model.dnbHome,
        odds: dnbBook.dnbHome,
        won: hg > ag ? true : hg < ag ? false : false, // draw → void handled below
      });
    }
    if (dnbBook.dnbAway && dnbBook.dnbAway > 1) {
      out.push({
        market: "dnb_away",
        modelP: model.dnbAway,
        odds: dnbBook.dnbAway,
        won: hg < ag ? true : hg > ag ? false : false,
      });
    }
  }

  return out;
}

/**
 * Paper-trade: season Poisson model vs closing odds.
 * Places unit bets when ValueMarginPercent >= threshold.
 * DNB draws return stake (void).
 */
export function runPaperBacktest(
  matches: FdMatchResult[],
  options: { threshold?: number; market?: BacktestMarket } = {}
): BacktestSummary {
  const threshold = options.threshold ?? 2;
  const market = options.market ?? "ALL";
  const { byTeam, leagueHomeAvg, leagueAwayAvg } = buildTeamAggs(matches);

  let nBets = 0;
  let wins = 0;
  let stake = 0;
  let returns = 0;
  const byMarket: Record<string, { nBets: number; wins: number }> = {};

  for (const m of matches) {
    if (m.homeGoals == null || m.awayGoals == null) continue;

    const λ = estimateLambdas(m, byTeam, leagueHomeAvg, leagueAwayAvg);
    const matrix = buildScoreMatrix(λ.home, λ.away);
    const outcomes = matchOutcomeProbabilities(matrix);
    const over25 = overUnderProbability(matrix, 2.5);
    const decisive = outcomes.home + outcomes.away;
    const model = {
      home: outcomes.home,
      draw: outcomes.draw,
      away: outcomes.away,
      over25,
      dnbHome: decisive > 0 ? outcomes.home / decisive : 0.5,
      dnbAway: decisive > 0 ? outcomes.away / decisive : 0.5,
    };

    const isDraw = m.homeGoals === m.awayGoals;

    for (const c of candidatesForMatch(m, model, market)) {
      if (valueMarginPercent(c.modelP, c.odds) < threshold) continue;

      nBets += 1;
      stake += 1;
      const bucket = (byMarket[c.market] ??= { nBets: 0, wins: 0 });
      bucket.nBets += 1;

      // DNB void on draw → stake returned
      if ((c.market === "dnb_home" || c.market === "dnb_away") && isDraw) {
        returns += 1;
        continue;
      }

      if (c.won) {
        wins += 1;
        bucket.wins += 1;
        returns += c.odds;
      }
    }
  }

  const roi = stake > 0 ? (returns - stake) / stake : 0;
  return {
    nMatches: matches.length,
    nBets,
    wins,
    stakeUnits: stake,
    returnUnits: Number(returns.toFixed(2)),
    winRate: nBets > 0 ? Number(((wins / nBets) * 100).toFixed(2)) : 0,
    roi: Number((roi * 100).toFixed(2)),
    threshold,
    market,
    byMarket,
  };
}

export function parseBacktestMarket(raw: string | null): BacktestMarket {
  const v = (raw ?? "ALL").trim().toUpperCase();
  if (
    v === "ALL" ||
    v === "1X2" ||
    v === "OVER_UNDER_2_5" ||
    v === "DNB"
  ) {
    return v;
  }
  return "ALL";
}
