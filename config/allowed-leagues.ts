/**
 * Strict elite competition whitelist (API-Football league IDs).
 * Only these leagues/cups (plus gated elite club friendlies) enter the model.
 *
 * Name matching is a secondary guard. It must never let a lower division
 * through because its label is a substring of an allowed label
 * (e.g. "Primera B" vs "Primera B Chile").
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
  { id: 267, name: "Primera B Chile", region: "south-america-top5" },

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

/**
 * Known lower-tier / lookalike IDs for countries already in the whitelist.
 * Denied even if someone later adds them to ALLOWED_LEAGUES by mistake.
 * Chile Primera B (267) is intentionally NOT here — it is allowed.
 */
export const DENIED_LEAGUE_IDS: ReadonlySet<number> = new Set([
  // England
  40, // Championship
  41, // League One
  42, // League Two
  43, // National League
  46, // EFL Trophy
  47, // FA Trophy
  // Spain
  141, // Segunda División / LaLiga 2
  142, // Primera División RFEF
  // Germany
  79, // 2. Bundesliga
  80, // 3. Liga
  // Italy
  136, // Serie B
  138, // Serie C
  // France
  62, // Ligue 2
  63, // National
  // Brazil
  72, // Serie B
  75, // Serie C
  76, // Serie D
  // Argentina
  129, // Primera Nacional
  131, // Primera B Nacional (legacy)
  132, // Primera B Metropolitana
  // Colombia — the leak that prompted this list
  241, // Primera B / Torneo BetPlay
  // Ecuador
  243, // Serie B
  // Chile lower than Primera B
  268, // Segunda División
  // Mexico
  264, // Liga de Expansión MX
  // USA
  255, // USL Championship
  257, // USL League One
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
  { all: ["la liga"], none: ["2", "hypermotion", "femenin", "women"] },
  { all: ["laliga"], none: ["2", "hypermotion", "femenin", "women"] },
  { all: ["copa del rey"] },
  { all: ["bundesliga"], none: ["2", "3", "frauen"] },
  { all: ["dfb pokal"] },
  { all: ["serie a"], none: ["serie b", "women", "femenin", "u23"] },
  { all: ["coppa italia"] },
  { all: ["ligue 1"], none: ["2"] },
  { all: ["coupe de france"] },
  { all: ["champions league"], none: ["youth", "u19", "women", "femenin"] },
  { all: ["europa league"], none: ["conference"] },
  { all: ["conference league"] },
  { all: ["libertadores"], none: ["u20", "sub 20", "femenin", "women"] },
  { all: ["sudamericana"], none: ["femenin", "women"] },
  { all: ["brasileirao"], none: ["serie b", "serie c", "serie d"] },
  { all: ["copa do brasil"] },
  { all: ["liga profesional"] },
  { all: ["liga argentina"] },
  { all: ["copa argentina"] },
  { all: ["liga betplay"], none: ["torneo betplay"] },
  { all: ["primera a"], none: ["primera b"] },
  { all: ["copa colombia"] },
  { all: ["copa dimayor"], none: ["torneo"] },
  { all: ["ligapro"] },
  { all: ["liga pro"] },
  { all: ["copa ecuador"] },
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
  { all: ["friendlies clubs"] },
  { all: ["club friendlies"] },
  { all: ["club friendly"] },
];

const DENIED_NAME_NEEDLES: readonly string[] = [
  "torneo betplay",
  "torneo dimayor",
  "primera b colombia",
  "colombia primera b",
  "serie b",
  "serie c",
  "serie d",
  "ligue 2",
  "2 bundesliga",
  "bundesliga 2",
  "3 liga",
  "segunda division",
  "la liga 2",
  "laliga 2",
  "laliga2",
  "hypermotion",
  "primera nacional",
  "primera b metro",
  "liga de expansion",
  "usl championship",
  "usl league",
  "mls next",
  "premier league 2",
  "league one",
  "league two",
  "national league",
  "efl championship",
  "sky bet championship",
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

export function isAllowedLeagueId(leagueId: number): boolean {
  return ALLOWED_LEAGUE_IDS.has(leagueId) && !DENIED_LEAGUE_IDS.has(leagueId);
}

export function isDeniedLeagueId(leagueId: number): boolean {
  return DENIED_LEAGUE_IDS.has(leagueId);
}

export function isClubFriendlyLeagueId(leagueId: number): boolean {
  return CLUB_FRIENDLY_LEAGUE_IDS.has(leagueId);
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
  if (/\bchampionship\b/.test(key)) return true;
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
 * A denied or conflicting name can still reject a supposedly allowed ID
 * (API mis-tagged Colombia B as "Primera B" under another id).
 */
export function isAllowedCompetition(
  leagueId?: string | number | null,
  leagueName?: string | null
): boolean {
  const id = parseLeagueId(leagueId);
  const name = leagueName ?? "";
  const key = normalizeLeagueKey(name);

  if (key && isUnambiguousDeniedName(key)) return false;

  if (id != null) {
    if (isDeniedLeagueId(id) || !ALLOWED_LEAGUE_IDS.has(id)) return false;
    if (key && nameConflictsWithId(key, id)) return false;
    return true;
  }

  return isAllowedLeagueName(name);
}
