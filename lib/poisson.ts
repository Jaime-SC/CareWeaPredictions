import type { MarketPrediction, MarketType, Match, MatchOdds } from "./types";
import {
  applyContextToMarkets,
  injuryLambdaFactors,
  isFatigued,
  isHighRiskDerby,
  isMarketBlockedByDerby,
} from "./context-engine";
import {
  applyKnockoutLambdaAdjustments,
  applyKnockoutMarketAdjustments,
  evaluateKnockoutContext,
  knockoutMarketLabel,
  toKnockoutContext,
} from "./knockout-engine";
import {
  getLeagueWeight,
  getMarketWeight,
  loadModelWeights,
  resolveMinProbability,
} from "./model-weights";
import { applyTuningToProbability } from "./tuning-config";

const FATIGUE_XG_FACTOR = 0.9;
const MAX_GOALS = 8;

export {
  applyContextModifiers,
  daysSinceLastMatch,
  derbyPreferredMarkets,
  hasWinStreak,
  isFatigued,
  isHighRiskDerby,
  isMarketBlockedByDerby,
} from "./context-engine";

export {
  evaluateKnockoutContext,
  applyKnockoutLambdaAdjustments,
  applyKnockoutMarketAdjustments,
} from "./knockout-engine";

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

  // Key absences: −5%…−8% on attack / defensive ratings
  const inj = injuryLambdaFactors(match);
  lambdaHome *= inj.homeAttack * inj.awayDefense;
  lambdaAway *= inj.awayAttack * inj.homeDefense;

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

  const knockoutLambda = applyKnockoutLambdaAdjustments(match, {
    home: lambdaHome,
    away: lambdaAway,
  });
  lambdaHome = knockoutLambda.home;
  lambdaAway = knockoutLambda.away;

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

/** P(team goals > line), e.g. team total over 1.5 → line=1.5 */
export function teamOverProbability(
  matrix: number[][],
  side: "home" | "away",
  line = 1.5
): number {
  let p = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      if (side === "home" ? h > line : a > line) p += matrix[h][a];
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
  home_over_1_5: "Local más de 1.5 goles",
  away_over_1_5: "Visitante más de 1.5 goles",
  dnb_home: "Apuesta sin empate (1)",
  dnb_away: "Apuesta sin empate (2)",
};

export function oddsForMarket(odds: MatchOdds, market: MarketType): number {
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
      case "home_over_1_5":
        return odds.homeOver15 ?? 0;
      case "away_over_1_5":
        return odds.awayOver15 ?? 0;
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
 * Offline / backtest helper: Poisson-implied fair board.
 * Production prediction must never call this — missing books discard the match.
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
    homeOver15: fairDecimalOdds(teamOverProbability(matrix, "home", 1.5)),
    awayOver15: fairDecimalOdds(teamOverProbability(matrix, "away", 1.5)),
    dnbHome: fairDecimalOdds(dnbHome),
    dnbAway: fairDecimalOdds(dnbAway),
  };
}

/** Pass-through. Never invents a Poisson fair board for missing books. */
export function ensureMatchOdds(match: Match): Match {
  return match;
}

/**
 * Apply Context Engine multipliers (venue, injuries, friendlies, H2H,
 * win-streak and derby policy) on top of the Poisson matrix probabilities.
 */
export function applyContextProbabilityRules(
  match: Match,
  probs: Record<MarketType, number>
): Record<MarketType, number> {
  return applyContextToMarkets(match, probs).probs;
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
  contextFlags: string[];
  contextNotes: string[];
} {
  const derby = isHighRiskDerby(match);
  const knockoutEval = evaluateKnockoutContext(match);
  const knockoutContext = toKnockoutContext(knockoutEval);

  if (!hasBookmakerOdds(match.odds)) {
    const xg = estimateExpectedGoals(match);
    return {
      expectedGoals: xg,
      markets: [],
      isDerby: derby,
      contextFlags: [
        "UNAVAILABLE_NO_REAL_ODDS",
        ...knockoutEval.flags,
      ],
      contextNotes: knockoutContext
        ? ["Sin cuotas reales de casa de apuestas", knockoutContext.note]
        : ["Sin cuotas reales de casa de apuestas"],
    };
  }

  const resolved = match;
  const weights = loadModelWeights();
  const leagueCfg = getLeagueWeight(
    resolved.leagueName,
    weights,
    resolved.leagueId
  );
  const baseMinProb = options?.minSafeProbability ?? 0.8;
  const minOdds = Math.max(
    options?.minSafeOdds ?? weights.global.defaultMinOdds,
    leagueCfg.minOdds || weights.global.defaultMinOdds
  );
  const maxOdds = options?.maxSafeOdds ?? 1.28;

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
    home_over_1_5: teamOverProbability(matrix, "home", 1.5),
    away_over_1_5: teamOverProbability(matrix, "away", 1.5),
    dnb_home: dnbHome,
    dnb_away: dnbAway,
  };

  const ctx = applyContextToMarkets(resolved, baseProbs);
  const probs = applyKnockoutMarketAdjustments(resolved, ctx.probs);
  const knockoutFlags = knockoutEval.flags;
  const mergedFlags = [...new Set([...ctx.contextFlags, ...knockoutFlags])];
  const mergedNotes = knockoutContext
    ? [...ctx.contextNotes, knockoutContext.note]
    : ctx.contextNotes;

  const markets: MarketPrediction[] = (
    Object.keys(probs) as MarketType[]
  ).map((market) => {
    const odds = oddsForMarket(resolved.odds, market);
    const rawProb = probs[market];
    const tunedProb = applyTuningToProbability(rawProb, resolved, market);
    const modelProbability = Math.min(
      0.99,
      Math.max(0, tunedProb * leagueCfg.probabilityScale)
    );
    const mktCfg = getMarketWeight(market, weights);
    const blockedByDerby = isMarketBlockedByDerby(resolved, market);
    const implied = impliedProbability(odds);
    const edge = modelProbability - implied;
    const effectiveMin = resolveMinProbability(
      baseMinProb,
      market,
      resolved.leagueName,
      weights,
      resolved.leagueId
    );
    const marketCtx = ctx.perMarket[market];
    const marketFlags = [
      ...(marketCtx?.contextFlags ?? []),
      ...knockoutFlags,
    ];

    return {
      market,
      label: knockoutMarketLabel(MARKET_LABELS[market], knockoutEval),
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
      confidenceModifier: marketCtx?.confidenceModifier,
      contextFlags: [...new Set(marketFlags)],
      knockoutContext,
    };
  });

  return {
    expectedGoals: xg,
    markets,
    isDerby: derby,
    contextFlags: mergedFlags,
    contextNotes: mergedNotes,
  };
}

export { MARKET_LABELS, leagueAvgGoals };
