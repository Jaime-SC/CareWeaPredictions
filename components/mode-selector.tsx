"use client";

import { BUILDER_MODES } from "@/config/builder-modes";
import { getMonopolyRosterByLeague } from "@/lib/monopoly-roster";
import { getStrategyPreset } from "@/lib/parlay-defaults";
import type { StrategyMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Crown, Globe, Shield, Target } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useRef,
} from "react";

interface ModeSelectorProps {
  value: StrategyMode;
  onChange: (mode: StrategyMode) => void;
  ignoreRotationFilter?: boolean;
  onIgnoreRotationFilterChange?: (value: boolean) => void;
}

const MODES: StrategyMode[] = [
  "daily-safe",
  "daily-fun",
  "monopoly-asymmetry",
];

export function ModeSelector({
  value,
  onChange,
  ignoreRotationFilter = false,
  onIgnoreRotationFilterChange,
}: ModeSelectorProps) {
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
    <div className="space-y-3">
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
      {value === "monopoly-asymmetry" ? (
        <>
          <MonopolyRosterPreview />
          <RotationFilterSwitch
            ignoreRotationFilter={ignoreRotationFilter}
            onChange={onIgnoreRotationFilterChange}
          />
        </>
      ) : null}
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

function MonopolyRosterPreview() {
  const leagues = getMonopolyRosterByLeague();
  const teamCount = leagues.reduce((sum, league) => sum + league.teams.length, 0);

  return (
    <div className="rounded-xl border border-emerald-400/30 bg-slate-950/60 px-3 py-3">
      <div className="flex items-start gap-2">
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-50">
            Ligas y equipos que se escanearán
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-300">
            {leagues.length} ligas domésticas · {teamCount} gigantes · semana
            lun–dom. Solo entran partidos de estas ligas.
          </p>
        </div>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {leagues.map((league) => (
          <li
            key={league.leagueId}
            className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2"
          >
            <p className="text-sm font-medium text-slate-50">
              {league.leagueName}
            </p>
            <p className="text-xs text-slate-400">{league.country}</p>
            <ul className="mt-1.5 space-y-0.5">
              {league.teams.map((team) => (
                <li key={team.teamId} className="text-sm text-emerald-100">
                  {team.teamName}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RotationFilterSwitch({
  ignoreRotationFilter,
  onChange,
}: {
  ignoreRotationFilter: boolean;
  onChange?: (value: boolean) => void;
}) {
  const filterOn = !ignoreRotationFilter;
  const switchId = "monopoly-rotation-filter";

  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-600 bg-slate-950/60 px-3 py-3">
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={filterOn}
        aria-describedby={`${switchId}-hint`}
        disabled={!onChange}
        onClick={() => onChange?.(!ignoreRotationFilter)}
        className={cn(
          "mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-0 p-0.5 appearance-none shadow-inner transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed",
          filterOn ? "bg-emerald-500" : "bg-slate-600"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            filterOn ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
      <div className="min-w-0 flex-1">
        <label
          htmlFor={switchId}
          className="cursor-pointer text-sm font-semibold text-slate-50"
        >
          Filtro Anti-Rotación (Torneos Continentales)
        </label>
        <p id={`${switchId}-hint`} className="mt-1 text-xs leading-relaxed text-slate-300">
          {filterOn
            ? "Omite partidos si el equipo tiene Champions/Europa League a ±4 días."
            : "Ignora el calendario internacional y muestra todos los partidos de la liga doméstica."}
        </p>
      </div>
    </div>
  );
}
