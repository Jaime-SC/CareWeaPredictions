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
  isSafeStrategy,
  resolveStrategyMode,
} from "./parlay-defaults";
import { predictMatchMarkets } from "./poisson";
import {
  getLeagueWeight,
  getMarketWeight,
  loadModelWeights,
  resolveMinProbability,
} from "./model-weights";

export { DEFAULT_AUTO_PARLAY_CONFIG } from "./parlay-defaults";

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

/** Fallback strict gate when weights file is missing. */
export const STRICT_MIN_PROBABILITY = 0.78;

/** Floor used when backfilling to reach targetLegCount. */
const BACKFILL_MIN_PROBABILITY = 0.55;

/** Default exact leg count for fun / accumulator tickets. */
export const DEFAULT_TARGET_LEG_COUNT = 15;

function getStrictMinProbability(): number {
  return (
    loadModelWeights().global.strictMinProbability ?? STRICT_MIN_PROBABILITY
  );
}

function getBackfillMinProbability(): number {
  return (
    loadModelWeights().global.backfillMinProbability ?? BACKFILL_MIN_PROBABILITY
  );
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

  if (jointProbability >= 0.05) {
    return {
      riskLevel: "high",
      riskLabel: "Modo Alta Varianza / Cuota Alta ($200 CLP)",
    };
  }
  return {
    riskLevel: "extreme",
    riskLabel: "Modo Alta Varianza / Cuota Alta ($200 CLP) — lotería",
  };
}

function toLeg(match: Match, pick: MarketPrediction): ParlayLeg {
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
  };
}

type RankMode = "edge" | "odds" | "probability" | "balanced";

function isMarketAllowed(
  market: MarketType,
  strategyMode: StrategyMode
): boolean {
  const mkt = getMarketWeight(market);
  if (mkt.disabled) return false;
  return isSafeStrategy(strategyMode)
    ? SAFE_MARKETS.has(market)
    : FUN_MARKETS.has(market);
}

/**
 * Collect eligible safe legs according to strategy mode.
 * Safe modes: one highest-probability pick per match.
 * Fun modes: one best pick per match (maximizes unique fixtures).
 * Applies calibrated league / market thresholds from model-weights.json.
 */
export function collectSafePicks(
  matches: Match[],
  config: Pick<
    ParlayConfig,
    "minOdds" | "maxOdds" | "minProbability" | "strategyMode"
  >,
  mode: RankMode = "edge"
): ParlayLeg[] {
  const strategyMode = resolveMode(config as ParlayConfig);
  const preset = getStrategyPreset(strategyMode);
  const baseMinProb =
    config.minProbability ??
    preset.minProbability ??
    getStrictMinProbability();
  const weights = loadModelWeights();
  const legs: ParlayLeg[] = [];

  for (const match of matches) {
    const leagueCfg = getLeagueWeight(match.leagueName, weights);
    const leagueMinOdds = Math.max(
      config.minOdds,
      leagueCfg.minOdds || config.minOdds
    );

    const { markets } = predictMatchMarkets(match, {
      minSafeProbability: baseMinProb,
      minSafeOdds: leagueMinOdds,
      maxSafeOdds: config.maxOdds,
    });

    const eligible = markets.filter((m) => {
      if (!isMarketAllowed(m.market, strategyMode)) return false;
      const minProb = resolveMinProbability(
        baseMinProb,
        m.market,
        match.leagueName,
        weights
      );
      return (
        m.modelProbability >= minProb &&
        m.odds >= leagueMinOdds &&
        m.odds <= config.maxOdds
      );
    });

    if (eligible.length === 0) continue;

    eligible.sort((a, b) => {
      const wa = getMarketWeight(a.market, weights).weight;
      const wb = getMarketWeight(b.market, weights).weight;
      // Prefer higher calibrated market weight, then rank mode
      if (Math.abs(wb - wa) > 0.01) return wb - wa;
      return compareMarkets(a, b, mode);
    });
    legs.push(toLeg(match, eligible[0]));
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
    "minOdds" | "maxOdds" | "minProbability" | "strategyMode"
  >,
  targetLegCount: number,
  mode: RankMode = "edge"
): { pool: ParlayLeg[]; strictCount: number; backfilled: number } {
  const strictMin =
    config.minProbability ?? getStrictMinProbability();

  const strict = collectSafePicks(
    matches,
    { ...config, minProbability: strictMin },
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
    { ...config, minProbability: getBackfillMinProbability() },
    "probability"
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
  // While filling toward minLegs, do not block on diversity — prioritize volume
  if (selected.length < minLegs) return true;

  const nextTotal = selected.length + 1;
  const family = marketFamily(candidate.market);
  const count =
    selected.filter((s) => marketFamily(s.market) === family).length + 1;
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
  const targetLegCount = resolveTargetLegCount({
    ...preset,
    ...config,
    strategyMode,
  });

  const effective: ParlayConfig = {
    stake: config.stake ?? preset.stake,
    targetMultiplier: config.targetMultiplier ?? preset.targetMultiplier,
    maxLegs: Math.max(
      config.maxLegs ?? preset.maxLegs,
      targetLegCount
    ),
    minOdds: config.minOdds ?? preset.minOdds,
    maxOdds: config.maxOdds ?? preset.maxOdds,
    minProbability:
      config.minProbability ??
      preset.minProbability ??
      getStrictMinProbability(),
    targetLegCount,
    strategyMode,
  };

  const modes: RankMode[] = isSafeStrategy(strategyMode)
    ? ["probability", "balanced", "edge"]
    : ["balanced", "odds", "edge", "probability"];
  const candidates: GeneratedParlay[] = [];
  let bestBackfillMeta = { strictCount: 0, backfilled: 0 };

  for (const mode of modes) {
    const { pool, strictCount, backfilled } = isFunStrategy(strategyMode)
      ? collectPicksWithBackfill(matches, effective, targetLegCount, mode)
      : {
          pool: collectSafePicks(matches, effective, mode),
          strictCount: 0,
          backfilled: 0,
        };

    if (pool.length === 0) continue;

    if (backfilled > bestBackfillMeta.backfilled) {
      bestBackfillMeta = { strictCount, backfilled };
    }

    const minLegs = isFunStrategy(strategyMode)
      ? targetLegCount
      : preset.minLegs;

    candidates.push(
      enforceExactLegCount(
        buildGreedy(pool, effective, minLegs),
        pool,
        effective,
        targetLegCount
      )
    );
    candidates.push(
      enforceExactLegCount(
        buildClosestToTarget(pool, effective, minLegs),
        pool,
        effective,
        targetLegCount
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

    // Fun: prioritize exact targetLegCount fill, then target odds
    const aFill = a.legs.length >= targetLegCount ? 1 : 0;
    const bFill = b.legs.length >= targetLegCount ? 1 : 0;
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

    if (
      isSafeStrategy(strategyMode) &&
      selected.length >= minLegs &&
      product >= config.targetMultiplier
    ) {
      break;
    }
    // Fun: keep filling until minLegs, then stop at/near target or maxLegs
    if (
      isFunStrategy(strategyMode) &&
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

function buildClosestToTarget(
  pool: ParlayLeg[],
  config: ParlayConfig,
  minLegs: number
): GeneratedParlay {
  const strategyMode = resolveMode(config);
  const enforceDiversity = isFunStrategy(strategyMode);
  // Fun longshots: prefer slightly higher odds to climb toward 200x
  const ordered = isFunStrategy(strategyMode)
    ? [...pool].sort(
        (a, b) =>
          b.odds - a.odds || b.modelProbability - a.modelProbability
      )
    : [...pool];
  const selected: ParlayLeg[] = [];
  let product = 1;

  for (const leg of ordered) {
    if (selected.length >= config.maxLegs) break;
    if (selected.some((s) => s.matchId === leg.matchId)) continue;
    if (!respectsDiversity(selected, leg, enforceDiversity, minLegs)) continue;

    const next = product * leg.odds;
    const overshootCap = isSafeStrategy(strategyMode) ? 1.35 : 1.8;
    if (
      selected.length >= minLegs &&
      product >= config.targetMultiplier * 0.95 &&
      next > config.targetMultiplier * overshootCap
    ) {
      continue;
    }

    selected.push(leg);
    product = next;

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
  return matches.map((match) => {
    const { expectedGoals, markets: allMarkets } = predictMatchMarkets(match, {
      minSafeProbability: options?.minSafeProbability ?? 0.85,
      minSafeOdds: options?.minSafeOdds ?? 1.15,
      maxSafeOdds: options?.maxSafeOdds ?? 1.4,
    });

    const markets = options?.safeMarketsOnly
      ? allMarkets.filter((m) => SAFE_MARKETS.has(m.market))
      : allMarkets;

    const safe = markets
      .filter((m) => m.isSafePick)
      .sort((a, b) => b.modelProbability - a.modelProbability || b.edge - a.edge);

    return {
      matchId: match.id,
      match,
      expectedGoals,
      markets,
      bestSafePick: safe[0] ?? null,
    };
  });
}

export function formatParlayClipboard(
  parlay: GeneratedParlay,
  currency = "CLP"
): string {
  if (parlay.legs.length === 0) {
    return "ParleyLab — Sin acumulador generado.";
  }

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
      const kickoffCl = new Intl.DateTimeFormat("es-CL", {
        timeZone: "America/Santiago",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(l.kickoff));
      legLines.push(
        `  ${n}. [${kickoffCl} CL] ${l.matchLabel} | ${l.marketLabel} @ ${l.odds.toFixed(2)} (${(l.modelProbability * 100).toFixed(1)}%)`
      );
    }
  }

  const lines = [
    "⚽ ParleyLab — Acumulador",
    parlay.strategyLabel
      ? `Estrategia: ${parlay.strategyLabel}`
      : undefined,
    parlay.successProbabilityLabel,
    parlay.fillNotice,
    parlay.riskTier === "fun"
      ? "Modo Alta Varianza / Cuota Alta ($200 CLP)"
      : undefined,
    "────────────────────────",
    ...legLines,
    "────────────────────────",
    `Cuotas totales: ${parlay.totalOdds.toFixed(2)}x`,
    `Stake: $${parlay.stake.toLocaleString("es-CL")} ${currency}`,
    `Pago potencial: $${parlay.potentialPayout.toLocaleString("es-CL")} ${currency}`,
    `Prob. conjunta: ${(parlay.jointProbability * 100).toFixed(2)}%`,
    `Riesgo: ${parlay.riskLabel}`,
  ].filter(Boolean) as string[];

  return lines.join("\n");
}
