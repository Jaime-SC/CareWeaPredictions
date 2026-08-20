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
          icon={<Target className="h-4 w-4 text-[#30d158]" aria-hidden />}
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
          icon={<Shield className="h-4 w-4 text-[#ffd60a]" aria-hidden />}
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
          icon={<Crown className="h-4 w-4 text-[#30d158]" aria-hidden />}
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
        "pressable min-h-11 rounded-2xl px-3 py-3 text-left ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff] focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        active
          ? monopoly
            ? "bg-[#30d158]/15 ring-[#30d158]/40"
            : fun
              ? "bg-[#ffd60a]/12 ring-[#ffd60a]/35"
              : "bg-[#0a84ff]/15 ring-[#0a84ff]/40"
          : "bg-white/[0.03] ring-white/10 hover:bg-white/[0.06]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-start gap-2 text-sm font-semibold leading-snug text-white">
          {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
          <span>{title}</span>
        </p>
        {recommended && (
          <span className="shrink-0 rounded-full bg-[#30d158]/20 px-2 py-0.5 text-[11px] font-medium text-[#30d158]">
            Sugerido
          </span>
        )}
        {fun && !recommended && (
          <span className="shrink-0 rounded-full bg-[#ffd60a]/15 px-2 py-0.5 text-[11px] font-medium text-[#ffd60a]">
            Lotería
          </span>
        )}
        {monopoly && (
          <span className="shrink-0 rounded-full bg-[#30d158]/15 px-2 py-0.5 text-[11px] font-medium text-[#30d158]">
            Gigantes exóticos
          </span>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-neutral-400">{subtitle}</p>
      {stakeTag ? (
        <p className="mt-2 text-xs font-medium text-[#30d158]">
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
    <div className="rounded-2xl bg-[#30d158]/10 px-3 py-3 ring-1 ring-[#30d158]/25">
      <div className="flex items-start gap-2">
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-[#30d158]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            Ligas y equipos que se escanearán
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">
            {leagues.length} ligas domésticas · {teamCount} gigantes · semana
            lun–dom. Solo entran partidos de estas ligas.
          </p>
        </div>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {leagues.map((league) => (
          <li
            key={league.leagueId}
            className="rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/8"
          >
            <p className="text-sm font-medium text-white">
              {league.leagueName}
            </p>
            <p className="text-xs text-neutral-500">{league.country}</p>
            <ul className="mt-1.5 space-y-0.5">
              {league.teams.map((team) => (
                <li key={team.teamId} className="text-sm text-[#30d158]">
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
    <div className="flex items-start gap-3 rounded-2xl bg-white/[0.04] px-3 py-3 ring-1 ring-white/10">
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={filterOn}
        aria-describedby={`${switchId}-hint`}
        disabled={!onChange}
        onClick={() => onChange?.(!ignoreRotationFilter)}
        className={cn(
          "pressable mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-0 p-0.5 appearance-none shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff] focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed",
          filterOn ? "bg-[#30d158]" : "bg-neutral-600"
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
          className="cursor-pointer text-sm font-semibold text-white"
        >
          Filtro Anti-Rotación (Torneos Continentales)
        </label>
        <p id={`${switchId}-hint`} className="mt-1 text-xs leading-relaxed text-neutral-400">
          {filterOn
            ? "Omite partidos si el equipo tiene Champions/Europa League a ±4 días."
            : "Ignora el calendario internacional y muestra todos los partidos de la liga doméstica."}
        </p>
      </div>
    </div>
  );
}
