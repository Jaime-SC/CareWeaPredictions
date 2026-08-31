import {
  BUILDER_MODES,
  PRESET_MAX_ODDS,
  PRESET_MIN_ODDS,
  PRESET_MIN_VALUE_MARGIN_PCT,
  PRESET_ODDS_RANGE_LABEL,
} from "../config/builder-modes";
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
    subtitle: `Apuestas sueltas · modelo ≥ 85% · cuotas ${PRESET_ODDS_RANGE_LABEL} · EV ≥ ${PRESET_MIN_VALUE_MARGIN_PCT}% · 1U`,
    badgeLabel: "Individuales",
    daysAhead: 0,
    riskTier: "safe",
    /** Unit stake reference (1U) — no monetary display */
    stake: 1,
    targetMultiplier: 1,
    minLegs: 1,
    maxLegs: 1,
    minOdds: PRESET_MIN_ODDS,
    maxOdds: PRESET_MAX_ODDS,
    minProbability: 0.85,
  },
  "daily-fun": {
    strategyMode: "daily-fun",
    title: "Modo Seguro / Alta Probabilidad (Piso 80% por leg)",
    subtitle: `Piso 80% por leg · 15 legs · cuotas ${PRESET_ODDS_RANGE_LABEL} · EV ≥ ${PRESET_MIN_VALUE_MARGIN_PCT}% · objetivo ~150x–500x · 1U`,
    badgeLabel: "Modo Seguro / Alta Probabilidad (Piso 80% por leg)",
    daysAhead: 0,
    riskTier: "fun",
    /** Unit stake reference (1U) — no monetary display */
    stake: 1,
    /** ~1.62^15 ≈ 130x (mid-band 1.40–1.85) */
    targetMultiplier: 150,
    minLegs: 15,
    maxLegs: 15,
    targetLegCount: 15,
    minOdds: PRESET_MIN_ODDS,
    maxOdds: PRESET_MAX_ODDS,
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
