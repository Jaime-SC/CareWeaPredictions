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
import {
  applyTeamProfileCalibration,
  keyAbsenceLambdaFactorForSide,
  peekTeamProfile,
} from "./team-profiler";
import { applyTuningToProbability } from "./tuning-config";
import { isValueBet, valueMarginPercent } from "./value-finder";
import { failsMarketSanity } from "./filters";
import { applyStandingsAwayPenalty } from "./standings";

const FATIGUE_XG_FACTOR = 0.9;
const MAX_GOALS = 8;

/** Avoid divide-by-zero / empty stub averages collapsing every match to the same λ. */
function safeRatio(value: number, leagueAvg: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (!Number.isFinite(leagueAvg) || leagueAvg <= 0) return 1;
  return value / leagueAvg;
}

/**
 * Poisson PMF via recurrence: P(0)=e^{-λ}, P(k)=P(k-1)·λ/k.
 * Avoids factorial + Math.pow allocations on the hot path.
 */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = (p * lambda) / i;
  return p;
}

/** Precompute P(0..maxK) once per λ for score-matrix builds. */
function poissonPmfArray(lambda: number, maxK: number): number[] {
  const out = new Array<number>(maxK + 1);
  if (lambda <= 0) {
    out[0] = 1;
    for (let k = 1; k <= maxK; k++) out[k] = 0;
    return out;
  }
  out[0] = Math.exp(-lambda);
  for (let k = 1; k <= maxK; k++) {
    out[k] = (out[k - 1] * lambda) / k;
  }
  return out;
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
  const g = loadModelWeights().global;
  const homeAvg = g.leagueAvgHomeGoals ?? g.leagueAvgGoals;
  const awayAvg = g.leagueAvgAwayGoals ?? g.leagueAvgGoals;
  const homeAdv = g.homeAdvantage;

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

  // TeamProfile / match injuries: −15% λ when key absences detected
  lambdaHome *= keyAbsenceLambdaFactorForSide(
    match.home.id,
    match.home.injuries
  );
  lambdaAway *= keyAbsenceLambdaFactorForSide(
    match.away.id,
    match.away.injuries
  );

  // Open-Meteo: heavy rain / snow → total xG × 0.90
  const weatherFactor = match.weather?.factor ?? 1;
  if (weatherFactor > 0 && weatherFactor < 1) {
    lambdaHome *= weatherFactor;
    lambdaAway *= weatherFactor;
  }

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
  const homePmf = poissonPmfArray(lambdaHome, MAX_GOALS);
  const awayPmf = poissonPmfArray(lambdaAway, MAX_GOALS);
  const matrix: number[][] = new Array(MAX_GOALS + 1);
  let total = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    const row = new Array<number>(MAX_GOALS + 1);
    const ph = homePmf[h];
    for (let a = 0; a <= MAX_GOALS; a++) {
      const raw =
        ph * awayPmf[a] * dixonColesTau(h, a, lambdaHome, lambdaAway);
      const cell = Math.max(0, raw);
      row[a] = cell;
      total += cell;
    }
    matrix[h] = row;
  }

  if (total > 0) {
    const inv = 1 / total;
    for (let h = 0; h <= MAX_GOALS; h++) {
      for (let a = 0; a <= MAX_GOALS; a++) {
        matrix[h][a] *= inv;
      }
    }
  }

  return matrix;
}

/** Single 9×9 pass → all market base probabilities. */
function marketProbsFromMatrix(matrix: number[][]): Record<MarketType, number> {
  let home = 0;
  let draw = 0;
  let away = 0;
  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let under35 = 0;
  let under45 = 0;
  let homeScores = 0;
  let awayScores = 0;
  let homeOver15 = 0;
  let awayOver15 = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = matrix[h][a];
      const goals = h + a;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      if (goals > 0.5) over05 += p;
      if (goals > 1.5) over15 += p;
      if (goals > 2.5) over25 += p;
      if (goals <= 3.5) under35 += p;
      if (goals <= 4.5) under45 += p;
      if (h >= 1) homeScores += p;
      if (a >= 1) awayScores += p;
      if (h > 1.5) homeOver15 += p;
      if (a > 1.5) awayOver15 += p;
    }
  }

  const decisive = home + away;
  return {
    home,
    draw,
    away,
    "1x": home + draw,
    x2: away + draw,
    over_0_5: over05,
    over_1_5: over15,
    over_2_5: over25,
    under_3_5: under35,
    under_4_5: under45,
    home_scores: homeScores,
    away_scores: awayScores,
    home_over_1_5: homeOver15,
    away_over_1_5: awayOver15,
    dnb_home: decisive > 0 ? home / decisive : 0.5,
    dnb_away: decisive > 0 ? away / decisive : 0.5,
  };
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

const MARKET_ODDS_KEY: Record<MarketType, keyof MatchOdds> = {
  home: "home",
  draw: "draw",
  away: "away",
  "1x": "doubleChance1X",
  x2: "doubleChanceX2",
  over_0_5: "over05",
  over_1_5: "over15",
  over_2_5: "over25",
  under_3_5: "under35",
  under_4_5: "under45",
  home_scores: "homeScores",
  away_scores: "awayScores",
  home_over_1_5: "homeOver15",
  away_over_1_5: "awayOver15",
  dnb_home: "dnbHome",
  dnb_away: "dnbAway",
};

export function oddsForMarket(odds: MatchOdds, market: MarketType): number {
  const value = odds[MARKET_ODDS_KEY[market]] ?? 0;
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
  const baseProbs = marketProbsFromMatrix(matrix);

  const ctx = applyContextToMarkets(resolved, baseProbs);
  const knockoutProbs = applyKnockoutMarketAdjustments(resolved, ctx.probs);
  // Venue-gated TeamProfile boosts (N≥4 home/away) + clamp ≤+8% / ≤0.92
  const profileCal = applyTeamProfileCalibration(
    knockoutProbs,
    peekTeamProfile(resolved.home.id),
    peekTeamProfile(resolved.away.id)
  );
  const standingsCal = applyStandingsAwayPenalty(
    profileCal.probs,
    resolved.standings
  );
  const probs = standingsCal.probs;
  const knockoutFlags = knockoutEval.flags;
  const mergedFlags = [
    ...new Set([
      ...ctx.contextFlags,
      ...knockoutFlags,
      ...profileCal.flags,
      ...standingsCal.flags,
      ...(resolved.weather?.factor != null && resolved.weather.factor < 1
        ? ["WEATHER_ADVERSE"]
        : []),
    ]),
  ];
  const mergedNotes = [
    ...(knockoutContext
      ? [...ctx.contextNotes, knockoutContext.note]
      : ctx.contextNotes),
    ...profileCal.notes,
    ...standingsCal.notes,
    ...(resolved.weather?.alert ? [resolved.weather.alert] : []),
  ];

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
    const valuePct = valueMarginPercent(modelProbability, odds);
    const sanity = failsMarketSanity(
      resolved,
      market,
      modelProbability,
      odds
    );
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
      ...sanity.flags,
    ];

    return {
      market,
      label: knockoutMarketLabel(MARKET_LABELS[market], knockoutEval),
      odds,
      modelProbability,
      impliedProbability: implied,
      edge,
      valueMarginPercent: Number(valuePct.toFixed(2)),
      isValueBet: isValueBet(modelProbability, odds),
      isSafePick:
        !mktCfg.disabled &&
        !blockedByDerby &&
        !sanity.fail &&
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

export { MARKET_LABELS };
