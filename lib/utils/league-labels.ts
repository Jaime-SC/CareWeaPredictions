/**
 * Canonical UI labels for leagues that share ambiguous API names
 * (e.g. Italy vs Brazil "Serie A").
 */
import { ALLOWED_LEAGUES, parseLeagueId } from "../../config/allowed-leagues";

const LEAGUE_NAME_BY_ID = new Map(
  ALLOWED_LEAGUES.map((l) => [l.id, l.name] as const)
);

/** Display overrides keyed by API-Football league id. */
const DISPLAY_NAME_BY_ID: Readonly<Record<number, string>> = {
  135: "Serie A (Italia)",
  136: "Serie B (Italia)",
  71: "Brasileirão Série A",
  72: "Brasileirão Série B",
};

const COUNTRY_BY_LEAGUE_ID: Readonly<Record<number, string>> = {
  39: "Inglaterra",
  40: "Inglaterra",
  45: "Inglaterra",
  48: "Inglaterra",
  140: "España",
  141: "España",
  143: "España",
  135: "Italia",
  136: "Italia",
  137: "Italia",
  61: "Francia",
  62: "Francia",
  66: "Francia",
  78: "Alemania",
  79: "Alemania",
  81: "Alemania",
  71: "Brasil",
  72: "Brasil",
  73: "Brasil",
  128: "Argentina",
  129: "Argentina",
  130: "Argentina",
  265: "Chile",
  266: "Chile",
  267: "Chile",
  262: "México",
  253: "EE.UU. / Canadá",
};

export function getLeagueDisplayName(
  leagueId: number | string | null | undefined,
  fallbackName?: string | null
): string {
  const id = parseLeagueId(leagueId);
  if (id != null && DISPLAY_NAME_BY_ID[id]) return DISPLAY_NAME_BY_ID[id];
  if (id != null) {
    const fromWhitelist = LEAGUE_NAME_BY_ID.get(id);
    if (fromWhitelist) return fromWhitelist;
  }
  const fallback = fallbackName?.trim();
  if (fallback) {
    // Ambiguous bare "Serie A" without id → do not invent Italy/Brazil
    return fallback;
  }
  return "Otros";
}

export function getLeagueCountry(
  leagueId: number | string | null | undefined
): string | null {
  const id = parseLeagueId(leagueId);
  if (id == null) return null;
  return COUNTRY_BY_LEAGUE_ID[id] ?? null;
}
