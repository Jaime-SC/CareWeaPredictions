"use client";

import { Button } from "@/components/ui/button";
import {
  ALLOWED_LEAGUES,
  DEFAULT_PREDICTION_LEAGUE_IDS,
  EXPANSION_LEAGUE_IDS,
  PREDICTION_FILTER_COUNTRIES,
  UEFA_COMPETITION_IDS,
  type PredictionScopeOptions,
} from "@/config/allowed-leagues";

export type CompetitionScopeValue = PredictionScopeOptions;

type Props = {
  value: CompetitionScopeValue;
  onChange: (next: CompetitionScopeValue) => void;
};

function toggleInList(list: string[], item: string): string[] {
  return list.includes(item)
    ? list.filter((x) => x !== item)
    : [...list, item];
}

function toggleId(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

const EXPANSION_ENTRIES = ALLOWED_LEAGUES.filter((l) =>
  EXPANSION_LEAGUE_IDS.includes(l.id)
);

const UEFA_DEFAULT_ENTRIES = ALLOWED_LEAGUES.filter((l) =>
  UEFA_COMPETITION_IDS.has(l.id)
);

const DEFAULT_BADGE_GROUPS: ReadonlyArray<{ label: string; ids: readonly number[] }> = [
  {
    label: "Europa (Top 5: ENG/ESP/ITA/GER/FRA - 1ª y 2ª Div + Copas)",
    ids: [39, 40, 45, 48, 140, 141, 143, 135, 136, 137, 78, 79, 81, 61, 62, 66],
  },
  { label: "UEFA Champions / Europa / Conference", ids: [2, 3, 848] },
  { label: "Brasil", ids: [71, 72, 73] },
  { label: "CONMEBOL", ids: [13, 11] },
];

export function CompetitionScopeFilter({ value, onChange }: Props) {
  const countries = value.selectedCountries ?? [];
  const leagueIds = value.selectedLeagueIds ?? [];
  const expand = value.expandLeagues === true;
  const selective = countries.length > 0 || (!expand && leagueIds.length > 0);

  return (
    <div className="space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-white">Alcance de competiciones</p>
          <p className="text-xs text-neutral-500">
            {selective
              ? "Filtro selectivo activo (ignora el preset por defecto)"
              : expand
                ? "Preset + ligas de expansión"
                : "Preset: Top 5 Europa + UEFA + Brasil + CONMEBOL"}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={expand ? "default" : "outline"}
          disabled={selective}
          onClick={() =>
            onChange({
              ...value,
              expandLeagues: !expand,
              selectedCountries: [],
              selectedLeagueIds: [],
            })
          }
        >
          {expand ? "Expansión ON" : "Expandir ligas"}
        </Button>
      </div>

      {!selective && !expand && (
        <div className="flex flex-wrap gap-1.5">
          {DEFAULT_BADGE_GROUPS.map((group) => (
            <span
              key={group.label}
              className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-neutral-300 ring-1 ring-white/10"
              title={group.ids.join(", ")}
            >
              {group.label}
            </span>
          ))}
        </div>
      )}

      {!expand && (
        <div className="flex flex-wrap gap-1.5">
          <p className="w-full text-[11px] text-neutral-500">
            UEFA (opcional: solo estas competiciones · origen Top 5 1ª)
          </p>
          {UEFA_DEFAULT_ENTRIES.map((league) => {
            const active = leagueIds.includes(league.id);
            return (
              <button
                key={league.id}
                type="button"
                onClick={() =>
                  onChange({
                    expandLeagues: false,
                    selectedCountries: [],
                    selectedLeagueIds: toggleId(leagueIds, league.id),
                  })
                }
                className={
                  active
                    ? "rounded-md bg-[#0a84ff]/25 px-2 py-0.5 text-[11px] text-[#0a84ff] ring-1 ring-[#0a84ff]/40"
                    : "rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-neutral-500 ring-1 ring-white/10 hover:bg-white/10"
                }
              >
                {league.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {PREDICTION_FILTER_COUNTRIES.map((country) => {
          const active = countries.includes(country);
          return (
            <button
              key={country}
              type="button"
              onClick={() =>
                onChange({
                  expandLeagues: false,
                  selectedCountries: toggleInList(countries, country),
                  selectedLeagueIds: [],
                })
              }
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

      {expand && (
        <div className="flex flex-wrap gap-1.5">
          <p className="w-full text-[11px] text-neutral-500">
            Ligas de expansión (opcional: elige solo algunas)
          </p>
          {EXPANSION_ENTRIES.map((league) => {
            const active = leagueIds.includes(league.id);
            return (
              <button
                key={league.id}
                type="button"
                onClick={() =>
                  onChange({
                    expandLeagues: true,
                    selectedCountries: [],
                    selectedLeagueIds: toggleId(leagueIds, league.id),
                  })
                }
                className={
                  active
                    ? "rounded-md bg-[#30d158]/20 px-2 py-0.5 text-[11px] text-[#30d158] ring-1 ring-[#30d158]/35"
                    : "rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-neutral-500 ring-1 ring-white/10 hover:bg-white/10"
                }
              >
                {league.name}
              </button>
            );
          })}
        </div>
      )}

      {selective && (
        <button
          type="button"
          className="text-xs text-neutral-500 underline-offset-2 hover:underline"
          onClick={() =>
            onChange({
              expandLeagues: false,
              selectedCountries: [],
              selectedLeagueIds: [],
            })
          }
        >
          Limpiar filtros → volver al preset por defecto
        </button>
      )}

      <p className="sr-only">
        Default leagues: {DEFAULT_PREDICTION_LEAGUE_IDS.join(", ")}
      </p>
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
