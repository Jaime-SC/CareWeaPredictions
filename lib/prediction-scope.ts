import {
  EXPANSION_LEAGUE_IDS,
  PREDICTION_FILTER_COUNTRIES,
  resolveCountryLabel,
  resolvePredictionLeagueIds,
  type PredictionScopeOptions,
} from "../config/allowed-leagues";
import { parseLeagueId } from "../config/allowed-leagues";

export type { PredictionScopeOptions };

/** Parse CSV / repeated query values into unique trimmed strings. */
export function parseCsvParam(
  value: string | null | undefined
): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

export function parseSelectedCountries(
  raw: string | string[] | null | undefined
): string[] {
  const parts = Array.isArray(raw)
    ? raw.flatMap((v) => parseCsvParam(v))
    : parseCsvParam(raw);
  const out: string[] = [];
  for (const part of parts) {
    const label = resolveCountryLabel(part);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

export function parseSelectedLeagueIds(
  raw: string | string[] | number[] | null | undefined
): number[] {
  const parts = Array.isArray(raw)
    ? raw.flatMap((v) =>
        typeof v === "number" ? [String(v)] : parseCsvParam(String(v))
      )
    : parseCsvParam(raw);
  const ids: number[] = [];
  for (const part of parts) {
    const id = parseLeagueId(part);
    if (id != null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function parseExpandLeagues(
  raw: string | boolean | null | undefined
): boolean {
  if (raw === true) return true;
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "expanded";
}

export function scopeFromRequestParams(params: {
  expandLeagues?: string | boolean | null;
  expand?: string | boolean | null;
  countries?: string | null;
  selectedCountries?: string | null;
  leagueIds?: string | null;
  selectedLeagueIds?: string | null;
}): PredictionScopeOptions {
  return {
    expandLeagues:
      parseExpandLeagues(params.expandLeagues) ||
      parseExpandLeagues(params.expand),
    selectedCountries: parseSelectedCountries(
      params.selectedCountries ?? params.countries
    ),
    selectedLeagueIds: parseSelectedLeagueIds(
      params.selectedLeagueIds ?? params.leagueIds
    ),
  };
}

export function scopeFromBody(body: Record<string, unknown>): PredictionScopeOptions {
  return {
    expandLeagues: parseExpandLeagues(
      (body.expandLeagues as string | boolean | null | undefined) ??
        (body.expand as string | boolean | null | undefined)
    ),
    selectedCountries: parseSelectedCountries(
      (body.selectedCountries as string | string[] | null | undefined) ??
        (body.countries as string | string[] | null | undefined)
    ),
    selectedLeagueIds: parseSelectedLeagueIds(
      (body.selectedLeagueIds as string | number[] | null | undefined) ??
        (body.leagueIds as string | number[] | null | undefined)
    ),
  };
}

export function scopeCacheKey(scope: PredictionScopeOptions): string {
  const ids = resolvePredictionLeagueIds(scope).slice().sort((a, b) => a - b);
  return ids.join(",");
}

export {
  EXPANSION_LEAGUE_IDS,
  PREDICTION_FILTER_COUNTRIES,
  resolvePredictionLeagueIds,
};
