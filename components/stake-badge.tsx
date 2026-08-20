"use client";

import { useBankrollSettings } from "@/lib/bankroll-store";
import {
  calculateParlayStake,
  calculateSingleStake,
  type StakeRecommendation,
} from "@/lib/stake-engine";
import { cn, formatCLP } from "@/lib/utils";
import { useMemo } from "react";

interface StakeBadgeProps {
  kind: "single" | "parlay";
  recommendation: StakeRecommendation;
  className?: string;
}

export function StakeBadge({
  kind,
  recommendation,
  className,
}: StakeBadgeProps) {
  const isParlay = kind === "parlay";
  const hasStake = recommendation.amountCLP > 0;
  const label = !hasStake
    ? isParlay
      ? "Sin apuesta sugerida al ticket"
      : "Sin apuesta sugerida"
    : isParlay
      ? `🎟️ Apuesta sugerida al ticket: ${formatCLP(recommendation.amountCLP)} (${recommendation.percentageOfBankroll.toFixed(1)}% de tu banca)`
      : `💰 Apuesta sugerida: ${formatCLP(recommendation.amountCLP)} (${recommendation.percentageOfBankroll.toFixed(1)}% de tu banca)`;

  return (
    <p
      title={recommendation.reasoning}
      className={cn(
        "rounded-lg border px-2.5 py-1.5 text-xs font-medium leading-snug",
        hasStake
          ? isParlay
            ? "border-amber-400/35 bg-amber-500/10 text-amber-100"
            : "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
          : "border-slate-600 bg-slate-950/60 text-slate-300",
        className
      )}
    >
      {label}
      <span className="mt-0.5 block text-[11px] font-normal text-slate-300">
        {recommendation.reasoning}
      </span>
    </p>
  );
}

export function SingleStakeBadge({
  modelProbability,
  odds,
  pickCount = 1,
  className,
}: {
  modelProbability: number;
  odds: number;
  /** How many singles the app is showing today — stake shrinks as this grows. */
  pickCount?: number;
  className?: string;
}) {
  const settings = useBankrollSettings();
  const recommendation = useMemo(
    () =>
      calculateSingleStake(settings.totalBankroll, modelProbability, odds, {
        ...settings,
        pickCount,
      }),
    [settings, modelProbability, odds, pickCount]
  );
  return (
    <StakeBadge
      kind="single"
      recommendation={recommendation}
      className={className}
    />
  );
}

export function ParlayStakeBadge({
  totalOdds,
  combinedProbability,
  legCount = 1,
  className,
}: {
  totalOdds: number;
  combinedProbability: number;
  /** Legs on this ticket — more legs → smaller stake. */
  legCount?: number;
  className?: string;
}) {
  const settings = useBankrollSettings();
  const recommendation = useMemo(
    () =>
      calculateParlayStake(
        settings.totalBankroll,
        totalOdds,
        combinedProbability,
        { ...settings, legCount }
      ),
    [settings, totalOdds, combinedProbability, legCount]
  );
  return (
    <StakeBadge
      kind="parlay"
      recommendation={recommendation}
      className={className}
    />
  );
}

export function useSingleStakeRecommendation(
  modelProbability: number,
  odds: number,
  pickCount = 1
): StakeRecommendation {
  const settings = useBankrollSettings();
  return useMemo(
    () =>
      calculateSingleStake(settings.totalBankroll, modelProbability, odds, {
        ...settings,
        pickCount,
      }),
    [settings, modelProbability, odds, pickCount]
  );
}

export function useParlayStakeRecommendation(
  totalOdds: number,
  combinedProbability: number,
  legCount = 1
): StakeRecommendation {
  const settings = useBankrollSettings();
  return useMemo(
    () =>
      calculateParlayStake(
        settings.totalBankroll,
        totalOdds,
        combinedProbability,
        { ...settings, legCount }
      ),
    [settings, totalOdds, combinedProbability, legCount]
  );
}
