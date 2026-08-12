import {
  STRATEGY_LABELS,
  getStrategyPreset,
  isSafeStrategy,
} from "./parlay-defaults";
import type { GeneratedParlay, ParlayLeg, RiskTier } from "./types";

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
      riskLabel: "Modo Seguro / Alta Probabilidad (piso 80% por leg)",
    };
  }
  return {
    riskLevel: "extreme",
    riskLabel: "Modo Seguro / Alta Probabilidad — pocas legs ≥80%",
  };
}

/**
 * Rebuild totals after the user manually filters legs in the slip UI.
 * Client-safe (no Node/fs deps) — safe to import from React components.
 */
export function recalculateParlay(
  legs: ParlayLeg[],
  base: Pick<
    GeneratedParlay,
    "stake" | "strategyMode" | "strategyLabel" | "riskTier"
  > & {
    targetMultiplier?: number;
  }
): GeneratedParlay {
  const strategyMode = base.strategyMode ?? "daily-fun";
  const preset = getStrategyPreset(strategyMode);
  const stake = base.stake > 0 ? base.stake : preset.stake;
  const targetMultiplier = base.targetMultiplier ?? preset.targetMultiplier;
  const riskTier = base.riskTier ?? preset.riskTier;
  const strategyLabel = base.strategyLabel ?? STRATEGY_LABELS[strategyMode];

  if (legs.length === 0) {
    return {
      legs: [],
      totalOdds: 1,
      stake,
      potentialPayout: stake,
      jointProbability: 0,
      riskLevel: "extreme",
      riskLabel: "Sin selecciones activas — restablece el ticket o regenera",
      averageEdge: 0,
      hitTarget: false,
      strategyMode,
      strategyLabel,
      riskTier,
      successProbabilityLabel: undefined,
      fillNotice: undefined,
    };
  }

  const totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);
  const jointProbability = legs.reduce(
    (acc, l) => acc * l.modelProbability,
    1
  );
  const averageEdge = legs.reduce((s, l) => s + l.edge, 0) / legs.length;
  const risk = riskAssessment(jointProbability, riskTier);

  return {
    legs,
    totalOdds: Number(totalOdds.toFixed(4)),
    stake,
    potentialPayout: Number((stake * totalOdds).toFixed(0)),
    jointProbability: Number(jointProbability.toFixed(6)),
    averageEdge: Number(averageEdge.toFixed(4)),
    hitTarget:
      totalOdds >=
      targetMultiplier * (isSafeStrategy(strategyMode) ? 0.85 : 0.9),
    strategyMode,
    strategyLabel,
    riskTier,
    successProbabilityLabel: `Probabilidad estimada de éxito: ${(jointProbability * 100).toFixed(0)}%`,
    fillNotice: undefined,
    ...risk,
  };
}
