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

  const btts =
    betById(book, 8) ??
    betByName(
      book,
      "both teams score",
      "both teams to score",
      "gg/ng",
      "btts"
    );
  const bttsYes =
    (btts && findValue(btts.values, "yes", "gg")) ?? 0;
  const bttsNo =
    (btts && findValue(btts.values, "no", "ng")) ?? 0;

  // --- Phase 2: corners / cards / HT (name-first, optional) ---
  const cornersOu =
    betById(book, 45) ??
    betByName(book, "corners over/under", "total corners", "corner over under");
  const corners1h =
    betById(book, 56) ??
    betByName(
      book,
      "corners over/under first half",
      "1st half corners",
      "corners - 1st half"
    );
  const cornersHomeBet =
    betByName(
      book,
      "corners - home",
      "home team corners",
      "total corners home"
    ) ?? betById(book, 57);
  const cornersAwayBet =
    betByName(
      book,
      "corners - away",
      "away team corners",
      "total corners away"
    ) ?? betById(book, 58);

  const cardsOu =
    betById(book, 80) ??
    betByName(
      book,
      "cards over/under",
      "total cards",
      "yellow cards over/under",
      "booking"
    );
  const cardsHomeBet = betByName(
    book,
    "cards - home",
    "home team cards",
    "yellow cards home"
  );
  const cardsAwayBet = betByName(
    book,
    "cards - away",
    "away team cards",
    "yellow cards away"
  );

  const htWinner =
    betByName(book, "first half winner", "1st half winner", "half time result") ??
    betById(book, 7);
  const htOu =
    betById(book, 6) ??
    betByName(
      book,
      "goals over/under first half",
      "1st half goals",
      "over/under 1st half"
    );

  const opt = (n: number | null | undefined) =>
    n != null && n > 1 ? n : undefined;

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
    bttsYes: bttsYes || undefined,
    bttsNo: bttsNo || undefined,
    cornersOver75: opt(cornersOu && findValue(cornersOu.values, "over 7.5")),
    cornersUnder75: opt(cornersOu && findValue(cornersOu.values, "under 7.5")),
    cornersOver85: opt(cornersOu && findValue(cornersOu.values, "over 8.5")),
    cornersUnder85: opt(cornersOu && findValue(cornersOu.values, "under 8.5")),
    cornersOver95: opt(cornersOu && findValue(cornersOu.values, "over 9.5")),
    cornersUnder95: opt(cornersOu && findValue(cornersOu.values, "under 9.5")),
    cornersOver105: opt(cornersOu && findValue(cornersOu.values, "over 10.5")),
    cornersUnder105: opt(cornersOu && findValue(cornersOu.values, "under 10.5")),
    corners1hOver35: opt(corners1h && findValue(corners1h.values, "over 3.5")),
    corners1hUnder35: opt(corners1h && findValue(corners1h.values, "under 3.5")),
    corners1hOver45: opt(corners1h && findValue(corners1h.values, "over 4.5")),
    corners1hUnder45: opt(corners1h && findValue(corners1h.values, "under 4.5")),
    cornersHomeOver35: opt(
      cornersHomeBet && findValue(cornersHomeBet.values, "over 3.5")
    ),
    cornersHomeUnder35: opt(
      cornersHomeBet && findValue(cornersHomeBet.values, "under 3.5")
    ),
    cornersHomeOver45: opt(
      cornersHomeBet && findValue(cornersHomeBet.values, "over 4.5")
    ),
    cornersHomeUnder45: opt(
      cornersHomeBet && findValue(cornersHomeBet.values, "under 4.5")
    ),
    cornersAwayOver35: opt(
      cornersAwayBet && findValue(cornersAwayBet.values, "over 3.5")
    ),
    cornersAwayUnder35: opt(
      cornersAwayBet && findValue(cornersAwayBet.values, "under 3.5")
    ),
    cornersAwayOver45: opt(
      cornersAwayBet && findValue(cornersAwayBet.values, "over 4.5")
    ),
    cornersAwayUnder45: opt(
      cornersAwayBet && findValue(cornersAwayBet.values, "under 4.5")
    ),
    cardsOver35: opt(cardsOu && findValue(cardsOu.values, "over 3.5")),
    cardsUnder35: opt(cardsOu && findValue(cardsOu.values, "under 3.5")),
    cardsOver45: opt(cardsOu && findValue(cardsOu.values, "over 4.5")),
    cardsUnder45: opt(cardsOu && findValue(cardsOu.values, "under 4.5")),
    cardsOver55: opt(cardsOu && findValue(cardsOu.values, "over 5.5")),
    cardsUnder55: opt(cardsOu && findValue(cardsOu.values, "under 5.5")),
    cardsHomeOver15: opt(
      cardsHomeBet && findValue(cardsHomeBet.values, "over 1.5")
    ),
    cardsHomeUnder15: opt(
      cardsHomeBet && findValue(cardsHomeBet.values, "under 1.5")
    ),
    cardsHomeOver25: opt(
      cardsHomeBet && findValue(cardsHomeBet.values, "over 2.5")
    ),
    cardsHomeUnder25: opt(
      cardsHomeBet && findValue(cardsHomeBet.values, "under 2.5")
    ),
    cardsAwayOver15: opt(
      cardsAwayBet && findValue(cardsAwayBet.values, "over 1.5")
    ),
    cardsAwayUnder15: opt(
      cardsAwayBet && findValue(cardsAwayBet.values, "under 1.5")
    ),
    cardsAwayOver25: opt(
      cardsAwayBet && findValue(cardsAwayBet.values, "over 2.5")
    ),
    cardsAwayUnder25: opt(
      cardsAwayBet && findValue(cardsAwayBet.values, "under 2.5")
    ),
    htHome: opt(htWinner && findValue(htWinner.values, "home", "1")),
    htDraw: opt(htWinner && findValue(htWinner.values, "draw", "x")),
    htAway: opt(htWinner && findValue(htWinner.values, "away", "2")),
    htOver05: opt(htOu && findValue(htOu.values, "over 0.5")),
    htUnder05: opt(htOu && findValue(htOu.values, "under 0.5")),
    htOver15: opt(htOu && findValue(htOu.values, "over 1.5")),
    htUnder15: opt(htOu && findValue(htOu.values, "under 1.5")),
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
