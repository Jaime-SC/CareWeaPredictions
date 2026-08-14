import type { Match, MatchOdds, TeamStats } from "./types";

type ApiOddsValue = { value: string; odd: string };
type ApiOddsBet = { id: number; name: string; values: ApiOddsValue[] };
type ApiOddsBookmaker = {
  id: number;
  name: string;
  bets: ApiOddsBet[];
};

export type ApiOddsFixture = {
  fixture: { id: number };
  bookmakers?: ApiOddsBookmaker[];
};

const PREFERRED_BOOKMAKER_IDS = [8, 6, 11, 1, 4]; // Bet365, Bwin, 1xBet, 10Bet, Pinnacle

function parseOdd(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) && n > 1 ? Number(n.toFixed(3)) : null;
}

function findValue(values: ApiOddsValue[], ...labels: string[]): number | null {
  const wanted = labels.map((l) => l.toLowerCase());
  for (const row of values) {
    const v = row.value.trim().toLowerCase();
    if (wanted.some((w) => v === w || v.includes(w))) {
      return parseOdd(row.odd);
    }
  }
  return null;
}

function pickBookmaker(
  bookmakers: ApiOddsBookmaker[] | undefined
): ApiOddsBookmaker | null {
  if (!bookmakers?.length) return null;
  for (const id of PREFERRED_BOOKMAKER_IDS) {
    const hit = bookmakers.find((b) => b.id === id && b.bets?.length);
    if (hit) return hit;
  }
  return bookmakers.find((b) => b.bets?.length) ?? null;
}

function betById(book: ApiOddsBookmaker, id: number): ApiOddsBet | undefined {
  return book.bets.find((b) => b.id === id);
}

function betByName(
  book: ApiOddsBookmaker,
  ...names: string[]
): ApiOddsBet | undefined {
  const wanted = names.map((n) => n.toLowerCase());
  return book.bets.find((b) =>
    wanted.some((w) => b.name.toLowerCase().includes(w))
  );
}

function normalizeImplied(
  home: number,
  draw: number,
  away: number
): { pHome: number; pDraw: number; pAway: number } {
  const rawH = 1 / home;
  const rawD = 1 / draw;
  const rawA = 1 / away;
  const sum = rawH + rawD + rawA;
  if (sum <= 0) return { pHome: 1 / 3, pDraw: 1 / 3, pAway: 1 / 3 };
  return { pHome: rawH / sum, pDraw: rawD / sum, pAway: rawA / sum };
}

/** Invert P(total goals > 2.5) under Poisson to a total λ. */
function lambdaFromOver25(pOver: number): number {
  const target = Math.min(0.92, Math.max(0.08, pOver));
  let lo = 0.6;
  let hi = 4.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    // P(X <= 2) for Poisson(mid)
    let cdf = 0;
    let term = Math.exp(-mid);
    cdf += term;
    term *= mid;
    cdf += term;
    term *= mid / 2;
    cdf += term;
    const pOverMid = 1 - cdf;
    if (pOverMid < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Parse one fixture odds payload into MatchOdds.
 * Returns null when Match Winner (1X2) is missing — no hardcoded defaults.
 */
export function parseFixtureOdds(
  item: ApiOddsFixture
): MatchOdds | null {
  const book = pickBookmaker(item.bookmakers);
  if (!book) return null;

  const winner =
    betById(book, 1) ?? betByName(book, "match winner", "1x2", "full time result");
  if (!winner) return null;

  const home = findValue(winner.values, "home", "1");
  const draw = findValue(winner.values, "draw", "x");
  const away = findValue(winner.values, "away", "2");
  if (home == null || draw == null || away == null) return null;

  const dc =
    betById(book, 12) ?? betByName(book, "double chance");
  const ou = betById(book, 5) ?? betByName(book, "goals over/under", "over/under");
  const dnb =
    betById(book, 13) ?? betByName(book, "draw no bet");
  const homeScoreBet =
    betById(book, 21) ??
    betByName(book, "home team score", "team to score - home", "home will score");
  const awayScoreBet =
    betById(book, 22) ??
    betByName(book, "away team score", "team to score - away", "away will score");

  const { pHome, pDraw, pAway } = normalizeImplied(home, draw, away);

  let doubleChance1X =
    (dc && findValue(dc.values, "home/draw", "1x", "home/draw")) ?? null;
  let doubleChanceX2 =
    (dc && findValue(dc.values, "draw/away", "x2", "draw/away")) ?? null;
  if (doubleChance1X == null) {
    doubleChance1X = Number((1 / Math.max(0.05, pHome + pDraw)).toFixed(3));
  }
  if (doubleChanceX2 == null) {
    doubleChanceX2 = Number((1 / Math.max(0.05, pAway + pDraw)).toFixed(3));
  }

  const over05 = (ou && findValue(ou.values, "over 0.5")) ?? 0;
  const over15 = (ou && findValue(ou.values, "over 1.5")) ?? 0;
  const over25 = (ou && findValue(ou.values, "over 2.5")) ?? 0;
  const under35 = (ou && findValue(ou.values, "under 3.5")) ?? 0;
  const under45 = (ou && findValue(ou.values, "under 4.5")) ?? 0;

  const dnbHome =
    (dnb && findValue(dnb.values, "home", "1")) ?? 0;
  const dnbAway =
    (dnb && findValue(dnb.values, "away", "2")) ?? 0;

  const homeScores =
    (homeScoreBet && findValue(homeScoreBet.values, "yes", "home")) ?? 0;
  const awayScores =
    (awayScoreBet && findValue(awayScoreBet.values, "yes", "away")) ?? 0;

  const homeTotals =
    betById(book, 16) ??
    betByName(book, "total - home", "home team total", "goals over/under home");
  const awayTotals =
    betById(book, 17) ??
    betByName(book, "total - away", "away team total", "goals over/under away");
  const homeOver15 =
    (homeTotals && findValue(homeTotals.values, "over 1.5")) ?? 0;
  const awayOver15 =
    (awayTotals && findValue(awayTotals.values, "over 1.5")) ?? 0;

  return {
    home,
    draw,
    away,
    doubleChance1X,
    doubleChanceX2,
    over05,
    over15,
    over25,
    under35,
    under45,
    homeScores,
    awayScores,
    homeOver15: homeOver15 || undefined,
    awayOver15: awayOver15 || undefined,
    dnbHome,
    dnbAway,
  };
}

/**
 * Derive venue-specific scoring averages from live 1X2 / O-U odds so each
 * fixture gets a unique Poisson λ (no shared league stub).
 * Preserves existing form / lastMatchAt / history-based averages when present.
 */
export function applyOddsImpliedStats(
  match: Match,
  odds: MatchOdds
): Match {
  const { pHome, pAway } = normalizeImplied(odds.home, odds.draw, odds.away);
  const pOver25 =
    odds.over25 > 1
      ? Math.min(0.9, Math.max(0.1, 1 / odds.over25))
      : 0.52;
  const totalLambda = lambdaFromOver25(pOver25);
  const homeShare = Math.min(
    0.72,
    Math.max(0.28, 0.5 + (pHome - pAway) * 0.45)
  );
  const lambdaHome = Number((totalLambda * homeShare).toFixed(3));
  const lambdaAway = Number((totalLambda - lambdaHome).toFixed(3));

  const patchTeam = (
    team: TeamStats,
    scored: number,
    conceded: number,
    venue: "home" | "away"
  ): TeamStats => {
    const hasHistory =
      team.form.length > 0 ||
      team.homeGoalsScoredAvg != null ||
      team.awayGoalsScoredAvg != null;
    if (hasHistory) {
      return team;
    }
    return {
      ...team,
      goalsScoredAvg: scored,
      goalsConcededAvg: conceded,
      ...(venue === "home"
        ? {
            homeGoalsScoredAvg: scored,
            homeGoalsConcededAvg: conceded,
          }
        : {
            awayGoalsScoredAvg: scored,
            awayGoalsConcededAvg: conceded,
          }),
    };
  };

  return {
    ...match,
    odds,
    home: patchTeam(match.home, lambdaHome, lambdaAway, "home"),
    away: patchTeam(match.away, lambdaAway, lambdaHome, "away"),
  };
}

export function fixtureIdFromMatchId(matchId: string): number | null {
  const m = /^live-(\d+)$/.exec(matchId);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}
