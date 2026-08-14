export type BuilderModeId =
  | "SINGLE_SAFE"
  | "LOTTERY"
  | "MONOPOLY_ASYMMETRY";

export type DateSelectionMode = "SINGLE_DAY" | "FULL_WEEK_AUTO";

export type BuilderModeDefinition = {
  id: BuilderModeId;
  name: string;
  legs?: number;
  minLegs?: number;
  maxLegs?: number | null;
  minProb?: number;
  minProbPerLeg?: number;
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
    recommendedStake: "1U",
    description: "Apuestas sueltas de máxima certeza individual.",
  },
  LOTTERY: {
    id: "LOTTERY",
    name: "Modo Lotería",
    legs: 15,
    minProb: 0.8,
    targetOdds: "20x - 35x",
    recommendedStake: "1U",
    description: "Combinada masiva de 15 legs para multiplicador alto.",
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
