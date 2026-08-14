"use client";

import { BUILDER_MODES } from "@/config/builder-modes";
import { getStrategyPreset } from "@/lib/parlay-defaults";
import type { StrategyMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Crown, Shield, Target } from "lucide-react";
import type { ReactNode } from "react";

interface ModeSelectorProps {
  value: StrategyMode;
  onChange: (mode: StrategyMode) => void;
}

export function ModeSelector({ value, onChange }: ModeSelectorProps) {
  const safe = getStrategyPreset("daily-safe");
  const fun = getStrategyPreset("daily-fun");
  const monopoly = BUILDER_MODES.MONOPOLY_ASYMMETRY;

  return (
    <div
      className="grid grid-cols-1 gap-2 md:grid-cols-3"
      role="radiogroup"
      aria-label="Estrategias"
    >
      <StrategyOption
        active={value === "daily-safe"}
        title={safe.title}
        subtitle={safe.subtitle}
        icon={<Target className="h-4 w-4 text-emerald-400" aria-hidden />}
        onClick={() => onChange("daily-safe")}
        recommended
      />
      <StrategyOption
        active={value === "daily-fun"}
        title={fun.title}
        subtitle={fun.subtitle}
        icon={<Shield className="h-4 w-4 text-amber-400" aria-hidden />}
        onClick={() => onChange("daily-fun")}
        fun
      />
      <StrategyOption
        active={value === "monopoly-asymmetry"}
        title="Modo Asimetría"
        subtitle="Gigantes Exóticos · Legs Dinámicas · Lunes a Domingo"
        stakeTag={monopoly.recommendedStake}
        icon={<Crown className="h-4 w-4 text-emerald-300" aria-hidden />}
        onClick={() => onChange("monopoly-asymmetry")}
        monopoly
      />
    </div>
  );
}

function StrategyOption({
  active,
  title,
  subtitle,
  stakeTag,
  icon,
  onClick,
  recommended,
  fun,
  monopoly,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  stakeTag?: string;
  icon?: ReactNode;
  onClick: () => void;
  recommended?: boolean;
  fun?: boolean;
  monopoly?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "rounded-xl border px-3 py-3 text-left transition",
        active
          ? monopoly
            ? "border-emerald-400/70 bg-gradient-to-br from-emerald-500/25 via-emerald-600/10 to-teal-500/15 shadow-[0_0_0_1px_rgba(16,185,129,0.4)]"
            : fun
              ? "border-amber-500/50 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.25)]"
              : "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
          : monopoly
            ? "border-emerald-800/60 bg-gradient-to-br from-emerald-950/40 to-slate-950/40 hover:border-emerald-700/80"
            : "border-slate-700 bg-slate-950/40 hover:border-slate-600"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-start gap-2 text-sm font-semibold leading-snug text-slate-100">
          {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
          <span>{title}</span>
        </p>
        {recommended && (
          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
            Sugerido
          </span>
        )}
        {fun && !recommended && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            Lotería
          </span>
        )}
        {monopoly && (
          <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
            Gigantes Exóticos
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{subtitle}</p>
      {stakeTag ? (
        <p className="mt-2 text-[11px] font-medium tracking-wide text-emerald-300/90">
          Stake {stakeTag}
        </p>
      ) : null}
    </button>
  );
}
