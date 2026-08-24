/**
 * Strict elite competition whitelist (API-Football league IDs).
 * Only these leagues/cups enter the model (no club friendlies).
 *
 * Name matching is a secondary guard. It must never let a lower division
 * through because its label is a substring of an allowed label
 * (e.g. "Primera B" vs "Primera B Chile").
 */

export type AllowedLeagueRegion =
  | "europe-top3-and-2nd"
  | "uefa"
  | "south-america-eligible-divisions"
  | "conmebol"
  | "concacaf"
  | "friendly";

export type AllowedLeagueEntry = {
  id: number;
  name: string;
  region: AllowedLeagueRegion;
};

/** UI / filter labels for competition categories. */
export const REGION_DISPLAY_LABELS: Readonly<
  Record<AllowedLeagueRegion, string>
> = {
  "europe-top3-and-2nd": "Europa (1ª y 2ª División)",
  uefa: "UEFA (Filtro 1ª ENG·ESP·ITA)",
  "south-america-eligible-divisions": "Sudamérica (1ª y 2ª División)",
  conmebol: "CONMEBOL (Clubes Elegibles)",
  concacaf: "CONCACAF",
  friendly: "Amistosos",
};

/** Regions whose badge explains an origin / eligibility filter. */
const RESTRICTED_BADGE_REGIONS: ReadonlySet<AllowedLeagueRegion> = new Set([
  "europe-top3-and-2nd",
  "uefa",
  "conmebol",
  "south-america-eligible-divisions",
]);

/** Premier / LaLiga / Serie A — UEFA origin gate (1ª only). */
export const EUROPE_BIG5_LEAGUE_IDS: readonly number[] = [
  39, // Premier League
  140, // La Liga
  135, // Serie A
] as const;

/** England / Spain / Italy 1ª + 2ª for elite roster caches. */
export const EUROPE_ELIGIBLE_DOMESTIC_LEAGUE_IDS: readonly number[] = [
  39, // Premier League
  40, // Championship
  140, // La Liga
  141, // LaLiga 2 / Hypermotion
  135, // Serie A
  136, // Serie B
] as const;

/** UEFA club competitions that require both sides from EUROPE_BIG5_LEAGUE_IDS. */
export const UEFA_COMPETITION_IDS: ReadonlySet<number> = new Set([
  2, // Champions League
  3, // Europa League
  848, // Conference League
]);

/** Domestic 1st+2nd tiers allowed as origin for each South American national cup. */
export const SA_NATIONAL_CUP_ORIGINS: Readonly<
  Record<number, readonly number[]>
> = {
  73: [71, 72], // Copa do Brasil ← Serie A / Serie B
  130: [128, 129], // Copa Argentina ← Liga Profesional / Primera Nacional
  266: [265, 267], // Copa Chile ← Primera / Primera B
};

export const SA_NATIONAL_CUP_IDS: ReadonlySet<number> = new Set(
  Object.keys(SA_NATIONAL_CUP_ORIGINS).map(Number)
);

/** ENG / ESP / ITA national cups — both clubs from that country's 1ª or 2ª. */
export const EUROPE_NATIONAL_CUP_ORIGINS: Readonly<
  Record<number, readonly number[]>
> = {
  45: [39, 40], // FA Cup ← Premier / Championship
  48: [39, 40], // EFL Cup ← Premier / Championship
  143: [140, 141], // Copa del Rey ← LaLiga / LaLiga 2
  137: [135, 136], // Coppa Italia ← Serie A / Serie B
};

export const EUROPE_NATIONAL_CUP_IDS: ReadonlySet<number> = new Set(
  Object.keys(EUROPE_NATIONAL_CUP_ORIGINS).map(Number)
);

/**
 * CONMEBOL club competitions: both sides must be from Chile / Argentina / Brazil 1ª.
 */
export const CONMEBOL_COMPETITION_IDS: ReadonlySet<number> = new Set([
  13, // Copa Libertadores
  11, // Copa Sudamericana
]);

export const CONMEBOL_ELIGIBLE_ORIGIN_LEAGUE_IDS: readonly number[] = [
  265, // Primera División Chile
  128, // Liga Profesional Argentina
  71, // Brasileirão Serie A
] as const;

/** Domestic top-flight + SA 2nds used for origin/roster caches. */
export const ELITE_DOMESTIC_LEAGUE_IDS: readonly number[] = [
  ...EUROPE_ELIGIBLE_DOMESTIC_LEAGUE_IDS,
  // South America 1ª + 2ª (AR / BR / CL)
  71, // Brasileirão Serie A
  72, // Brasileirão Serie B
  128, // Liga Profesional Argentina
  129, // Primera Nacional
  265, // Primera División Chile
  267, // Primera B Chile
  // North America
  262, // Liga MX
  253, // MLS
] as const;

/** Domestic 1ª/2ª origin leagues whose clubs may persist a TeamProfile. */
export const TEAM_PROFILE_ORIGIN_LEAGUE_IDS: ReadonlySet<number> = new Set(
  ELITE_DOMESTIC_LEAGUE_IDS
);

export const ALLOWED_LEAGUES: readonly AllowedLeagueEntry[] = [
  // England
  { id: 39, name: "Premier League", region: "europe-top3-and-2nd" },
  { id: 40, name: "Championship", region: "europe-top3-and-2nd" },
  { id: 45, name: "FA Cup", region: "europe-top3-and-2nd" },
  { id: 48, name: "EFL Cup", region: "europe-top3-and-2nd" },
  // Spain
  { id: 140, name: "La Liga", region: "europe-top3-and-2nd" },
  { id: 141, name: "LaLiga 2", region: "europe-top3-and-2nd" },
  { id: 143, name: "Copa del Rey", region: "europe-top3-and-2nd" },
  // Italy
  { id: 135, name: "Serie A (Italia)", region: "europe-top3-and-2nd" },
  { id: 136, name: "Serie B (Italia)", region: "europe-top3-and-2nd" },
  { id: 137, name: "Coppa Italia", region: "europe-top3-and-2nd" },

  // UEFA
  { id: 2, name: "UEFA Champions League", region: "uefa" },
  { id: 3, name: "UEFA Europa League", region: "uefa" },
  { id: 848, name: "UEFA Europa Conference League", region: "uefa" },

  // Brazil
  { id: 71, name: "Brasileirão Série A", region: "south-america-eligible-divisions" },
  { id: 72, name: "Brasileirão Série B", region: "south-america-eligible-divisions" },
  { id: 73, name: "Copa do Brasil", region: "south-america-eligible-divisions" },
  // Argentina
  { id: 128, name: "Liga Profesional Argentina", region: "south-america-eligible-divisions" },
  { id: 129, name: "Primera Nacional", region: "south-america-eligible-divisions" },
  { id: 130, name: "Copa Argentina", region: "south-america-eligible-divisions" },
  // Chile
  { id: 265, name: "Primera División Chile", region: "south-america-eligible-divisions" },
  { id: 266, name: "Copa Chile", region: "south-america-eligible-divisions" },
  { id: 267, name: "Primera B Chile", region: "south-america-eligible-divisions" },

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
] as const;

/**
 * Known lower-tier / lookalike IDs for countries already in the whitelist.
 * Denied even if someone later adds them to ALLOWED_LEAGUES by mistake.
 * Allowed 2nds intentionally NOT here: ENG Championship (40), ESP LaLiga 2 (141),
 * ITA Serie B (136), BR Serie B (72), AR Primera Nacional (129), CL Primera B (267).
 */
export const DENIED_LEAGUE_IDS: ReadonlySet<number> = new Set([
  // England lower than Championship
  41, // League One
  42, // League Two
  43, // National League
  46, // EFL Trophy
  47, // FA Trophy
  // Spain lower than LaLiga 2
  142, // Primera División RFEF
  // Germany (removed from whitelist)
  78, // Bundesliga
  79, // 2. Bundesliga
  80, // 3. Liga
  81, // DFB Pokal
  // Italy lower than Serie B
  138, // Serie C
  // France (removed from whitelist)
  61, // Ligue 1
  62, // Ligue 2
  63, // National
  66, // Coupe de France
  // Brazil lower than Serie B
  75, // Serie C
  76, // Serie D
  // Argentina lower than Primera Nacional
  131, // Primera B Nacional (legacy)
  132, // Primera B Metropolitana
  // Colombia (removed from whitelist)
  239, // Liga BetPlay
  240, // Copa Colombia
  241, // Primera B / Torneo BetPlay
  // Ecuador (removed from whitelist)
  242, // LigaPro
  243, // Serie B
  1050, // Copa Ecuador
  // Chile lower than Primera B
  268, // Segunda División
  // Mexico
  264, // Liga de Expansión MX
  // USA
  255, // USL Championship
  257, // USL League One
  // Club friendlies (removed from whitelist)
  666, // Friendlies Clubs
  667, // Friendlies Clubs
]);

export const ALLOWED_LEAGUE_IDS: ReadonlySet<number> = new Set(
  ALLOWED_LEAGUES.map((l) => l.id)
);

export const CLUB_FRIENDLY_LEAGUE_IDS: ReadonlySet<number> = new Set(
  ALLOWED_LEAGUES.filter((l) => l.region === "friendly").map((l) => l.id)
);

export const ALLOWED_LEAGUE_NAMES: ReadonlySet<string> = new Set(
  ALLOWED_LEAGUES.map((l) => normalizeLeagueKey(l.name))
);

type NameRule = {
  all: readonly string[];
  none?: readonly string[];
};

/** Unique-enough aliases. Never match a short name that other countries share. */
const ALLOW_NAME_RULES: readonly NameRule[] = [
  { all: ["premier league"], none: ["2", "u18", "u21", "u23", "women", "wsl"] },
  { all: ["fa cup"], none: ["trophy", "youth", "women", "qualif"] },
  { all: ["efl cup"] },
  { all: ["league cup"], none: ["premier", "championship", "trophy"] },
  { all: ["efl championship"] },
  { all: ["championship"], none: ["usl", "world", "club"] },
  { all: ["la liga"], none: ["femenin", "women"] },
  { all: ["laliga"], none: ["femenin", "women"] },
  { all: ["laliga 2"] },
  { all: ["la liga 2"] },
  { all: ["hypermotion"] },
  { all: ["copa del rey"] },
  { all: ["serie a"], none: ["serie b", "women", "femenin", "u23"] },
  { all: ["serie b", "italia"] },
  { all: ["serie b", "italy"] },
  { all: ["coppa italia"] },
  { all: ["champions league"], none: ["youth", "u19", "women", "femenin"] },
  { all: ["europa league"], none: ["conference"] },
  { all: ["conference league"] },
  { all: ["libertadores"], none: ["u20", "sub 20", "femenin", "women"] },
  { all: ["sudamericana"], none: ["femenin", "women"] },
  { all: ["brasileirao"], none: ["serie c", "serie d"] },
  { all: ["serie b", "brasil"] },
  { all: ["brasileirao", "serie b"] },
  { all: ["copa do brasil"] },
  { all: ["liga profesional"] },
  { all: ["liga argentina"] },
  { all: ["copa argentina"] },
  { all: ["primera nacional"] },
  { all: ["primera division", "chile"] },
  { all: ["copa chile"] },
  { all: ["primera b", "chile"] },
  { all: ["chile primera b"] },
  { all: ["liga mx"], none: ["expansion", "femenil", "women"] },
  { all: ["copa mx"] },
  { all: ["major league soccer"] },
  { all: ["us open cup"] },
  { all: ["u s open cup"] },
  { all: ["concacaf champions"] },
  { all: ["leagues cup"] },
];

const DENIED_NAME_NEEDLES: readonly string[] = [
  "torneo betplay",
  "liga betplay",
  "torneo dimayor",
  "copa colombia",
  "copa dimayor",
  "primera b colombia",
  "colombia primera b",
  "primera a",
  "ligapro",
  "liga pro ecuador",
  "liga pro serie",
  "copa ecuador",
  "friendlies clubs",
  "club friendlies",
  "club friendly",
  "serie c",
  "serie d",
  "ligue 1",
  "ligue 2",
  "coupe de france",
  "2 bundesliga",
  "bundesliga 2",
  "bundesliga",
  "dfb pokal",
  "3 liga",
  "primera b metro",
  "primera b nacional",
  "liga de expansion",
  "usl championship",
  "usl league",
  "mls next",
  "premier league 2",
  "league one",
  "league two",
  "national league",
  "segunda chile",
  "ecuador serie b",
  "serie b ecuador",
];

export function normalizeLeagueKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLeagueId(
  leagueId: string | number | null | undefined
): number | undefined {
  if (leagueId == null || leagueId === "") return undefined;
  const n = typeof leagueId === "number" ? leagueId : Number(leagueId);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

const LEAGUE_BY_ID = new Map(ALLOWED_LEAGUES.map((l) => [l.id, l]));

export function resolveLeagueRegion(
  leagueId?: string | number | null,
  leagueName?: string | null
): AllowedLeagueRegion | undefined {
  const id = parseLeagueId(leagueId);
  if (id != null) {
    const byId = LEAGUE_BY_ID.get(id);
    if (byId) return byId.region;
  }
  if (!leagueName) return undefined;
  const key = normalizeLeagueKey(leagueName);
  if (!key) return undefined;
  for (const entry of ALLOWED_LEAGUES) {
    if (normalizeLeagueKey(entry.name) === key) return entry.region;
  }
  return undefined;
}

export function competitionCategoryLabel(
  leagueId?: string | number | null,
  leagueName?: string | null
): string | null {
  const region = resolveLeagueRegion(leagueId, leagueName);
  return region ? REGION_DISPLAY_LABELS[region] : null;
}

/** Badge for cups/regions with an origin filter (Europa 1ª/2ª, UEFA, CONMEBOL, SA). */
export function restrictedCompetitionBadge(
  leagueId?: string | number | null,
  leagueName?: string | null
): string | null {
  const region = resolveLeagueRegion(leagueId, leagueName);
  if (!region || !RESTRICTED_BADGE_REGIONS.has(region)) return null;
  return REGION_DISPLAY_LABELS[region];
}

export function isAllowedLeagueId(leagueId: number): boolean {
  return ALLOWED_LEAGUE_IDS.has(leagueId) && !DENIED_LEAGUE_IDS.has(leagueId);
}

/** True when a club from this domestic league may own a TeamProfile row. */
export function isTeamProfileOriginLeagueId(leagueId: number): boolean {
  return TEAM_PROFILE_ORIGIN_LEAGUE_IDS.has(leagueId);
}

export function isDeniedLeagueId(leagueId: number): boolean {
  return DENIED_LEAGUE_IDS.has(leagueId);
}

export function isClubFriendlyLeagueId(leagueId: number): boolean {
  return CLUB_FRIENDLY_LEAGUE_IDS.has(leagueId);
}

export function isUefaCompetitionId(leagueId: number): boolean {
  return UEFA_COMPETITION_IDS.has(leagueId);
}

export function isSaNationalCupId(leagueId: number): boolean {
  return SA_NATIONAL_CUP_IDS.has(leagueId);
}

export function isEuropeNationalCupId(leagueId: number): boolean {
  return EUROPE_NATIONAL_CUP_IDS.has(leagueId);
}

export function isConmebolCompetitionId(leagueId: number): boolean {
  return CONMEBOL_COMPETITION_IDS.has(leagueId);
}

export function saCupOriginLeagueIds(
  cupId: number
): readonly number[] | undefined {
  return SA_NATIONAL_CUP_ORIGINS[cupId];
}

export function europeCupOriginLeagueIds(
  cupId: number
): readonly number[] | undefined {
  return EUROPE_NATIONAL_CUP_ORIGINS[cupId];
}

/** Both clubs must appear on the given domestic roster (UEFA / SA cup gates). */
export function bothTeamsInRoster(
  homeTeamId: number | undefined | null,
  awayTeamId: number | undefined | null,
  roster: ReadonlySet<number>
): boolean {
  if (homeTeamId == null || awayTeamId == null) return false;
  if (roster.size === 0) return false;
  return roster.has(homeTeamId) && roster.has(awayTeamId);
}

export function bothTeamsFromEuropeBig5(
  homeTeamId: number | undefined | null,
  awayTeamId: number | undefined | null,
  big5TeamIds: ReadonlySet<number>
): boolean {
  return bothTeamsInRoster(homeTeamId, awayTeamId, big5TeamIds);
}

function hasNeedle(key: string, needle: string): boolean {
  return key === needle || key.includes(needle);
}

function matchesRule(key: string, rule: NameRule): boolean {
  if (!rule.all.every((part) => hasNeedle(key, part))) return false;
  if (rule.none?.some((part) => hasNeedle(key, part))) return false;
  return true;
}

function isYouthOrWomenLeagueName(key: string): boolean {
  if (/\bu-?\d{2}\b/.test(key)) return true;
  if (/\b(youth|reserve|reserves|academy|femenil|femenin|feminin|women|wsl|ladies)\b/.test(key)) {
    return true;
  }
  return false;
}

function isUnambiguousDeniedName(key: string): boolean {
  if (!key) return true;
  if (isYouthOrWomenLeagueName(key)) return true;
  if (DENIED_NAME_NEEDLES.some((needle) => hasNeedle(key, needle))) return true;
  // Bare "Championship" is ambiguous; EFL / Sky Bet Championship may pass allow rules
  if (/\bchampionship\b/.test(key)) {
    if (key.includes("efl") || key.includes("sky bet")) return false;
    return true;
  }
  return false;
}

/**
 * Short API labels shared by several countries. Only the listed IDs may use them.
 * Example: API-Football names both Chile B and Colombia B as "Primera B".
 */
function nameConflictsWithId(key: string, id: number): boolean {
  if (key.includes("primera b")) {
    return id !== 267;
  }
  // Shared bare "Serie A" → Brazil 71 or Italy 135 (not other countries)
  if (
    key === "serie a" ||
    (key.includes("serie a") &&
      !key.includes("brasileirao") &&
      !key.includes("italia"))
  ) {
    return id !== 71 && id !== 135;
  }
  // Shared "Serie B" → Brazil 72 or Italy 136
  if (key.includes("serie b")) {
    return id !== 72 && id !== 136;
  }
  if (key.includes("championship") && !key.includes("usl")) {
    return id !== 40;
  }
  if (
    key.includes("laliga 2") ||
    key.includes("la liga 2") ||
    key.includes("hypermotion") ||
    (key.includes("segunda") && key.includes("division"))
  ) {
    return id !== 141;
  }
  if (key.includes("primera nacional")) {
    return id !== 129;
  }
  if (
    key.includes("primera division") &&
    !key.includes("chile") &&
    !key.includes("argentina")
  ) {
    return id !== 265 && id !== 128;
  }
  return false;
}

/**
 * Normalized name match against the whitelist (secondary guard).
 * Ambiguous short names like "Primera B" do NOT pass without Chile in the label.
 */
export function isAllowedLeagueName(leagueName: string): boolean {
  const key = normalizeLeagueKey(leagueName);
  if (!key) return false;
  // Ambiguous short label shared by Italy and Brazil
  if (key === "serie b") return false;
  if (isUnambiguousDeniedName(key)) return false;
  if (key.includes("primera b") && !key.includes("chile")) return false;
  if (
    key.includes("primera division") &&
    !key.includes("chile") &&
    !key.includes("argentina")
  ) {
    return false;
  }
  if (ALLOWED_LEAGUE_NAMES.has(key)) return true;
  return ALLOW_NAME_RULES.some((rule) => matchesRule(key, rule));
}

/**
 * Combined gate used by fetch + parlay filters.
 * ID is source of truth when present; name cannot override a denied/unknown ID.
 * Shared short labels (e.g. "Serie B") are resolved via nameConflictsWithId
 * so Brazil 72 can pass while Italy 136 stays denied by ID.
 */
export function isAllowedCompetition(
  leagueId?: string | number | null,
  leagueName?: string | null
): boolean {
  const id = parseLeagueId(leagueId);
  const name = leagueName ?? "";
  const key = normalizeLeagueKey(name);

  if (id != null) {
    if (isDeniedLeagueId(id) || !ALLOWED_LEAGUE_IDS.has(id)) return false;
    if (key && isYouthOrWomenLeagueName(key)) return false;
    if (key && nameConflictsWithId(key, id)) return false;
    return true;
  }

  return isAllowedLeagueName(name);
}
