import { BUILDER_MODES } from "../config/builder-modes";
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
  "daily-fun": "Modo Seguro / Alta Probabilidad (Piso 80% por leg)",
  "monopoly-asymmetry": BUILDER_MODES.MONOPOLY_ASYMMETRY.name,
};

export const STRATEGY_PRESETS: Record<StrategyMode, StrategyPreset> = {
  "daily-safe": {
    strategyMode: "daily-safe",
    title: "Selección de Picks Seguros (Individuales)",
    subtitle:
      "Apuestas sueltas · modelo ≥ 85% · sin acumulador · referencia 1U",
    badgeLabel: "Individuales",
    daysAhead: 0,
    riskTier: "safe",
    /** Unit stake reference (1U) — no monetary display */
    stake: 1,
    targetMultiplier: 1,
    minLegs: 1,
    maxLegs: 1,
    minOdds: 1.15,
    maxOdds: 1.4,
    minProbability: 0.85,
  },
  "daily-fun": {
    strategyMode: "daily-fun",
    title: "Modo Seguro / Alta Probabilidad (Piso 80% por leg)",
    subtitle:
      "Piso 80% por leg · 15 legs · cuotas 1.18–1.28 · objetivo ~20x–35x · 1U",
    badgeLabel: "Modo Seguro / Alta Probabilidad (Piso 80% por leg)",
    daysAhead: 0,
    riskTier: "fun",
    /** Unit stake reference (1U) — no monetary display */
    stake: 1,
    /** 1.22^15 ≈ 21x · 1.25^15 ≈ 28x · 1.28^15 ≈ 38x */
    targetMultiplier: 25,
    minLegs: 15,
    maxLegs: 15,
    targetLegCount: 15,
    minOdds: 1.18,
    maxOdds: 1.28,
    /** Hard floor for every accumulator leg */
    minProbability: 0.8,
  },
  "monopoly-asymmetry": {
    strategyMode: "monopoly-asymmetry",
    title: BUILDER_MODES.MONOPOLY_ASYMMETRY.name,
    subtitle: "Cartelera automática lun–dom · legs dinámicas · anti-rotación",
    badgeLabel: "Asimetría",
    daysAhead: 0,
    riskTier: "monopoly",
    stake: 1.5,
    targetMultiplier: 1,
    minLegs: BUILDER_MODES.MONOPOLY_ASYMMETRY.minLegs ?? 2,
    /** Dynamic: generator never truncates; this is only a type-level ceiling. */
    maxLegs: Number.MAX_SAFE_INTEGER,
    minOdds: 1.01,
    maxOdds: 12,
    minProbability:
      BUILDER_MODES.MONOPOLY_ASYMMETRY.minProbPerLeg ?? 0.82,
  },
};

/** @deprecated Prefer getStrategyPreset(mode) */
export const DEFAULT_AUTO_PARLAY_CONFIG: ParlayConfig = {
  ...STRATEGY_PRESETS["daily-fun"],
};

/**
 * Optional multi-day expansion (opt-in via API `multiDay=true`).
 * Single-date mode is the default and never auto-appends tomorrow.
 */
export const FUN_MAX_DAYS_AHEAD = 5;

/** @deprecated Prefer single-date wide pool; kept for opt-in multi-day. */
export const FUN_MIN_MATCH_POOL = 25;

export const STRATEGY_DAYS_AHEAD: Record<StrategyMode, number> = {
  "daily-safe": 0,
  "daily-fun": 0,
  "monopoly-asymmetry": 0,
};

export function resolveStrategyMode(value: unknown): StrategyMode {
  if (
    value === "daily-fun" ||
    value === "diversified" ||
    value === "weekly-fun" ||
    value === "LOTTERY"
  ) {
    return "daily-fun";
  }
  if (
    value === "monopoly-asymmetry" ||
    value === "MONOPOLY_ASYMMETRY" ||
    value === "MODE_MONOPOLY" ||
    value === "monopoly"
  ) {
    return "monopoly-asymmetry";
  }
  // Legacy weekly-safe / ultra-safe / SINGLE_SAFE → daily-safe
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

export function isMonopolyStrategy(mode: StrategyMode): boolean {
  return resolveStrategyMode(mode) === "monopoly-asymmetry";
}

/** @deprecated Use isSafeStrategy */
export function isUltraSafeStrategy(mode: StrategyMode): boolean {
  return isSafeStrategy(mode);
}
