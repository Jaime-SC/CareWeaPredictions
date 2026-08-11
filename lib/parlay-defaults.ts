import type { ParlayConfig, RiskTier, StrategyMode } from "./types";

export interface StrategyPreset extends ParlayConfig {
  strategyMode: StrategyMode;
  daysAhead: number;
  riskTier: RiskTier;
  minLegs: number;
  title: string;
  subtitle: string;
  badgeLabel: string;
}

export const STRATEGY_LABELS: Record<StrategyMode, string> = {
  "daily-safe": "Picks Seguros Individuales",
  "daily-fun": "Combinada Diversión",
};

export const STRATEGY_PRESETS: Record<StrategyMode, StrategyPreset> = {
  "daily-safe": {
    strategyMode: "daily-safe",
    title: "🎯 Selección de Picks Seguros (Individuales)",
    subtitle:
      "Apuestas sueltas · modelo ≥ 85% · sin acumulador · stake sugerido $1.000 CLP",
    badgeLabel: "Individuales",
    daysAhead: 0,
    riskTier: "safe",
    stake: 1000,
    targetMultiplier: 1,
    minLegs: 1,
    maxLegs: 1,
    minOdds: 1.15,
    maxOdds: 1.4,
    minProbability: 0.85,
  },
  "daily-fun": {
    strategyMode: "daily-fun",
    title: "🎰 Combinada Diversión (Alta Cuota)",
    subtitle: "Objetivo ~200x · Stake $200 CLP → ~$40.000 · lotería del día",
    badgeLabel: "Alta Varianza",
    daysAhead: 0,
    riskTier: "fun",
    stake: 200,
    targetMultiplier: 200,
    minLegs: 12,
    maxLegs: 18,
    minOdds: 1.12,
    maxOdds: 1.55,
    minProbability: 0.73,
  },
};

/** @deprecated Prefer getStrategyPreset(mode) */
export const DEFAULT_AUTO_PARLAY_CONFIG: ParlayConfig = {
  ...STRATEGY_PRESETS["daily-fun"],
};

export const STRATEGY_DAYS_AHEAD: Record<StrategyMode, number> = {
  "daily-safe": 0,
  "daily-fun": 0,
};

export function resolveStrategyMode(value: unknown): StrategyMode {
  if (value === "daily-fun" || value === "diversified" || value === "weekly-fun") {
    return "daily-fun";
  }
  // Legacy weekly-safe / ultra-safe → daily-safe
  return "daily-safe";
}

export function getStrategyPreset(mode: StrategyMode): StrategyPreset {
  return STRATEGY_PRESETS[resolveStrategyMode(mode)];
}

export function isSafeStrategy(mode: StrategyMode): boolean {
  return getStrategyPreset(mode).riskTier === "safe";
}

export function isFunStrategy(mode: StrategyMode): boolean {
  return getStrategyPreset(mode).riskTier === "fun";
}

/** @deprecated Use isSafeStrategy */
export function isUltraSafeStrategy(mode: StrategyMode): boolean {
  return isSafeStrategy(mode);
}
