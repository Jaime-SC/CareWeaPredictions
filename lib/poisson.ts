import type { MarketPrediction, MarketType, Match, MatchOdds } from "./types";
import {
  getLeagueWeight,
  getMarketWeight,
  loadModelWeights,
  resolveMinProbability,
} from "./model-weights";

const WIN_STREAK_PROB_BOOST = 1.05;
const FATIGUE_XG_FACTOR = 0.9;
const FATIGUE_MAX_DAYS = 4;
const DERBY_OVER_BOOST = 1.05;
const DERBY_BTTS_BOOST = 1.04;
const MAX_GOALS = 8;

/** Canonical high-risk derby / clássico pairs (normalized lowercase names). */
const HIGH_RISK_DERBY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["real madrid", "barcelona"],
  ["real madrid", "atletico madrid"],
  ["barcelona", "espanyol"],
  ["manchester united", "manchester city"],
  ["manchester united", "liverpool"],
  ["liverpool", "everton"],
  ["arsenal", "tottenham"],
  ["arsenal", "chelsea"],
  ["chelsea", "tottenham"],
  ["inter", "milan"],
  ["ac milan", "inter"],
  ["inter milan", "ac milan"],
  ["roma", "lazio"],
  ["juventus", "torino"],
  ["juventus", "inter"],
  ["napoli", "roma"],
  ["boca juniors", "river plate"],
  ["racing club", "independiente"],
  ["flamengo", "fluminense"],
  ["flamengo", "vasco"],
  ["corinthians", "palmeiras"],
  ["sao paulo", "corinthians"],
  ["gremio", "internacional"],
  ["colo colo", "universidad de chile"],
  ["colo-colo", "universidad de chile"],
  ["atletico nacional", "millonarios"],
  ["america", "guadalajara"],
  ["club america", "chivas"],
  ["bayern munich", "borussia dortmund"],
  ["bayern munchen", "borussia dortmund"],
  ["psg", "marseille"],
  ["paris saint germain", "olympique marseille"],
  ["celtic", "rangers"],
  ["ajax", "feyenoord"],
  ["benfica", "porto"],
  ["galatasaray", "fenerbahce"],
];

function leagueAvgGoals(): number {
  return loadModelWeights().global.leagueAvgGoals;
}

function leagueAvgHomeGoals(): number {
  const g = loadModelWeights().global;
  return g.leagueAvgHomeGoals ?? g.leagueAvgGoals;
}

function leagueAvgAwayGoals(): number {
  const g = loadModelWeights().global;
  return g.leagueAvgAwayGoals ?? g.leagueAvgGoals;
}

function homeAdvantage(): number {
  return loadModelWeights().global.homeAdvantage;
}

/** Avoid divide-by-zero / empty stub averages collapsing every match to the same λ. */
function safeRatio(value: number, leagueAvg: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (!Number.isFinite(leagueAvg) || leagueAvg <= 0) return 1;
  return value / leagueAvg;
}

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

function normalizeTeamKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(fc|cf|sc|ac|club|deportivo|de|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

/** True when both clubs are a known high-risk derby / clássico. */
export function isHighRiskDerby(match: Match): boolean {
  const home = normalizeTeamKey(match.home.name);
  const away = normalizeTeamKey(match.away.name);
  return HIGH_RISK_DERBY_PAIRS.some(([a, b]) => {
    const left = normalizeTeamKey(a);
    const right = normalizeTeamKey(b);
    return (
      (namesMatch(home, left) && namesMatch(away, right)) ||
      (namesMatch(home, right) && namesMatch(away, left))
    );
  });
}

/** ≥3 wins in the last 5 results → win-streak boost eligibility. */
export function hasWinStreak(form: ("W" | "D" | "L")[]): boolean {
  if (!form.length) return false;
  const recent = form.slice(0, 5);
  return recent.filter((r) => r === "W").length >= 3;
}

/** Days between previous kickoff and this fixture kickoff. */
export function daysSinceLastMatch(
  lastMatchAt: string | null | undefined,
  kickoff: string
): number | null {
  if (!lastMatchAt) return null;
  const prev = Date.parse(lastMatchAt);
  const next = Date.parse(kickoff);
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
  return (next - prev) / (1000 * 60 * 60 * 24);
}

export function isFatigued(
  lastMatchAt: string | null | undefined,
  kickoff: string
): boolean {
  const days = daysSinceLastMatch(lastMatchAt, kickoff);
  return days != null && days >= 0 && days < FATIGUE_MAX_DAYS;
}

/** Soft form factor from recent points (kept mild so streak rule stays primary). */
function formLambdaFactor(form: ("W" | "D" | "L")[]): number {
  if (!form.length) return 1;
  const pts = form.reduce(
    (s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0),
    0
  );
  const maxPts = Math.max(1, Math.min(form.length, 5) * 3);
  return 0.92 + (pts / maxPts) * 0.16;
}

/**
 * Estimate expected goals (λ) with venue-specific attack/defense,
 * home advantage (default 1.12×), form nudge, and fatigue penalty.
 *
 * Home_xG ≈ LeagueHomeAvg × HomeAttackPower × AwayDefenseWeakness × HomeAdv
 * Away_xG ≈ LeagueAwayAvg × AwayAttackPower × HomeDefenseWeakness
 */
export function estimateExpectedGoals(match: Match): {
  home: number;
  away: number;
} {
  const homeAvg = leagueAvgHomeGoals();
  const awayAvg = leagueAvgAwayGoals();
  const homeAdv = homeAdvantage();

  const homeAttackPower =
    match.home.homeAttackStrength ??
    safeRatio(
      match.home.homeGoalsScoredAvg ?? match.home.goalsScoredAvg,
      homeAvg
    );
  const awayDefenseWeakness =
    match.away.awayDefenseStrength ??
    safeRatio(
      match.away.awayGoalsConcededAvg ?? match.away.goalsConcededAvg,
      awayAvg
    );
  const awayAttackPower =
    match.away.awayAttackStrength ??
    safeRatio(
      match.away.awayGoalsScoredAvg ?? match.away.goalsScoredAvg,
      awayAvg
    );
  const homeDefenseWeakness =
    match.home.homeDefenseStrength ??
    safeRatio(
      match.home.homeGoalsConcededAvg ?? match.home.goalsConcededAvg,
      homeAvg
    );

  let lambdaHome =
    homeAvg * homeAttackPower * awayDefenseWeakness * homeAdv;
  let lambdaAway = awayAvg * awayAttackPower * homeDefenseWeakness;

  lambdaHome *= formLambdaFactor(match.home.form);
  lambdaAway *= formLambdaFactor(match.away.form);

  if (isFatigued(match.home.lastMatchAt, match.kickoff)) {
    lambdaHome *= FATIGUE_XG_FACTOR;
  }
  if (isFatigued(match.away.lastMatchAt, match.kickoff)) {
    lambdaAway *= FATIGUE_XG_FACTOR;
  }

  // H2H soft prior
  const h2hHomeRate =
    match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins > 0
      ? (match.h2h.homeWins + 0.5 * match.h2h.draws) /
        (match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins)
      : 0.5;

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
  const value = (() => {
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
  })();
  // Reject sentinel / missing book lines so they never look like valid 1.28 stubs
  return Number.isFinite(value) && value > 1 ? value : 0;
}

/** True when the match carries usable bookmaker 1X2 + DC lines. */
export function hasBookmakerOdds(odds: MatchOdds): boolean {
  return (
    odds.home > 1 &&
    odds.draw > 1 &&
    odds.away > 1 &&
    odds.doubleChance1X > 1
  );
}

/** Fair decimal odds from a model probability (small overround). */
export function fairDecimalOdds(probability: number, margin = 1.03): number {
  const p = Math.min(0.97, Math.max(0.05, probability));
  return Number(Math.max(1.05, (margin / p)).toFixed(3));
}

/**
 * Build a full MatchOdds board from Poisson probabilities when the book
 * feed is missing — keeps whitelist fixtures eligible for accumulators.
 */
export function buildFairMatchOdds(match: Match): MatchOdds {
  const xg = estimateExpectedGoals(match);
  const matrix = buildScoreMatrix(xg.home, xg.away);
  const outcomes = matchOutcomeProbabilities(matrix);
  const decisive = outcomes.home + outcomes.away;
  const dnbHome = decisive > 0 ? outcomes.home / decisive : 0.5;
  const dnbAway = decisive > 0 ? outcomes.away / decisive : 0.5;

  return {
    home: fairDecimalOdds(outcomes.home),
    draw: fairDecimalOdds(outcomes.draw),
    away: fairDecimalOdds(outcomes.away),
    doubleChance1X: fairDecimalOdds(outcomes.home + outcomes.draw),
    doubleChanceX2: fairDecimalOdds(outcomes.away + outcomes.draw),
    over05: fairDecimalOdds(overUnderProbability(matrix, 0.5)),
    over15: fairDecimalOdds(overUnderProbability(matrix, 1.5)),
    over25: fairDecimalOdds(overUnderProbability(matrix, 2.5)),
    under35: fairDecimalOdds(underProbability(matrix, 3.5)),
    under45: fairDecimalOdds(underProbability(matrix, 4.5)),
    homeScores: fairDecimalOdds(teamScoresProbability(matrix, "home")),
    awayScores: fairDecimalOdds(teamScoresProbability(matrix, "away")),
    dnbHome: fairDecimalOdds(dnbHome),
    dnbAway: fairDecimalOdds(dnbAway),
  };
}

/** Ensure every match has a usable odds board (book first, Poisson fair fallback). */
export function ensureMatchOdds(match: Match): Match {
  if (hasBookmakerOdds(match.odds)) return match;
  return { ...match, odds: buildFairMatchOdds(match) };
}

function clampProb(p: number): number {
  return Math.min(0.99, Math.max(0, p));
}

/**
 * Apply win-streak (+5% on win / DC) and high-risk derby market nudges
 * on top of the Poisson matrix probabilities.
 */
export function applyContextProbabilityRules(
  match: Match,
  probs: Record<MarketType, number>
): Record<MarketType, number> {
  const next = { ...probs };

  if (hasWinStreak(match.home.form)) {
    next.home = clampProb(next.home * WIN_STREAK_PROB_BOOST);
    next["1x"] = clampProb(next["1x"] * WIN_STREAK_PROB_BOOST);
    next.dnb_home = clampProb(next.dnb_home * WIN_STREAK_PROB_BOOST);
  }
  if (hasWinStreak(match.away.form)) {
    next.away = clampProb(next.away * WIN_STREAK_PROB_BOOST);
    next.x2 = clampProb(next.x2 * WIN_STREAK_PROB_BOOST);
    next.dnb_away = clampProb(next.dnb_away * WIN_STREAK_PROB_BOOST);
  }

  if (isHighRiskDerby(match)) {
    next.over_1_5 = clampProb(next.over_1_5 * DERBY_OVER_BOOST);
    next.over_0_5 = clampProb(next.over_0_5 * DERBY_OVER_BOOST);
    next.home_scores = clampProb(next.home_scores * DERBY_BTTS_BOOST);
    next.away_scores = clampProb(next.away_scores * DERBY_BTTS_BOOST);
    // Soften under lines — selection is fully disabled for under_3_5 below
    next.under_3_5 = clampProb(next.under_3_5 * 0.85);
    next.under_4_5 = clampProb(next.under_4_5 * 0.92);
  }

  return next;
}

/** Markets preferred when the fixture is a tagged high-risk derby. */
export function derbyPreferredMarkets(): Set<MarketType> {
  return new Set<MarketType>(["over_1_5", "home_scores", "away_scores"]);
}

/** under_3_5 is never eligible on high-risk derbies. */
export function isMarketBlockedByDerby(
  match: Match,
  market: MarketType
): boolean {
  return market === "under_3_5" && isHighRiskDerby(match);
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
  isDerby: boolean;
} {
  const resolved = ensureMatchOdds(match);
  const weights = loadModelWeights();
  const leagueCfg = getLeagueWeight(resolved.leagueName, weights);
  const baseMinProb = options?.minSafeProbability ?? 0.8;
  const minOdds = Math.max(
    options?.minSafeOdds ?? weights.global.defaultMinOdds,
    leagueCfg.minOdds || weights.global.defaultMinOdds
  );
  const maxOdds = options?.maxSafeOdds ?? 1.28;
  const derby = isHighRiskDerby(resolved);

  const xg = estimateExpectedGoals(resolved);
  const matrix = buildScoreMatrix(xg.home, xg.away);
  const outcomes = matchOutcomeProbabilities(matrix);

  const decisive = outcomes.home + outcomes.away;
  const dnbHome = decisive > 0 ? outcomes.home / decisive : 0.5;
  const dnbAway = decisive > 0 ? outcomes.away / decisive : 0.5;

  const baseProbs: Record<MarketType, number> = {
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

  const probs = applyContextProbabilityRules(resolved, baseProbs);

  const markets: MarketPrediction[] = (
    Object.keys(probs) as MarketType[]
  ).map((market) => {
    let odds = oddsForMarket(resolved.odds, market);
    const rawProb = probs[market];
    const modelProbability = Math.min(
      0.99,
      Math.max(0, rawProb * leagueCfg.probabilityScale)
    );
    // Per-market Poisson fair fallback if a single line is still missing
    if (!(odds > 1)) {
      odds = fairDecimalOdds(modelProbability);
    }
    const mktCfg = getMarketWeight(market, weights);
    const blockedByDerby = isMarketBlockedByDerby(resolved, market);
    const implied = impliedProbability(odds);
    const edge = modelProbability - implied;
    const effectiveMin = resolveMinProbability(
      baseMinProb,
      market,
      resolved.leagueName,
      weights
    );

    return {
      market,
      label: MARKET_LABELS[market],
      odds,
      modelProbability,
      impliedProbability: implied,
      edge,
      isSafePick:
        !mktCfg.disabled &&
        !blockedByDerby &&
        odds > 1 &&
        modelProbability >= effectiveMin &&
        odds >= minOdds &&
        odds <= maxOdds,
      expectedGoals: xg,
    };
  });

  return { expectedGoals: xg, markets, isDerby: derby };
}

export { MARKET_LABELS, leagueAvgGoals };
