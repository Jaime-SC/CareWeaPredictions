import type {
  GeneratedParlay,
  MarketPrediction,
  MarketType,
  Match,
  MatchPrediction,
  ParlayConfig,
  ParlayLeg,
  RiskTier,
  StrategyMode,
} from "./types";
import {
  STRATEGY_LABELS,
  getStrategyPreset,
  isFunStrategy,
  isMonopolyStrategy,
  isSafeStrategy,
  resolveStrategyMode,
} from "./parlay-defaults";
import {
  derbyPreferredMarkets,
  isHighRiskDerby,
  isMarketBlockedByDerby,
  predictMatchMarkets,
  hasBookmakerOdds,
} from "./poisson";
import {
  notesForFlags,
  resolveContextMinProbability,
} from "./context-engine";
import { rejectMatchesWithoutRealOdds } from "./filters";
import {
  getLeagueWeight,
  getMarketWeight,
  loadModelWeights,
  resolveMinProbability,
} from "./model-weights";
import { chileDateString, formatKickoffDayLabel } from "./utils";
import { isAllowedCompetition } from "../config/allowed-leagues";
import { prioritizeValueLegs, valueRankBonus } from "./value-finder";
import {
  formatExplicitBetLine,
  formatMarketGuideLines,
  getExplicitPickFromLeg,
} from "./formatters";
import { buildMonopolyParlay, getWeeklyDateRange } from "./monopoly-engine";

export { DEFAULT_AUTO_PARLAY_CONFIG } from "./parlay-defaults";
export { getWeeklyDateRange };

/**
 * Defense-in-depth: ID is source of truth; name cannot rescue a lower division
 * (e.g. Colombia Primera B labeled "Primera B" must not match Chile's alias).
 * Primary filtering happens in api-football; this clamp runs again before parlays.
 */
export function filterEliteWhitelistMatches(matches: Match[]): Match[] {
  return matches.filter((m) => isAllowedCompetition(m.leagueId, m.leagueName));
}

/** Strategic / safe modes: only bookmaker-friendly high-probability lines */
const SAFE_MARKETS = new Set<MarketType>([
  "1x",
  "x2",
  "over_1_5",
  "dnb_home",
  "dnb_away",
]);

/** Fun / longshot: bookmaker-realistic lines (no pure 1X2 heavy odds) */
const FUN_MARKETS = new Set<MarketType>([
  "1x",
  "x2",
  "over_1_5",
  "under_3_5",
  "under_4_5",
  "home_scores",
  "away_scores",
  "dnb_home",
  "dnb_away",
]);

const MAX_MARKET_SHARE = 0.4;

/** Hard floor: every accumulator leg must be ≥ 80% model probability. */
export const MIN_LEG_PROBABILITY = 0.8;

/** Fallback strict gate when weights file is missing. */
export const STRICT_MIN_PROBABILITY = MIN_LEG_PROBABILITY;

/** Backfill never goes below the 80% hard floor. */
const FUN_BACKFILL_MIN_PROBABILITY = MIN_LEG_PROBABILITY;

/** Floor used when backfilling safe / calibrated tickets. */
const BACKFILL_MIN_PROBABILITY = MIN_LEG_PROBABILITY;

/** Ideal per-leg odds so ~1.22^15 ≈ 21x (band 1.18–1.28 → ~20x–35x). */
const FUN_TARGET_LEG_ODDS = 1.22;

/** Default exact leg count for fun / accumulator tickets. */
export const DEFAULT_TARGET_LEG_COUNT = 15;

function getStrictMinProbability(): number {
  // Accumulator hard floor always wins over a softer calibrated file value
  return Math.max(
    MIN_LEG_PROBABILITY,
    loadModelWeights().global.strictMinProbability ?? STRICT_MIN_PROBABILITY
  );
}

function getBackfillMinProbability(strategyMode?: StrategyMode): number {
  if (strategyMode && isFunStrategy(strategyMode)) {
    return FUN_BACKFILL_MIN_PROBABILITY;
  }
  return Math.max(
    MIN_LEG_PROBABILITY,
    loadModelWeights().global.backfillMinProbability ?? BACKFILL_MIN_PROBABILITY
  );
}

/** Score how close odds are to the high-probability geometric mean (~1.22). */
function funOddsFit(odds: number): number {
  if (!(odds > 1)) return -10;
  return -Math.abs(Math.log(odds) - Math.log(FUN_TARGET_LEG_ODDS)) * 4;
}

type MarketFamily =
  | "double_chance"
  | "over_1_5"
  | "over_0_5"
  | "under"
  | "team_score"
  | "dnb"
  | "other";

function marketFamily(market: MarketType): MarketFamily {
  switch (market) {
    case "1x":
    case "x2":
      return "double_chance";
    case "over_1_5":
      return "over_1_5";
    case "over_0_5":
      return "over_0_5";
    case "under_3_5":
    case "under_4_5":
      return "under";
    case "home_scores":
    case "away_scores":
      return "team_score";
    case "home_over_1_5":
    case "away_over_1_5":
      return "over_1_5";
    case "dnb_home":
    case "dnb_away":
      return "dnb";
    default:
      return "other";
  }
}

function resolveMode(config: ParlayConfig): StrategyMode {
  return resolveStrategyMode(config.strategyMode);
}

function riskAssessment(
  jointProbability: number,
  riskTier: RiskTier
): {
  riskLevel: GeneratedParlay["riskLevel"];
  riskLabel: string;
} {
  if (riskTier === "safe") {
    if (jointProbability >= 0.35) {
      return {
        riskLevel: "low",
        riskLabel: "Riesgo bajo — probabilidad conjunta sólida",
      };
    }
    if (jointProbability >= 0.2) {
      return {
        riskLevel: "medium",
        riskLabel: "Riesgo medio-bajo — perfil estratégico",
      };
    }
    return {
      riskLevel: "medium",
      riskLabel: "Riesgo moderado — pocas selecciones de alta confianza",
    };
  }

  if (riskTier === "monopoly") {
    if (jointProbability >= 0.2) {
      return {
        riskLevel: "low",
        riskLabel: "Asimetría / monopolio doméstico — filtro anti-rotación",
      };
    }
    return {
      riskLevel: "medium",
      riskLabel: "Asimetría / monopolio — probabilidad conjunta moderada",
    };
  }

  if (jointProbability >= 0.05) {
    return {
      riskLevel: "high",
      riskLabel: "Modo Seguro / Alta Probabilidad (piso 80% por leg)",
    };
  }
  return {
    riskLevel: "extreme",
    riskLabel: "Modo Seguro / Alta Probabilidad — pocas legs ≥80%",
  };
}

function toLeg(match: Match, pick: MarketPrediction): ParlayLeg {
  const flags = pick.contextFlags ?? [];
  return {
    matchId: match.id,
    matchLabel: `${match.home.name} vs ${match.away.name}`,
    leagueName: match.leagueName,
    kickoff: match.kickoff,
    market: pick.market,
    marketLabel: pick.label,
    odds: pick.odds,
    modelProbability: pick.modelProbability,
    edge: pick.edge,
    contextFlags: flags,
    contextNotes: notesForFlags(flags),
    referee: match.referee ?? null,
    venue: match.venue ?? null,
  };
}

type RankMode = "edge" | "odds" | "probability" | "balanced";

function isMarketAllowed(
  market: MarketType,
  strategyMode: StrategyMode,
  match?: Match
): boolean {
  const mkt = getMarketWeight(market);
  if (mkt.disabled) return false;
  if (match && isMarketBlockedByDerby(match, market)) return false;
  return isSafeStrategy(strategyMode)
    ? SAFE_MARKETS.has(market)
    : FUN_MARKETS.has(market);
}

/** Ranking nudge: prefer Over 1.5 / team-scores on high-risk derbies. */
function derbyMarketRankBonus(match: Match, market: MarketType): number {
  if (!isHighRiskDerby(match)) return 0;
  if (market === "under_3_5") return -2;
  if (derbyPreferredMarkets().has(market)) return 0.35;
  return 0;
}

/** Prefer O/U / DNB / team-score by match xG profile (breaks 1X monoculture). */
function profileMarketBonus(
  match: Match,
  market: MarketType,
  expectedGoals: { home: number; away: number }
): number {
  const total = expectedGoals.home + expectedGoals.away;
  const homeEdge = expectedGoals.home - expectedGoals.away;

  if (market === "over_1_5" && total >= 2.4) return 0.28;
  if (market === "under_3_5" && total <= 2.3) return 0.22;
  if (market === "under_4_5" && total <= 2.8) return 0.12;
  if (market === "home_scores" && expectedGoals.home >= 1.05) return 0.16;
  if (market === "away_scores" && expectedGoals.away >= 1.0) return 0.16;
  if (market === "dnb_home" && homeEdge >= 0.45) return 0.2;
  if (market === "dnb_away" && homeEdge <= -0.35) return 0.2;
  // Soft penalty on double chance so diversity can win when other markets qualify
  if (market === "1x" || market === "x2") return -0.08;
  return 0;
}

function maxDoubleChanceLegs(targetLegCount: number): number {
  return Math.max(1, Math.floor(targetLegCount * MAX_MARKET_SHARE));
}

/**
 * Collect eligible legs according to strategy mode.
 * Fun modes: one pick per match with hard double-chance ≤40% diversity.
 */
export function collectSafePicks(
  matches: Match[],
  config: Pick<
    ParlayConfig,
    "minOdds" | "maxOdds" | "minProbability" | "strategyMode" | "targetLegCount"
  >,
  mode: RankMode = "edge"
): ParlayLeg[] {
  const strategyMode = resolveMode(config as ParlayConfig);
  const preset = getStrategyPreset(strategyMode);
  const baseMinProb = Math.max(
    MIN_LEG_PROBABILITY,
    config.minProbability ??
      preset.minProbability ??
      getStrictMinProbability()
  );
  const targetLegCount =
    typeof config.targetLegCount === "number" && config.targetLegCount > 0
      ? config.targetLegCount
      : isFunStrategy(strategyMode)
        ? DEFAULT_TARGET_LEG_COUNT
        : matches.length;
  const weights = loadModelWeights();
  const maxDc = maxDoubleChanceLegs(targetLegCount);

  type Cand = {
    match: Match;
    pick: MarketPrediction;
    rank: number;
  };

  const perMatch: Cand[][] = [];

  for (const match of matches) {
    if (!hasBookmakerOdds(match.odds)) continue;
    const resolved = match;

    const leagueCfg = getLeagueWeight(resolved.leagueName, weights);
    const leagueMinOdds = Math.max(
      config.minOdds,
      leagueCfg.minOdds || config.minOdds
    );

    const { markets, expectedGoals } = predictMatchMarkets(resolved, {
      minSafeProbability: resolveContextMinProbability(baseMinProb, resolved),
      minSafeOdds: leagueMinOdds,
      maxSafeOdds: config.maxOdds,
    });

    const eligible = markets.filter((m) => {
      if (!isMarketAllowed(m.market, strategyMode, resolved)) return false;
      if (!(m.odds > 1)) return false;
      // Hard floor 80% — friendlies raise to 85% via context guardrail
      let minProb = Math.max(
        MIN_LEG_PROBABILITY,
        resolveContextMinProbability(
          resolveMinProbability(
            baseMinProb,
            m.market,
            resolved.leagueName,
            weights
          ),
          resolved
        )
      );
      return (
        m.modelProbability >= minProb &&
        m.odds >= leagueMinOdds &&
        m.odds <= config.maxOdds
      );
    });

    if (eligible.length === 0) continue;

    const cands: Cand[] = eligible.map((pick) => {
      const wa = getMarketWeight(pick.market, weights).weight;
      const bonus =
        derbyMarketRankBonus(resolved, pick.market) +
        profileMarketBonus(resolved, pick.market, expectedGoals);
      const oddsFit = isFunStrategy(strategyMode)
        ? funOddsFit(pick.odds)
        : 0;
      const valueBonus = valueRankBonus(pick.modelProbability, pick.odds);
      const base =
        mode === "probability"
          ? pick.modelProbability * 10 + pick.edge
          : mode === "odds"
            ? pick.odds * 3 + pick.modelProbability
            : mode === "balanced"
              ? scoreMarket(pick) + (isFunStrategy(strategyMode) ? oddsFit : 0)
              : pick.edge * 8 + pick.modelProbability;
      return {
        match: resolved,
        pick,
        rank: base + wa * 0.4 + bonus + oddsFit + valueBonus,
      };
    });

    cands.sort((a, b) => b.rank - a.rank);
    perMatch.push(cands);
  }

  // Assign highest-ranked match first; within each match skip markets that
  // would breach the double-chance quota (or soft family caps).
  perMatch.sort((a, b) => b[0].rank - a[0].rank);

  const legs: ParlayLeg[] = [];
  const familyCounts: Partial<Record<MarketFamily, number>> = {};

  for (const cands of perMatch) {
    for (const cand of cands) {
      const fam = marketFamily(cand.pick.market);
      const used = familyCounts[fam] ?? 0;
      const famCap =
        fam === "double_chance"
          ? maxDc
          : isFunStrategy(strategyMode)
            ? Math.max(2, Math.floor(targetLegCount * MAX_MARKET_SHARE))
            : Number.POSITIVE_INFINITY;
      if (used >= famCap) continue;

      legs.push(toLeg(cand.match, cand.pick));
      familyCounts[fam] = used + 1;
      break;
    }
  }

  return legs.sort((a, b) => {
    const wa = getMarketWeight(a.market, weights).weight;
    const wb = getMarketWeight(b.market, weights).weight;
    if (Math.abs(wb - wa) > 0.01) return wb - wa;
    return compareLegs(a, b, mode);
  });
}

/**
 * Strict pool (≥ calibrated minProbability) plus probability-ranked backfill
 * until the pool has at least `targetLegCount` unique-match candidates.
 */
export function collectPicksWithBackfill(
  matches: Match[],
  config: Pick<
    ParlayConfig,
    "minOdds" | "maxOdds" | "minProbability" | "strategyMode" | "targetLegCount"
  >,
  targetLegCount: number,
  mode: RankMode = "edge"
): { pool: ParlayLeg[]; strictCount: number; backfilled: number } {
  const strictMin = Math.max(
    MIN_LEG_PROBABILITY,
    config.minProbability ?? getStrictMinProbability()
  );

  const strict = collectSafePicks(
    matches,
    { ...config, minProbability: strictMin, targetLegCount },
    mode
  );

  if (strict.length >= targetLegCount) {
    return {
      pool: strict,
      strictCount: strict.length,
      backfilled: 0,
    };
  }

  const relaxed = collectSafePicks(
    matches,
    {
      ...config,
      minProbability: getBackfillMinProbability(
        resolveMode(config as ParlayConfig)
      ),
      targetLegCount,
    },
    isFunStrategy(resolveMode(config as ParlayConfig)) ? "odds" : "probability"
  );

  const used = new Set(strict.map((l) => l.matchId));
  const extras = relaxed
    .filter((l) => !used.has(l.matchId))
    .sort((a, b) => compareLegs(a, b, "probability"));

  const needed = targetLegCount - strict.length;
  const backfill = extras.slice(0, needed);
  const pool = [...strict, ...backfill].sort((a, b) =>
    compareLegs(a, b, mode)
  );

  return {
    pool,
    strictCount: strict.length,
    backfilled: backfill.length,
  };
}

function resolveTargetLegCount(config: ParlayConfig): number {
  if (
    typeof config.targetLegCount === "number" &&
    config.targetLegCount > 0
  ) {
    return Math.floor(config.targetLegCount);
  }
  const strategyMode = resolveMode(config);
  const preset = getStrategyPreset(strategyMode);
  if (
    typeof preset.targetLegCount === "number" &&
    preset.targetLegCount > 0
  ) {
    return preset.targetLegCount;
  }
  if (isFunStrategy(strategyMode)) return DEFAULT_TARGET_LEG_COUNT;
  return preset.minLegs;
}

function compareMarkets(
  a: MarketPrediction,
  b: MarketPrediction,
  mode: RankMode
): number {
  switch (mode) {
    case "odds":
      if (b.odds !== a.odds) return b.odds - a.odds;
      return b.modelProbability - a.modelProbability;
    case "probability":
      if (b.modelProbability !== a.modelProbability) {
        return b.modelProbability - a.modelProbability;
      }
      return b.edge - a.edge;
    case "balanced":
      return scoreMarket(b) - scoreMarket(a);
    case "edge":
    default:
      if (b.edge !== a.edge) return b.edge - a.edge;
      return b.modelProbability - a.modelProbability;
  }
}

function scoreMarket(m: MarketPrediction): number {
  return m.odds * 0.55 + m.modelProbability * 0.3 + Math.max(0, m.edge) * 0.15;
}

function compareLegs(a: ParlayLeg, b: ParlayLeg, mode: RankMode): number {
  switch (mode) {
    case "odds":
      return b.odds - a.odds || b.modelProbability - a.modelProbability;
    case "probability":
      return b.modelProbability - a.modelProbability || b.edge - a.edge;
    case "balanced":
      return (
        b.odds * 0.55 +
        b.modelProbability * 0.3 +
        Math.max(0, b.edge) * 0.15 -
        (a.odds * 0.55 + a.modelProbability * 0.3 + Math.max(0, a.edge) * 0.15)
      );
    case "edge":
    default:
      return b.edge - a.edge || b.modelProbability - a.modelProbability;
  }
}

function respectsDiversity(
  selected: ParlayLeg[],
  candidate: ParlayLeg,
  enforce: boolean,
  minLegs: number
): boolean {
  if (!enforce) return true;

  const family = marketFamily(candidate.market);
  const count =
    selected.filter((s) => marketFamily(s.market) === family).length + 1;

  // Hard rule from the first leg: double chance ≤ 40% of target ticket size
  if (family === "double_chance") {
    return count <= maxDoubleChanceLegs(minLegs);
  }

  // While filling toward minLegs, allow other families freely
  if (selected.length < minLegs) return true;

  const nextTotal = selected.length + 1;
  const maxAllowed = Math.max(1, Math.floor(nextTotal * MAX_MARKET_SHARE));
  return count <= Math.max(maxAllowed, 1);
}

/**
 * Multi-strategy generator: tries edge / odds / probability / balanced pools
 * and keeps the candidate best suited to the risk tier.
 *
 * Fun / accumulator modes honor `targetLegCount` (default 15): if the strict
 * probability filter yields fewer matches, the next highest-probability
 * candidates are backfilled until the exact count is reached.
 */
export function generateParlay(
  matches: Match[],
  config: ParlayConfig
): GeneratedParlay {
  const strategyMode = resolveMode(config);
  const preset = getStrategyPreset(strategyMode);

  if (isMonopolyStrategy(strategyMode)) {
    // FULL_WEEK_AUTO: match pool is Monday–Sunday from getWeeklyDateRange().
    // Date-picker input is ignored upstream in /api/parlay.
    return buildMonopolyParlay(matches, {
      stake: config.stake ?? preset.stake,
    });
  }

  const eliteMatches = rejectMatchesWithoutRealOdds(
    filterEliteWhitelistMatches(matches)
  );
  const targetLegCount = resolveTargetLegCount({
    ...preset,
    ...config,
    strategyMode,
  });

  // When the live day is thin, still fill every unique qualifying match
  const availableUnique = eliteMatches.length;
  const effectiveTarget =
    isFunStrategy(strategyMode) && availableUnique > 0
      ? Math.min(targetLegCount, availableUnique)
      : targetLegCount;

  const effective: ParlayConfig = {
    stake: config.stake ?? preset.stake,
    targetMultiplier: config.targetMultiplier ?? preset.targetMultiplier,
    maxLegs: Math.max(
      config.maxLegs ?? preset.maxLegs,
      effectiveTarget
    ),
    minOdds: config.minOdds ?? preset.minOdds,
    maxOdds: config.maxOdds ?? preset.maxOdds,
    minProbability: Math.max(
      MIN_LEG_PROBABILITY,
      config.minProbability ??
        preset.minProbability ??
        getStrictMinProbability()
    ),
    targetLegCount: effectiveTarget,
    strategyMode,
  };

  const modes: RankMode[] = isSafeStrategy(strategyMode)
    ? ["probability", "balanced", "edge"]
    : ["balanced", "odds", "edge", "probability"];
  const candidates: GeneratedParlay[] = [];
  let bestBackfillMeta = { strictCount: 0, backfilled: 0 };

  for (const mode of modes) {
    const { pool, strictCount, backfilled } = isFunStrategy(strategyMode)
      ? collectPicksWithBackfill(eliteMatches, effective, effectiveTarget, mode)
      : {
          pool: collectSafePicks(eliteMatches, effective, mode),
          strictCount: 0,
          backfilled: 0,
        };

    if (pool.length === 0) continue;

    if (backfilled > bestBackfillMeta.backfilled) {
      bestBackfillMeta = { strictCount, backfilled };
    }

    // Prefer positive-value legs (≥5% edge) when filling the accumulator
    const rankedPool = prioritizeValueLegs(pool);

    const minLegs = isFunStrategy(strategyMode)
      ? Math.min(effectiveTarget, rankedPool.length)
      : preset.minLegs;

    candidates.push(
      enforceExactLegCount(
        buildGreedy(rankedPool, effective, minLegs),
        rankedPool,
        effective,
        effectiveTarget
      )
    );
    candidates.push(
      enforceExactLegCount(
        buildClosestToTarget(rankedPool, effective, minLegs),
        rankedPool,
        effective,
        effectiveTarget
      )
    );
  }

  if (candidates.length === 0) {
    return emptyParlay(effective.stake, strategyMode);
  }

  candidates.sort((a, b) => {
    if (isSafeStrategy(strategyMode)) {
      if (Math.abs(a.jointProbability - b.jointProbability) > 0.01) {
        return b.jointProbability - a.jointProbability;
      }
      const aDist = Math.abs(
        Math.log(Math.max(a.totalOdds, 1.01)) -
          Math.log(effective.targetMultiplier)
      );
      const bDist = Math.abs(
        Math.log(Math.max(b.totalOdds, 1.01)) -
          Math.log(effective.targetMultiplier)
      );
      return aDist - bDist;
    }

    // Fun: prioritize filling available unique matches, then target odds
    const aFill = a.legs.length >= effectiveTarget ? 1 : 0;
    const bFill = b.legs.length >= effectiveTarget ? 1 : 0;
    if (aFill !== bFill) return bFill - aFill;
    if (a.legs.length !== b.legs.length) return b.legs.length - a.legs.length;
    if (a.hitTarget !== b.hitTarget) return a.hitTarget ? -1 : 1;
    const aDist = Math.abs(
      Math.log(a.totalOdds) - Math.log(effective.targetMultiplier)
    );
    const bDist = Math.abs(
      Math.log(b.totalOdds) - Math.log(effective.targetMultiplier)
    );
    return aDist - bDist;
  });

  const best = candidates[0];
  // Keep messaging relative to the user-facing 15-leg goal
  return withFillNotice(best, targetLegCount, bestBackfillMeta);
}

/**
 * Top up or trim so the ticket has exactly `targetLegCount` legs when the
 * pool allows it (fun / accumulator modes only).
 */
function enforceExactLegCount(
  parlay: GeneratedParlay,
  pool: ParlayLeg[],
  config: ParlayConfig,
  targetLegCount: number
): GeneratedParlay {
  const strategyMode = resolveMode(config);
  if (!isFunStrategy(strategyMode)) return parlay;

  if (parlay.legs.length === targetLegCount) return parlay;

  if (parlay.legs.length > targetLegCount) {
    return finalize(
      parlay.legs.slice(0, targetLegCount),
      config.stake,
      config.targetMultiplier,
      strategyMode
    );
  }

  const used = new Set(parlay.legs.map((l) => l.matchId));
  const extras = pool.filter((l) => !used.has(l.matchId));
  const filled = [...parlay.legs];

  for (const leg of extras) {
    if (filled.length >= targetLegCount) break;
    if (filled.length >= config.maxLegs) break;
    filled.push(leg);
  }

  return finalize(
    filled,
    config.stake,
    config.targetMultiplier,
    strategyMode
  );
}

function withFillNotice(
  parlay: GeneratedParlay,
  targetLegCount: number,
  backfillMeta?: { strictCount: number; backfilled: number }
): GeneratedParlay {
  if (parlay.legs.length === 0) return parlay;

  if (parlay.legs.length >= targetLegCount) {
    if (backfillMeta && backfillMeta.backfilled > 0) {
      return {
        ...parlay,
        fillNotice: `Filtro estricto (≥${(getStrictMinProbability() * 100).toFixed(0)}%): ${backfillMeta.strictCount} picks · se rellenaron ${backfillMeta.backfilled} slots con la siguiente mayor probabilidad para llegar a ${targetLegCount} legs`,
      };
    }
    return { ...parlay, fillNotice: undefined };
  }

  return {
    ...parlay,
    fillNotice: `Se incluyeron los ${parlay.legs.length} partidos disponibles (objetivo: ${targetLegCount} legs)`,
  };
}

/**
 * Notice when a locked single day cannot supply 15 legs / ~20x–35x.
 */
export function singleDayShortfallNotice(
  legCount: number,
  targetLegCount: number,
  matchPoolSize: number,
  singleDayLocked: boolean
): string | undefined {
  if (!singleDayLocked) return undefined;
  if (legCount >= targetLegCount) return undefined;
  return `Se incluyeron los ${legCount} partidos disponibles para hoy (${matchPoolSize} fixtures con cuotas). Para alcanzar ${targetLegCount} legs con piso 80% / cuota ~20x–35x, selecciona una fecha con más jornada elite o activa el rango de varios días.`;
}

function emptyParlay(
  stake: number,
  strategyMode: StrategyMode = "daily-safe"
): GeneratedParlay {
  const preset = getStrategyPreset(strategyMode);
  return {
    legs: [],
    totalOdds: 1,
    stake,
    potentialPayout: stake,
    jointProbability: 0,
    riskLevel: "extreme",
    riskLabel: "Sin picks seguros disponibles con los filtros actuales",
    averageEdge: 0,
    hitTarget: false,
    strategyMode,
    strategyLabel: STRATEGY_LABELS[strategyMode],
    riskTier: preset.riskTier,
    successProbabilityLabel: undefined,
    status: isMonopolyStrategy(strategyMode) ? "INSUFFICIENT_MATCHES" : "OK",
  };
}

function finalize(
  legs: ParlayLeg[],
  stake: number,
  targetMultiplier: number,
  strategyMode: StrategyMode
): GeneratedParlay {
  const preset = getStrategyPreset(strategyMode);
  const totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);
  const jointProbability = legs.reduce(
    (acc, l) => acc * l.modelProbability,
    legs.length ? 1 : 0
  );
  const averageEdge =
    legs.length === 0
      ? 0
      : legs.reduce((s, l) => s + l.edge, 0) / legs.length;
  const risk = riskAssessment(jointProbability, preset.riskTier);
  const successProbabilityLabel =
    legs.length > 0
      ? `Probabilidad estimada de éxito: ${(jointProbability * 100).toFixed(0)}%`
      : undefined;

  return {
    legs,
    totalOdds: Number(totalOdds.toFixed(4)),
    stake,
    potentialPayout: Number((stake * totalOdds).toFixed(0)),
    jointProbability: Number(jointProbability.toFixed(6)),
    averageEdge: Number(averageEdge.toFixed(4)),
    hitTarget:
      totalOdds >= targetMultiplier * (isSafeStrategy(strategyMode) ? 0.85 : 0.9),
    strategyMode,
    strategyLabel: STRATEGY_LABELS[strategyMode],
    riskTier: preset.riskTier,
    successProbabilityLabel,
    ...risk,
  };
}

export { recalculateParlay } from "./parlay-recalc";

function buildGreedy(
  pool: ParlayLeg[],
  config: ParlayConfig,
  minLegs: number
): GeneratedParlay {
  const strategyMode = resolveMode(config);
  const enforceDiversity = isFunStrategy(strategyMode);
  const selected: ParlayLeg[] = [];
  let product = 1;

  for (const leg of pool) {
    if (selected.length >= config.maxLegs) break;
    if (selected.some((s) => s.matchId === leg.matchId)) continue;
    if (!respectsDiversity(selected, leg, enforceDiversity, minLegs)) continue;

    selected.push(leg);
    product *= leg.odds;

    // Safe: stop once min legs + target multiplier are met
    if (
      isSafeStrategy(strategyMode) &&
      selected.length >= minLegs &&
      product >= config.targetMultiplier
    ) {
      break;
    }
    // Fun: never stop before exact targetLegCount (minLegs) — must fill 15
  }

  return finalize(
    selected,
    config.stake,
    config.targetMultiplier,
    strategyMode
  );
}

function buildClosestToTarget(
  pool: ParlayLeg[],
  config: ParlayConfig,
  minLegs: number
): GeneratedParlay {
  const strategyMode = resolveMode(config);
  const enforceDiversity = isFunStrategy(strategyMode);
  // Fun: prefer odds near ~1.22 to land total ~20x–35x
  const ordered = isFunStrategy(strategyMode)
    ? [...pool].sort(
        (a, b) =>
          funOddsFit(b.odds) - funOddsFit(a.odds) ||
          b.odds - a.odds ||
          b.modelProbability - a.modelProbability
      )
    : [...pool];
  const selected: ParlayLeg[] = [];
  let product = 1;

  for (const leg of ordered) {
    if (selected.length >= config.maxLegs) break;
    if (selected.some((s) => s.matchId === leg.matchId)) continue;
    if (!respectsDiversity(selected, leg, enforceDiversity, minLegs)) continue;

    const next = product * leg.odds;
    const overshootCap = isSafeStrategy(strategyMode) ? 1.35 : 2.5;
    if (
      isSafeStrategy(strategyMode) &&
      selected.length >= minLegs &&
      product >= config.targetMultiplier * 0.95 &&
      next > config.targetMultiplier * overshootCap
    ) {
      continue;
    }

    selected.push(leg);
    product = next;

    // Fun: fill all minLegs first; only then consider stopping near target
    if (
      selected.length >= minLegs &&
      product >= config.targetMultiplier
    ) {
      break;
    }
  }

  return finalize(
    selected,
    config.stake,
    config.targetMultiplier,
    strategyMode
  );
}

export function buildMatchPredictions(
  matches: Match[],
  options?: {
    minSafeProbability?: number;
    minSafeOdds?: number;
    maxSafeOdds?: number;
    safeMarketsOnly?: boolean;
  }
): MatchPrediction[] {
  return rejectMatchesWithoutRealOdds(filterEliteWhitelistMatches(matches)).map(
    (match) => {
      const { expectedGoals, markets: allMarkets, contextFlags, contextNotes } =
        predictMatchMarkets(match, {
          minSafeProbability: resolveContextMinProbability(
            options?.minSafeProbability ?? 0.85,
            match
          ),
          minSafeOdds: options?.minSafeOdds ?? 1.15,
          maxSafeOdds: options?.maxSafeOdds ?? 1.4,
        });

      const markets = options?.safeMarketsOnly
        ? allMarkets.filter(
            (m) =>
              SAFE_MARKETS.has(m.market) &&
              !isMarketBlockedByDerby(match, m.market)
          )
        : allMarkets.filter((m) => !isMarketBlockedByDerby(match, m.market));

      const safe = markets
        .filter((m) => m.isSafePick)
        .sort((a, b) => {
          const derbyDelta =
            derbyMarketRankBonus(match, b.market) -
            derbyMarketRankBonus(match, a.market);
          if (Math.abs(derbyDelta) > 0.01) return derbyDelta;
          return (
            b.modelProbability - a.modelProbability || b.edge - a.edge
          );
        });

      return {
        matchId: match.id,
        match,
        expectedGoals,
        markets,
        bestSafePick: safe[0] ?? null,
        contextFlags,
        contextNotes,
      };
    }
  );
}

export function formatParlayClipboard(
  parlay: GeneratedParlay,
  _currency = "CLP",
  referenceYmd?: string
): string {
  if (parlay.legs.length === 0) {
    return "CareWeaPredictions — Sin acumulador generado.";
  }

  const ref = referenceYmd ?? chileDateString();

  const groups = new Map<string, typeof parlay.legs>();
  for (const leg of parlay.legs) {
    const key = leg.leagueName || "Otros";
    const bucket = groups.get(key);
    if (bucket) bucket.push(leg);
    else groups.set(key, [leg]);
  }

  let n = 0;
  const legLines: string[] = [];
  for (const [league, legs] of groups) {
    legLines.push(`▸ ${league}`);
    const ordered = [...legs].sort(
      (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
    );
    for (const l of ordered) {
      n += 1;
      const dayLabel = formatKickoffDayLabel(l.kickoff, ref);
      const explicit = getExplicitPickFromLeg(l);
      legLines.push(
        `  ${n}. [${dayLabel} CL] ${l.matchLabel}`,
        `     Apuesta: ${formatExplicitBetLine(explicit)} @ ${l.odds.toFixed(2)} (${(l.modelProbability * 100).toFixed(1)}%)`,
        `     Condición: ${explicit.condition}`,
        ...formatMarketGuideLines(explicit).map((line) =>
          line.replace(/^   /, "     ")
        )
      );
    }
  }

  const lines = [
    `CareWeaPredictions — Accumulator (${parlay.legs.length} Legs)`,
    `Multiplicador Total: ${parlay.totalOdds.toFixed(2)}x | Prob. Conjunta: ${(parlay.jointProbability * 100).toFixed(1)}%`,
    parlay.strategyLabel
      ? `Estrategia: ${parlay.strategyLabel}`
      : undefined,
    parlay.successProbabilityLabel,
    parlay.fillNotice,
    "────────────────────────",
    ...legLines,
    "────────────────────────",
    `Legs: ${parlay.legs.length} partidos`,
    `Riesgo: ${parlay.riskLabel}`,
  ].filter(Boolean) as string[];

  return lines.join("\n");
}
