"use client";

import { BUILDER_MODES } from "@/config/builder-modes";
import { getStrategyPreset } from "@/lib/parlay-defaults";
import type { StrategyMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Crown, Shield, Target } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useRef,
} from "react";

interface ModeSelectorProps {
  value: StrategyMode;
  onChange: (mode: StrategyMode) => void;
}

const MODES: StrategyMode[] = [
  "daily-safe",
  "daily-fun",
  "monopoly-asymmetry",
];

export function ModeSelector({ value, onChange }: ModeSelectorProps) {
  const safe = getStrategyPreset("daily-safe");
  const fun = getStrategyPreset("daily-fun");
  const monopoly = BUILDER_MODES.MONOPOLY_ASYMMETRY;
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectAt = useCallback(
    (index: number) => {
      const next = MODES[(index + MODES.length) % MODES.length];
      onChange(next);
      itemRefs.current[MODES.indexOf(next)]?.focus();
    },
    [onChange]
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = MODES.indexOf(value);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectAt(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectAt(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectAt(MODES.length - 1);
    }
  };

  return (
    <div
      className="grid grid-cols-1 gap-2 md:grid-cols-3"
      role="radiogroup"
      aria-label="Estrategia"
      onKeyDown={onKeyDown}
    >
      <StrategyOption
        ref={(el) => {
          itemRefs.current[0] = el;
        }}
        active={value === "daily-safe"}
        title={safe.title}
        subtitle={safe.subtitle}
        icon={<Target className="h-4 w-4 text-emerald-300" aria-hidden />}
        onClick={() => onChange("daily-safe")}
        recommended
      />
      <StrategyOption
        ref={(el) => {
          itemRefs.current[1] = el;
        }}
        active={value === "daily-fun"}
        title={fun.title}
        subtitle={fun.subtitle}
        icon={<Shield className="h-4 w-4 text-amber-200" aria-hidden />}
        onClick={() => onChange("daily-fun")}
        fun
      />
      <StrategyOption
        ref={(el) => {
          itemRefs.current[2] = el;
        }}
        active={value === "monopoly-asymmetry"}
        title="Modo Asimetría"
        subtitle="Gigantes exóticos · legs dinámicas · lunes a domingo"
        stakeTag={monopoly.recommendedStake}
        icon={<Crown className="h-4 w-4 text-emerald-200" aria-hidden />}
        onClick={() => onChange("monopoly-asymmetry")}
        monopoly
      />
    </div>
  );
}

function StrategyOption({
  ref,
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
  ref?: (el: HTMLButtonElement | null) => void;
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
      ref={ref}
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
        active
          ? monopoly
            ? "border-emerald-400 bg-emerald-500/20"
            : fun
              ? "border-amber-400 bg-amber-500/20"
              : "border-emerald-400 bg-emerald-500/20"
          : "border-slate-600 bg-slate-950/60 hover:border-slate-500"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-start gap-2 text-sm font-semibold leading-snug text-slate-50">
          {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
          <span>{title}</span>
        </p>
        {recommended && (
          <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-medium text-emerald-100">
            Sugerido
          </span>
        )}
        {fun && !recommended && (
          <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-100">
            Lotería
          </span>
        )}
        {monopoly && (
          <span className="shrink-0 rounded bg-emerald-400/20 px-1.5 py-0.5 text-xs font-medium text-emerald-100">
            Gigantes exóticos
          </span>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-300">{subtitle}</p>
      {stakeTag ? (
        <p className="mt-2 text-xs font-medium text-emerald-200">
          Stake {stakeTag}
        </p>
      ) : null}
    </button>
  );
}
