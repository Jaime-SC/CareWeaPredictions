/**
 * Strict elite competition whitelist (API-Football league IDs).
 * Only these leagues/cups (plus gated elite club friendlies) enter the model.
 */

export type AllowedLeagueEntry = {
  id: number;
  name: string;
  region:
    | "europe-top5"
    | "uefa"
    | "south-america-top5"
    | "conmebol"
    | "concacaf"
    | "friendly";
};

/** Domestic top-flight leagues used to certify “elite” clubs for friendlies. */
export const ELITE_DOMESTIC_LEAGUE_IDS: readonly number[] = [
  // Europe Top 5
  39, // Premier League
  140, // La Liga
  78, // Bundesliga
  135, // Serie A
  61, // Ligue 1
  // South America Top 5
  71, // Brasileirão Serie A
  128, // Liga Profesional Argentina
  239, // Liga BetPlay Colombia
  242, // LigaPro Ecuador
  265, // Primera División Chile
  // North America
  262, // Liga MX
  253, // MLS
] as const;

export const ALLOWED_LEAGUES: readonly AllowedLeagueEntry[] = [
  // England
  { id: 39, name: "Premier League", region: "europe-top5" },
  { id: 45, name: "FA Cup", region: "europe-top5" },
  { id: 48, name: "EFL Cup", region: "europe-top5" },
  // Spain
  { id: 140, name: "La Liga", region: "europe-top5" },
  { id: 143, name: "Copa del Rey", region: "europe-top5" },
  // Germany
  { id: 78, name: "Bundesliga", region: "europe-top5" },
  { id: 81, name: "DFB Pokal", region: "europe-top5" },
  // Italy
  { id: 135, name: "Serie A", region: "europe-top5" },
  { id: 137, name: "Coppa Italia", region: "europe-top5" },
  // France
  { id: 61, name: "Ligue 1", region: "europe-top5" },
  { id: 66, name: "Coupe de France", region: "europe-top5" },

  // UEFA
  { id: 2, name: "UEFA Champions League", region: "uefa" },
  { id: 3, name: "UEFA Europa League", region: "uefa" },
  { id: 848, name: "UEFA Europa Conference League", region: "uefa" },

  // Brazil
  { id: 71, name: "Brasileirão Serie A", region: "south-america-top5" },
  { id: 73, name: "Copa do Brasil", region: "south-america-top5" },
  // Argentina
  { id: 128, name: "Liga Profesional Argentina", region: "south-america-top5" },
  { id: 130, name: "Copa Argentina", region: "south-america-top5" },
  // Colombia
  { id: 239, name: "Liga BetPlay", region: "south-america-top5" },
  { id: 240, name: "Copa Colombia", region: "south-america-top5" },
  // Ecuador
  { id: 242, name: "LigaPro Ecuador", region: "south-america-top5" },
  { id: 1050, name: "Copa Ecuador", region: "south-america-top5" },
  // Chile
  { id: 265, name: "Primera División Chile", region: "south-america-top5" },
  { id: 266, name: "Copa Chile", region: "south-america-top5" },

  // CONMEBOL
  { id: 13, name: "Copa Libertadores", region: "conmebol" },
  { id: 11, name: "Copa Sudamericana", region: "conmebol" },

  // Mexico
  { id: 262, name: "Liga MX", region: "concacaf" },
  { id: 263, name: "Copa MX", region: "concacaf" },
  // United States / Canada
  { id: 253, name: "Major League Soccer", region: "concacaf" },
  { id: 254, name: "US Open Cup", region: "concacaf" },
  // CONCACAF regional
  { id: 16, name: "CONCACAF Champions Cup", region: "concacaf" },
  { id: 779, name: "Leagues Cup", region: "concacaf" },

  // Elite club friendlies (gated: ≥1 elite domestic club)
  // API-Football historically uses 667; some plans also expose 666.
  { id: 666, name: "Friendlies Clubs", region: "friendly" },
  { id: 667, name: "Friendlies Clubs", region: "friendly" },
] as const;

export const ALLOWED_LEAGUE_IDS: ReadonlySet<number> = new Set(
  ALLOWED_LEAGUES.map((l) => l.id)
);

export const CLUB_FRIENDLY_LEAGUE_IDS: ReadonlySet<number> = new Set(
  ALLOWED_LEAGUES.filter((l) => l.region === "friendly").map((l) => l.id)
);

export const ALLOWED_LEAGUE_NAMES: ReadonlySet<string> = new Set(
  ALLOWED_LEAGUES.map((l) => l.name.toLowerCase())
);

export function isAllowedLeagueId(leagueId: number): boolean {
  return ALLOWED_LEAGUE_IDS.has(leagueId);
}

export function isClubFriendlyLeagueId(leagueId: number): boolean {
  return CLUB_FRIENDLY_LEAGUE_IDS.has(leagueId);
}

/** Normalized name match against the whitelist labels (secondary guard). */
export function isAllowedLeagueName(leagueName: string): boolean {
  const key = leagueName.trim().toLowerCase();
  if (!key) return false;
  if (ALLOWED_LEAGUE_NAMES.has(key)) return true;
  for (const name of ALLOWED_LEAGUE_NAMES) {
    if (key.includes(name) || name.includes(key)) return true;
  }
  // Common aliases
  if (key.includes("premier league")) return true;
  if (key.includes("la liga") || key.includes("laliga")) return true;
  if (key.includes("bundesliga") && !key.includes("2")) return true;
  if (key.includes("serie a") && !key.includes("serie b")) return true;
  if (key.includes("ligue 1")) return true;
  if (key.includes("uefa champions league")) return true;
  if (key.includes("europa league") && !key.includes("conference")) return true;
  if (key.includes("conference league")) return true;
  if (key.includes("libertadores")) return true;
  if (key.includes("sudamericana")) return true;
  if (key.includes("brasileir")) return true;
  if (key.includes("liga profesional") || key.includes("liga argentina"))
    return true;
  if (key.includes("liga betplay") || key.includes("primera a")) return true;
  if (key.includes("ligapro") || key.includes("liga pro")) return true;
  if (key.includes("primera división") || key.includes("primera division"))
    return true;
  if (key.includes("copa del rey") || key.includes("fa cup") || key.includes("dfb"))
    return true;
  if (key.includes("coppa italia") || key.includes("coupe de france"))
    return true;
  if (key.includes("copa do brasil") || key.includes("copa argentina"))
    return true;
  if (key.includes("copa chile") || key.includes("copa colombia")) return true;
  if (key.includes("liga mx") || key.includes("copa mx")) return true;
  if (key.includes("major league soccer") || /(^|\s)mls(\s|$)/.test(key))
    return true;
  if (key.includes("us open cup") || key.includes("u.s. open cup")) return true;
  if (key.includes("concacaf champions")) return true;
  if (key.includes("leagues cup")) return true;
  if (key.includes("friendlies clubs") || key.includes("club friendlies"))
    return true;
  return false;
}
