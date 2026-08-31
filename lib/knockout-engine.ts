/**
 * Knockout & two-legged fixture context: detect 1st/2nd/single legs and
 * fine-tune Poisson λ plus market probabilities. All selections bind to
 * 90-minute regular time (never ET, pens, or "to qualify").
 */
import type {
  KnockoutContext,
  KnockoutLegLabel,
  KnockoutLegStatus,
  LeagueId,
  MarketType,
  Match,
} from "./types";

export const KNOCKOUT_90_MIN_NOTE = "Válido solo 90 min reglamentarios";

/** LEG_1: dampen total match λ by 5% (tactical conservatism). */
export const LEG_1_LAMBDA_SCALE = 0.95;

/** LEG_1: Home Win / Double Chance 1X +3%. */
export const LEG_1_HOME_PROB_BOOST = 1.03;

/** LEG_2 comeback: Over 1.5 / Over 2.5 +8%. */
export const LEG_2_COMEBACK_OVER_BOOST = 1.08;

const TWO_LEGGED_LEAGUES = new Set<LeagueId>([
  "champions-league",
  "europa-league",
  "conference-league",
  "copa-libertadores",
  "copa-sudamericana",
  "concacaf-champions-cup",
]);

const LEG_1_RE =
  /\b(1st[\s-]?leg|first[\s-]?leg|\bida\b|1ª?\s*ida)\b/i;
const LEG_2_RE =
  /\b(2nd[\s-]?leg|second[\s-]?leg|\bvuelta\b|2ª?\s*vuelta)\b/i;
const PLAYOFF_RE = /\bplay[\s-]?offs?\b/i;
const QUALIFYING_RE = /\bqualifying\b|\bclasificator/i;
const QUARTER_RE = /\bquarter[\s-]?finals?\b|\bcuartos?\b/i;
const SEMI_RE = /\bsemi[\s-]?finals?\b|\bsemifinales?\b/i;
const FINAL_RE = /\bfinals?\b|\bfinal\b/i;
const ROUND_OF_RE = /\bround of \d+\b|\b8th finals?\b|\blast[\s-]?(8|16|32)\b/i;
const KNOCKOUT_GENERIC_RE =
  /\bknockouts?\b|\beliminator/i;

const HOME_WIN_MARKETS = new Set<MarketType>(["home", "1x"]);
const COMEBACK_OVER_MARKETS = new Set<MarketType>(["over_1_5", "over_2_5"]);

export const KNOCKOUT_FLAG = {
  LEG_1: "KNOCKOUT_LEG_1",
  LEG_2: "KNOCKOUT_LEG_2",
  SINGLE: "KNOCKOUT_SINGLE",
  COMEBACK: "KNOCKOUT_COMEBACK",
} as const;

export interface KnockoutEvaluation extends KnockoutContext {
  status: KnockoutLegStatus | null;
  flags: string[];
  lambdaScale: number;
  homeProbBoost: number;
  overProbBoost: number;
}

const EMPTY_EVALUATION: KnockoutEvaluation = {
  isKnockout: false,
  leg: null,
  note: "",
  status: null,
  comebackRequired: false,
  firstLegScore: null,
  flags: [],
  lambdaScale: 1,
  homeProbBoost: 1,
  overProbBoost: 1,
};

function sourceText(fixture: {
  round?: string | null;
  leagueName?: string;
}): string {
  return [fixture.round, fixture.leagueName].filter(Boolean).join(" ");
}

function isFinalStage(text: string): boolean {
  if (!FINAL_RE.test(text)) return false;
  // "Quarter-finals" / "Semi-finals" contain "final" — exclude those.
  if (QUARTER_RE.test(text) || SEMI_RE.test(text)) return false;
  if (PLAYOFF_RE.test(text) && !/play[\s-]?offs?\s*[-–]?\s*final/i.test(text)) {
    return false;
  }
  return true;
}

function hasKnockoutKeyword(text: string): boolean {
  return (
    PLAYOFF_RE.test(text) ||
    QUALIFYING_RE.test(text) ||
    QUARTER_RE.test(text) ||
    SEMI_RE.test(text) ||
    ROUND_OF_RE.test(text) ||
    KNOCKOUT_GENERIC_RE.test(text) ||
    isFinalStage(text) ||
    LEG_1_RE.test(text) ||
    LEG_2_RE.test(text)
  );
}

/** True when round / league name looks like a cup or two-legged knockout stage. */
export function isKnockoutFixtureText(fixture: {
  round?: string | null;
  leagueName?: string;
}): boolean {
  return hasKnockoutKeyword(sourceText(fixture));
}

function isTypicallyTwoLegged(fixture: Match, text: string): boolean {
  if (isFinalStage(text)) return false;
  if (LEG_1_RE.test(text) || LEG_2_RE.test(text)) return true;
  if (QUALIFYING_RE.test(text) && TWO_LEGGED_LEAGUES.has(fixture.league)) {
    return true;
  }
  if (PLAYOFF_RE.test(text)) return true;
  if (
    TWO_LEGGED_LEAGUES.has(fixture.league) &&
    (QUARTER_RE.test(text) || SEMI_RE.test(text) || ROUND_OF_RE.test(text))
  ) {
    return true;
  }
  return false;
}

function hasFirstLegScore(
  score: Match["firstLegScore"]
): score is { currentHome: number; currentAway: number } {
  return (
    !!score &&
    Number.isFinite(score.currentHome) &&
    Number.isFinite(score.currentAway)
  );
}

function legLabel(status: KnockoutLegStatus): KnockoutLegLabel {
  if (status === "LEG_1") return "1st Leg";
  if (status === "LEG_2") return "2nd Leg";
  return "Single";
}

function statusFlag(status: KnockoutLegStatus): string {
  if (status === "LEG_1") return KNOCKOUT_FLAG.LEG_1;
  if (status === "LEG_2") return KNOCKOUT_FLAG.LEG_2;
  return KNOCKOUT_FLAG.SINGLE;
}

/**
 * Detect knockout leg from API-Football `league.round` / stage text.
 * Explicit 1st/2nd Leg wins; otherwise play-offs, qualifying, QF/SF, etc.
 */
export function detectKnockoutLeg(
  fixture: Match
): KnockoutLegStatus | null {
  const text = sourceText(fixture);
  if (!text.trim()) return null;

  const explicit2nd = LEG_2_RE.test(text);
  const explicit1st = LEG_1_RE.test(text);
  if (explicit2nd && !explicit1st) return "LEG_2";
  if (explicit1st && !explicit2nd) return "LEG_1";

  if (!hasKnockoutKeyword(text)) return null;

  if (hasFirstLegScore(fixture.firstLegScore) && isTypicallyTwoLegged(fixture, text)) {
    return "LEG_2";
  }

  if (isTypicallyTwoLegged(fixture, text)) return "LEG_1";
  return "SINGLE_KNOCKOUT";
}

/** Book favorite = shorter 1X2 price; fallback to scoring averages. */
export function resolveFavoriteSide(
  match: Match
): "home" | "away" | null {
  const homeOdds = match.odds?.home ?? 0;
  const awayOdds = match.odds?.away ?? 0;
  if (homeOdds > 1 && awayOdds > 1 && homeOdds !== awayOdds) {
    return homeOdds < awayOdds ? "home" : "away";
  }

  const homeNet =
    (match.home.goalsScoredAvg || 0) - (match.home.goalsConcededAvg || 0);
  const awayNet =
    (match.away.goalsScoredAvg || 0) - (match.away.goalsConcededAvg || 0);
  if (homeNet === awayNet) return null;
  return homeNet > awayNet ? "home" : "away";
}

/**
 * True when the pre-match favorite trails the first-leg aggregate by ≥ 1 goal
 * (current-fixture home/away perspective).
 */
export function favoriteNeedsComeback(
  match: Match,
  firstLegScore?: Match["firstLegScore"]
): boolean {
  const score = firstLegScore ?? match.firstLegScore;
  if (!hasFirstLegScore(score)) return false;
  const favorite = resolveFavoriteSide(match);
  if (!favorite) return false;
  const deficit =
    favorite === "home"
      ? score.currentAway - score.currentHome
      : score.currentHome - score.currentAway;
  return deficit >= 1;
}

function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(0.99, Math.max(0, p));
}

/**
 * Inspect round/stage, 1st-leg score and favorite trailing state.
 * Pure / sync — first-leg score must already sit on the fixture when known.
 */
export function evaluateKnockoutContext(fixture: Match): KnockoutEvaluation {
  const status = detectKnockoutLeg(fixture);
  if (!status) return { ...EMPTY_EVALUATION };

  const score = hasFirstLegScore(fixture.firstLegScore)
    ? fixture.firstLegScore
    : null;
  const comeback =
    status === "LEG_2" && favoriteNeedsComeback(fixture, score);

  const flags = [statusFlag(status)];
  if (comeback) flags.push(KNOCKOUT_FLAG.COMEBACK);

  return {
    isKnockout: true,
    leg: legLabel(status),
    note: KNOCKOUT_90_MIN_NOTE,
    status,
    comebackRequired: comeback,
    firstLegScore: score,
    flags,
    lambdaScale: status === "LEG_1" ? LEG_1_LAMBDA_SCALE : 1,
    homeProbBoost: status === "LEG_1" ? LEG_1_HOME_PROB_BOOST : 1,
    overProbBoost: comeback ? LEG_2_COMEBACK_OVER_BOOST : 1,
  };
}

/** LEG_1: shrink λ_home + λ_away so λ_total drops 5%. */
export function applyKnockoutLambdaAdjustments(
  match: Match,
  lambda: { home: number; away: number }
): { home: number; away: number } {
  const ctx = evaluateKnockoutContext(match);
  if (ctx.lambdaScale === 1) return lambda;
  return {
    home: lambda.home * ctx.lambdaScale,
    away: lambda.away * ctx.lambdaScale,
  };
}

/** LEG_1 home/1X boost; LEG_2 comeback Over 1.5 / Over 2.5 boost. */
export function applyKnockoutMarketAdjustments(
  match: Match,
  probs: Partial<Record<MarketType, number>>
): Partial<Record<MarketType, number>> {
  const ctx = evaluateKnockoutContext(match);
  if (!ctx.isKnockout) return probs;

  const next = { ...probs };
  if (ctx.homeProbBoost !== 1) {
    for (const market of HOME_WIN_MARKETS) {
      const current = next[market];
      if (current == null) continue;
      next[market] = clampProb(current * ctx.homeProbBoost);
    }
  }
  if (ctx.overProbBoost !== 1) {
    for (const market of COMEBACK_OVER_MARKETS) {
      const current = next[market];
      if (current == null) continue;
      next[market] = clampProb(current * ctx.overProbBoost);
    }
  }
  return next;
}

export function knockoutMarketLabel(
  baseLabel: string,
  ctx: KnockoutContext
): string {
  if (!ctx.isKnockout) return baseLabel;
  if (/90\s*min/i.test(baseLabel)) return baseLabel;
  return `${baseLabel} (90 min)`;
}

export function toKnockoutContext(
  evaluation: KnockoutEvaluation
): KnockoutContext | undefined {
  if (!evaluation.isKnockout) return undefined;
  return {
    isKnockout: true,
    leg: evaluation.leg,
    note: evaluation.note,
    status: evaluation.status,
    comebackRequired: evaluation.comebackRequired,
    firstLegScore: evaluation.firstLegScore ?? null,
  };
}
