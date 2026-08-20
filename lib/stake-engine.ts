import {
  DEFAULT_BANKROLL_SETTINGS,
  type BankrollSettings,
} from "./bankroll-settings";

export interface StakeRecommendation {
  amountCLP: number;
  percentageOfBankroll: number;
  reasoning: string;
}

const KELLY_FRACTION = 0.25;
const HIGH_PARLAY_ODDS = 3.0;
const HIGH_PARLAY_RISK = 0.005;
const CLP_ROUND = 100;
/** Parlay risk baseline: full maxRiskParlay applies around this many legs. */
export const PARLAY_REFERENCE_LEGS = 5;
/** Singles portfolio: full maxRiskSingle applies when recommending this many picks. */
export const SINGLE_REFERENCE_PICKS = 5;

export type StakeEngineSettings = Pick<
  BankrollSettings,
  "minBookmakerStake" | "maxRiskSingle" | "maxRiskParlay"
>;

function resolveSettings(
  settings?: Partial<StakeEngineSettings>
): StakeEngineSettings {
  return {
    minBookmakerStake:
      settings?.minBookmakerStake ?? DEFAULT_BANKROLL_SETTINGS.minBookmakerStake,
    maxRiskSingle:
      settings?.maxRiskSingle ?? DEFAULT_BANKROLL_SETTINGS.maxRiskSingle,
    maxRiskParlay:
      settings?.maxRiskParlay ?? DEFAULT_BANKROLL_SETTINGS.maxRiskParlay,
  };
}

export function roundToCleanCLP(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount / CLP_ROUND) * CLP_ROUND;
}

/**
 * Round to a clean $100 ticket when possible, but never below the bookmaker
 * minimum and never down to $0 if the raw stake was positive.
 */
export function clampStakeAmount(
  rawAmount: number,
  _bankroll: number,
  minBookmakerStake: number
): number {
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return 0;
  const min = Math.max(1, Math.round(minBookmakerStake));
  if (rawAmount < min) return min;
  return Math.max(min, roundToCleanCLP(rawAmount));
}

function toRecommendation(
  amountCLP: number,
  bankroll: number,
  reasoning: string
): StakeRecommendation {
  const safeAmount = Math.max(0, amountCLP);
  const finalPercentage =
    bankroll > 0 ? Number(((safeAmount / bankroll) * 100).toFixed(1)) : 0;
  return {
    amountCLP: safeAmount,
    percentageOfBankroll: finalPercentage,
    reasoning,
  };
}

function normalizeCount(count: number | undefined, fallback = 1): number {
  if (count == null || !Number.isFinite(count) || count < 1) return fallback;
  return Math.floor(count);
}

/**
 * More selections → less stake per ticket/pick so total exposure stays coherent.
 * Scale = reference / count (capped at 1 so fewer than reference can use full risk).
 */
export function selectionRiskScale(
  selectionCount: number,
  referenceCount: number
): number {
  const count = normalizeCount(selectionCount, 1);
  const reference = Math.max(1, referenceCount);
  return Math.min(1, reference / count);
}

/** Full Kelly fraction f* = (p·odds − 1) / (odds − 1). */
export function fullKellyFraction(
  modelProbability: number,
  odds: number
): number {
  if (!(odds > 1) || !(modelProbability > 0) || modelProbability >= 1) {
    return 0;
  }
  const b = odds - 1;
  if (!(b > 0)) return 0;
  return (modelProbability * odds - 1) / b;
}

export function calculateSingleStake(
  bankroll: number,
  modelProbability: number,
  odds: number,
  settings?: Partial<StakeEngineSettings> & { pickCount?: number }
): StakeRecommendation {
  const { minBookmakerStake, maxRiskSingle } = resolveSettings(settings);
  const pickCount = normalizeCount(settings?.pickCount, 1);
  const scale = selectionRiskScale(pickCount, SINGLE_REFERENCE_PICKS);

  if (!(bankroll > 0)) {
    return toRecommendation(0, bankroll, "Define tu banca para calcular el stake.");
  }

  const fullKelly = fullKellyFraction(modelProbability, odds);
  const quarterKelly = Math.max(0, fullKelly * KELLY_FRACTION);

  if (quarterKelly <= 0) {
    return toRecommendation(
      0,
      bankroll,
      "Sin valor esperado: Kelly 25% pide no apostar."
    );
  }

  const cappedPercentage = Math.min(quarterKelly, maxRiskSingle) * scale;
  const rawAmount = bankroll * cappedPercentage;
  const amountCLP = clampStakeAmount(rawAmount, bankroll, minBookmakerStake);
  const pickNote =
    pickCount > 1
      ? ` · repartido en ${pickCount} picks del día`
      : "";
  return toRecommendation(
    amountCLP,
    bankroll,
    `Riesgo conservador (${Number(((amountCLP / bankroll) * 100).toFixed(1))}% de tu banca) · Kelly 25% capado al ${(maxRiskSingle * 100).toFixed(0)}%${pickNote}`
  );
}

export function calculateParlayStake(
  bankroll: number,
  totalOdds: number,
  combinedProbability: number,
  settings?: Partial<StakeEngineSettings> & { legCount?: number }
): StakeRecommendation {
  const { minBookmakerStake, maxRiskParlay } = resolveSettings(settings);
  const legCount = normalizeCount(settings?.legCount, 1);
  const scale = selectionRiskScale(legCount, PARLAY_REFERENCE_LEGS);

  if (!(bankroll > 0)) {
    return toRecommendation(0, bankroll, "Define tu banca para calcular el stake.");
  }

  const highOddsRisk = Math.min(maxRiskParlay * 0.5, HIGH_PARLAY_RISK);
  const baseRisk = totalOdds > HIGH_PARLAY_ODDS ? highOddsRisk : maxRiskParlay;
  const maxRisk = baseRisk * scale;
  const rawAmount = bankroll * maxRisk;
  const amountCLP = clampStakeAmount(rawAmount, bankroll, minBookmakerStake);
  const varianceNote = totalOdds > HIGH_PARLAY_ODDS ? "cuotas altas · " : "";
  const legsNote = `${legCount} leg${legCount === 1 ? "" : "s"} · `;
  const jointNote =
    combinedProbability > 0 && combinedProbability < 1
      ? ` · p conjunta ${(combinedProbability * 100).toFixed(1)}%`
      : "";
  return toRecommendation(
    amountCLP,
    bankroll,
    `Combinada (${Number(((amountCLP / bankroll) * 100).toFixed(1))}% de banca) · ${legsNote}${varianceNote}tope ${(maxRisk * 100).toFixed(2)}%${jointNote}`
  );
}
