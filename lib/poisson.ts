import type { MarketPrediction, MarketType, Match, MatchOdds } from "./types";

const LEAGUE_AVG_GOALS = 1.35;
const HOME_ADVANTAGE = 1.08;
const MAX_GOALS = 8;

/** Factorial with memoization for Poisson PMF */
const factorialCache: number[] = [1];
function factorial(n: number): number {
  if (n < 0) return 0;
  while (factorialCache.length <= n) {
    const i = factorialCache.length;
    factorialCache[i] = factorialCache[i - 1] * i;
  }
  return factorialCache[n];
}

/** Poisson probability mass function: P(X = k) */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/**
 * Estimate expected goals (λ) using attack/defense strengths
 * with home advantage and mild Dixon-Coles low-score adjustment context.
 */
export function estimateExpectedGoals(match: Match): {
  home: number;
  away: number;
} {
  const homeAttack =
    match.home.homeAttackStrength ??
    match.home.goalsScoredAvg / LEAGUE_AVG_GOALS;
  const homeDefense =
    match.home.homeDefenseStrength ??
    match.home.goalsConcededAvg / LEAGUE_AVG_GOALS;
  const awayAttack =
    match.away.awayAttackStrength ??
    match.away.goalsScoredAvg / LEAGUE_AVG_GOALS;
  const awayDefense =
    match.away.awayDefenseStrength ??
    match.away.goalsConcededAvg / LEAGUE_AVG_GOALS;

  // Form factor: recent results nudge λ slightly
  const formBoost = (form: ("W" | "D" | "L")[]) => {
    const pts = form.reduce(
      (s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0),
      0
    );
    return 0.92 + (pts / 15) * 0.16;
  };

  // H2H soft prior
  const h2hHomeRate =
    match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins > 0
      ? (match.h2h.homeWins + 0.5 * match.h2h.draws) /
        (match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins)
      : 0.5;

  let lambdaHome =
    LEAGUE_AVG_GOALS * homeAttack * awayDefense * HOME_ADVANTAGE * formBoost(match.home.form);
  let lambdaAway =
    LEAGUE_AVG_GOALS * awayAttack * homeDefense * formBoost(match.away.form);

  // Blend with H2H goal average
  const h2hShare = Math.min(0.15, match.h2h.avgGoals / 20);
  const h2hHomeGoals = match.h2h.avgGoals * (0.45 + h2hHomeRate * 0.2);
  const h2hAwayGoals = match.h2h.avgGoals - h2hHomeGoals;
  lambdaHome = lambdaHome * (1 - h2hShare) + h2hHomeGoals * h2hShare;
  lambdaAway = lambdaAway * (1 - h2hShare) + h2hAwayGoals * h2hShare;

  return {
    home: Math.max(0.2, Math.min(4.5, Number(lambdaHome.toFixed(3)))),
    away: Math.max(0.2, Math.min(4.5, Number(lambdaAway.toFixed(3)))),
  };
}

/**
 * Dixon-Coles style low-score correlation adjustment.
 * τ adjusts joint probabilities for 0-0, 1-0, 0-1, 1-1.
 */
function dixonColesTau(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho = -0.08
): number {
  if (homeGoals === 0 && awayGoals === 0) {
    return 1 - lambdaHome * lambdaAway * rho;
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return 1 + lambdaHome * rho;
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return 1 + lambdaAway * rho;
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return 1 - rho;
  }
  return 1;
}

/** Build score matrix with Dixon-Coles adjustment, then normalize */
export function buildScoreMatrix(
  lambdaHome: number,
  lambdaAway: number
): number[][] {
  const matrix: number[][] = [];
  let total = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    matrix[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      const raw =
        poissonPmf(h, lambdaHome) *
        poissonPmf(a, lambdaAway) *
        dixonColesTau(h, a, lambdaHome, lambdaAway);
      matrix[h][a] = Math.max(0, raw);
      total += matrix[h][a];
    }
  }

  if (total > 0) {
    for (let h = 0; h <= MAX_GOALS; h++) {
      for (let a = 0; a <= MAX_GOALS; a++) {
        matrix[h][a] /= total;
      }
    }
  }

  return matrix;
}

export function matchOutcomeProbabilities(matrix: number[][]): {
  home: number;
  draw: number;
  away: number;
} {
  let home = 0;
  let draw = 0;
  let away = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = matrix[h][a];
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }

  return { home, draw, away };
}

export function overUnderProbability(
  matrix: number[][],
  line: number
): number {
  let over = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      if (h + a > line) over += matrix[h][a];
    }
  }
  return over;
}

export function underProbability(matrix: number[][], line: number): number {
  return Math.max(0, 1 - overUnderProbability(matrix, line));
}

/** P(team scores ≥ 1) */
export function teamScoresProbability(
  matrix: number[][],
  side: "home" | "away"
): number {
  let p = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      if (side === "home" ? h >= 1 : a >= 1) p += matrix[h][a];
    }
  }
  return p;
}

export function impliedProbability(odds: number): number {
  if (odds <= 1) return 1;
  return 1 / odds;
}

export function calculateEdge(
  modelProbability: number,
  odds: number
): number {
  return modelProbability - impliedProbability(odds);
}

const MARKET_LABELS: Record<MarketType, string> = {
  home: "Local gana (1)",
  draw: "Empate (X)",
  away: "Visitante gana (2)",
  "1x": "Doble oportunidad 1X",
  x2: "Doble oportunidad X2",
  over_0_5: "Más de 0.5 goles",
  over_1_5: "Más de 1.5 goles",
  over_2_5: "Más de 2.5 goles",
  under_3_5: "Menos de 3.5 goles",
  under_4_5: "Menos de 4.5 goles",
  home_scores: "Local marca gol",
  away_scores: "Visitante marca gol",
  dnb_home: "Apuesta sin empate (1)",
  dnb_away: "Apuesta sin empate (2)",
};

function oddsForMarket(odds: MatchOdds, market: MarketType): number {
  switch (market) {
    case "home":
      return odds.home;
    case "draw":
      return odds.draw;
    case "away":
      return odds.away;
    case "1x":
      return odds.doubleChance1X;
    case "x2":
      return odds.doubleChanceX2;
    case "over_0_5":
      return odds.over05;
    case "over_1_5":
      return odds.over15;
    case "over_2_5":
      return odds.over25;
    case "under_3_5":
      return odds.under35;
    case "under_4_5":
      return odds.under45;
    case "home_scores":
      return odds.homeScores;
    case "away_scores":
      return odds.awayScores;
    case "dnb_home":
      return odds.dnbHome;
    case "dnb_away":
      return odds.dnbAway;
  }
}

export function predictMatchMarkets(
  match: Match,
  options?: {
    minSafeProbability?: number;
    minSafeOdds?: number;
    maxSafeOdds?: number;
  }
): {
  expectedGoals: { home: number; away: number };
  markets: MarketPrediction[];
} {
  const minProb = options?.minSafeProbability ?? 0.8;
  const minOdds = options?.minSafeOdds ?? 1.15;
  const maxOdds = options?.maxSafeOdds ?? 1.35;

  const xg = estimateExpectedGoals(match);
  const matrix = buildScoreMatrix(xg.home, xg.away);
  const outcomes = matchOutcomeProbabilities(matrix);

  const decisive = outcomes.home + outcomes.away;
  const dnbHome = decisive > 0 ? outcomes.home / decisive : 0.5;
  const dnbAway = decisive > 0 ? outcomes.away / decisive : 0.5;

  const probs: Record<MarketType, number> = {
    home: outcomes.home,
    draw: outcomes.draw,
    away: outcomes.away,
    "1x": outcomes.home + outcomes.draw,
    x2: outcomes.away + outcomes.draw,
    over_0_5: overUnderProbability(matrix, 0.5),
    over_1_5: overUnderProbability(matrix, 1.5),
    over_2_5: overUnderProbability(matrix, 2.5),
    under_3_5: underProbability(matrix, 3.5),
    under_4_5: underProbability(matrix, 4.5),
    home_scores: teamScoresProbability(matrix, "home"),
    away_scores: teamScoresProbability(matrix, "away"),
    dnb_home: dnbHome,
    dnb_away: dnbAway,
  };

  const markets: MarketPrediction[] = (
    Object.keys(probs) as MarketType[]
  ).map((market) => {
    const odds = oddsForMarket(match.odds, market);
    const modelProbability = probs[market];
    const implied = impliedProbability(odds);
    const edge = modelProbability - implied;

    return {
      market,
      label: MARKET_LABELS[market],
      odds,
      modelProbability,
      impliedProbability: implied,
      edge,
      isSafePick:
        modelProbability >= minProb &&
        odds >= minOdds &&
        odds <= maxOdds,
      expectedGoals: xg,
    };
  });

  return { expectedGoals: xg, markets };
}

export { MARKET_LABELS };
