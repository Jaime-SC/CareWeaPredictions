"use client";

import { useState } from "react";
import {
  PREDICTION_FILTER_COUNTRIES,
  type PredictionScopeOptions,
} from "@/config/allowed-leagues";

export type CompetitionScopeValue = PredictionScopeOptions;

type Props = {
  value: CompetitionScopeValue;
  onChange: (next: CompetitionScopeValue) => void;
};

type ScopeMode = "default" | "expand" | "country";

function toggleCountry(list: string[], item: string): string[] {
  return list.includes(item)
    ? list.filter((x) => x !== item)
    : [...list, item];
}

const MODES: ReadonlyArray<{
  id: ScopeMode;
  title: string;
  hint: string;
}> = [
  {
    id: "default",
    title: "Predeterminado",
    hint: "Top 5 Europa + UEFA + Brasil + CONMEBOL",
  },
  {
    id: "expand",
    title: "Ampliar",
    hint: "Lo anterior + Argentina, Chile, México, MLS…",
  },
  {
    id: "country",
    title: "Solo país",
    hint: "Elige uno o varios (ignora el preset)",
  },
];

function modeButtonClass(active: boolean): string {
  return active
    ? "rounded-xl bg-[#0a84ff]/20 px-3 py-2 text-left ring-1 ring-[#0a84ff]/45"
    : "rounded-xl bg-white/[0.04] px-3 py-2 text-left ring-1 ring-white/10 hover:bg-white/[0.07]";
}

export function CompetitionScopeFilter({ value, onChange }: Props) {
  const countries = value.selectedCountries ?? [];
  const expand = value.expandLeagues === true;
  /** Keep country panel open while the user is choosing (even if still empty). */
  const [pickingCountry, setPickingCountry] = useState(false);

  const mode: ScopeMode = pickingCountry
    ? "country"
    : countries.length > 0
      ? "country"
      : expand
        ? "expand"
        : "default";

  function setMode(next: ScopeMode) {
    if (next === "default") {
      setPickingCountry(false);
      onChange({
        expandLeagues: false,
        selectedCountries: [],
        selectedLeagueIds: [],
      });
      return;
    }
    if (next === "expand") {
      setPickingCountry(false);
      onChange({
        expandLeagues: true,
        selectedCountries: [],
        selectedLeagueIds: [],
      });
      return;
    }
    setPickingCountry(true);
    onChange({
      expandLeagues: false,
      selectedCountries: countries,
      selectedLeagueIds: [],
    });
  }

  return (
    <div className="space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10">
      <div>
        <p className="text-sm font-medium text-white">¿Dónde buscar?</p>
        <p className="text-xs text-neutral-500">
          Elige una opción. No se mezclan.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={modeButtonClass(active)}
            >
              <span
                className={
                  active
                    ? "block text-sm font-medium text-[#0a84ff]"
                    : "block text-sm font-medium text-neutral-200"
                }
              >
                {m.title}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">
                {m.hint}
              </span>
            </button>
          );
        })}
      </div>

      {mode === "country" && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <p className="text-[11px] text-neutral-500">
            Solo se buscará en lo marcado. Sin selección = mismo efecto que
            Predeterminado al generar.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PREDICTION_FILTER_COUNTRIES.map((country) => {
              const active = countries.includes(country);
              return (
                <button
                  key={country}
                  type="button"
                  onClick={() => {
                    const next = toggleCountry(countries, country);
                    setPickingCountry(true);
                    onChange({
                      expandLeagues: false,
                      selectedCountries: next,
                      selectedLeagueIds: [],
                    });
                  }}
                  className={
                    active
                      ? "rounded-full bg-[#0a84ff]/25 px-2.5 py-1 text-xs font-medium text-[#0a84ff] ring-1 ring-[#0a84ff]/40"
                      : "rounded-full bg-white/5 px-2.5 py-1 text-xs text-neutral-400 ring-1 ring-white/10 hover:bg-white/10"
                  }
                >
                  {country}
                </button>
              );
            })}
          </div>
          {countries.length > 0 ? (
            <p className="text-xs text-neutral-400">
              Activo: {countries.join(" · ")}
            </p>
          ) : (
            <p className="text-xs text-amber-500/90">
              Marca al menos un país, o vuelve a Predeterminado.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Build query string fragment for /api/predict and body fields for /api/parlay. */
export function scopeToQuery(scope: CompetitionScopeValue): string {
  const parts: string[] = [];
  if (scope.expandLeagues) parts.push("expandLeagues=1");
  if (scope.selectedCountries?.length) {
    parts.push(
      `selectedCountries=${encodeURIComponent(scope.selectedCountries.join(","))}`
    );
  }
  if (scope.selectedLeagueIds?.length) {
    parts.push(`selectedLeagueIds=${scope.selectedLeagueIds.join(",")}`);
  }
  return parts.length ? `&${parts.join("&")}` : "";
}

export function scopeToBody(
  scope: CompetitionScopeValue
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (scope.expandLeagues) body.expandLeagues = true;
  if (scope.selectedCountries?.length) {
    body.selectedCountries = scope.selectedCountries;
  }
  if (scope.selectedLeagueIds?.length) {
    body.selectedLeagueIds = scope.selectedLeagueIds;
  }
  return body;
}
