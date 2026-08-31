export type BuilderModeId =
  | "SINGLE_SAFE"
  | "LOTTERY"
  | "MONOPOLY_ASYMMETRY";

export type DateSelectionMode = "SINGLE_DAY" | "FULL_WEEK_AUTO";

/** Global preset band aligned with MIN_SELECTION_ODDS in poisson.ts */
export const PRESET_MIN_ODDS = 1.4;
export const PRESET_MAX_ODDS = 1.85;
export const PRESET_MIN_VALUE_MARGIN_PCT = 3;
export const PRESET_ODDS_RANGE_LABEL = "1.40–1.85";

export type BuilderModeDefinition = {
  id: BuilderModeId;
  name: string;
  legs?: number;
  minLegs?: number;
  maxLegs?: number | null;
  minProb?: number;
  minProbPerLeg?: number;
  minOdds?: number;
  maxOdds?: number;
  targetOdds?: string;
  recommendedStake: string;
  description: string;
  dateSelectionMode?: DateSelectionMode;
};

export const BUILDER_MODES: Record<BuilderModeId, BuilderModeDefinition> = {
  SINGLE_SAFE: {
    id: "SINGLE_SAFE",
    name: "Picks Seguros (Individuales)",
    legs: 1,
    minProb: 0.85,
    minOdds: PRESET_MIN_ODDS,
    maxOdds: PRESET_MAX_ODDS,
    recommendedStake: "1U",
    description: `Apuestas sueltas de máxima certeza. Cuota mín. ${PRESET_MIN_ODDS} y EV ≥ ${PRESET_MIN_VALUE_MARGIN_PCT}%.`,
  },
  LOTTERY: {
    id: "LOTTERY",
    name: "Modo Lotería",
    legs: 15,
    minProb: 0.8,
    minOdds: PRESET_MIN_ODDS,
    maxOdds: PRESET_MAX_ODDS,
    targetOdds: "~150x – 500x",
    recommendedStake: "1U",
    description: `Combinada de 15 legs (cuotas ${PRESET_ODDS_RANGE_LABEL}, EV ≥ ${PRESET_MIN_VALUE_MARGIN_PCT}%) para multiplicador alto.`,
  },
  MONOPOLY_ASYMMETRY: {
    id: "MONOPOLY_ASYMMETRY",
    name: "Modo Asimetría (Gigantes Exóticos)",
    minLegs: 2,
    maxLegs: null,
    minProbPerLeg: 0.82,
    dateSelectionMode: "FULL_WEEK_AUTO",
    recommendedStake: "1.5U - 2U",
    description:
      "Búsqueda automática semanal (Lunes a Domingo) de todos los gigantes exóticos que cumplen los filtros anti-rotación.",
  },
};

export const MODE_MONOPOLY = BUILDER_MODES.MONOPOLY_ASYMMETRY.id;

export const WEEKLY_CARTELERA_LABEL =
  "Cartelera Semanal Completa (Lunes a Domingo)";

export const INSUFFICIENT_MATCHES_MESSAGE =
  "Se encontraron menos de 2 partidos con criterios de alta certeza para esta semana.";
