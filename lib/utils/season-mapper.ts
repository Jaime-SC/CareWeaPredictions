/**
 * Calendar adapters: European split seasons (Aug–May) vs South American annual (Jan–Dec).
 * API-Football `season` = starting calendar year of the competition.
 */

/** AR / BR / CL domestics + national cups + CONMEBOL (calendar year). */
export const SA_ANNUAL_SEASON_LEAGUE_IDS: ReadonlySet<number> = new Set([
  71, // Brasileirão Serie A
  72, // Brasileirão Serie B
  73, // Copa do Brasil
  128, // Liga Profesional Argentina
  129, // Primera Nacional
  130, // Copa Argentina
  265, // Primera División Chile
  266, // Copa Chile
  267, // Primera B Chile
  11, // Copa Sudamericana
  13, // Copa Libertadores
]);

/** England / Spain / Italy (+ cups) and UEFA — season starts in August. */
export const EUROPE_SPLIT_SEASON_LEAGUE_IDS: ReadonlySet<number> = new Set([
  39, // Premier League
  40, // Championship
  45, // FA Cup
  48, // EFL Cup
  140, // La Liga
  141, // LaLiga 2
  143, // Copa del Rey
  135, // Serie A
  136, // Serie B
  137, // Coppa Italia
  2, // Champions League
  3, // Europa League
  848, // Conference League
]);

/** Min finished matches before trusting current-season Poisson sample alone. */
export const EARLY_SEASON_MIN_MATCHES = 5;

export function isSouthAmericanAnnualLeague(leagueId: number): boolean {
  return SA_ANNUAL_SEASON_LEAGUE_IDS.has(leagueId);
}

export function isEuropeanSplitLeague(leagueId: number): boolean {
  return EUROPE_SPLIT_SEASON_LEAGUE_IDS.has(leagueId);
}

/**
 * Resolve API-Football `season` for a league on a target kickoff/date.
 * - SA annual: calendar year (e.g. 2026).
 * - Europe split: Aug+ → year; Jan–Jul → year − 1 (e.g. May 2027 → 2026).
 * - Unknown: European split (matches historical standings heuristic).
 */
export function getTargetSeason(leagueId: number, targetDate: Date): number {
  const y = targetDate.getFullYear();
  if (isSouthAmericanAnnualLeague(leagueId)) return y;

  const month = targetDate.getMonth(); // 0-based; August = 7
  if (month >= 7) return y;
  return y - 1;
}

/** Prefer current season, then previous (roster / injuries / thin early sample). */
export function seasonFallbackCandidates(
  leagueId: number,
  targetDate: Date
): readonly [number, number] {
  const current = getTargetSeason(leagueId, targetDate);
  return [current, current - 1];
}

/** Weight on current-season stats: matchesPlayed / 5, clamped to [0, 1]. */
export function earlySeasonCurrentWeight(matchesPlayed: number): number {
  if (!(matchesPlayed > 0)) return 0;
  return Math.min(1, matchesPlayed / EARLY_SEASON_MIN_MATCHES);
}

export function blendSeasonStat(
  currentValue: number,
  previousValue: number,
  matchesPlayed: number
): number {
  const w = earlySeasonCurrentWeight(matchesPlayed);
  if (w >= 1) return currentValue;
  if (!(previousValue > 0) && !(currentValue > 0)) return 0;
  if (!(previousValue > 0)) return currentValue;
  if (!(currentValue > 0)) return previousValue;
  return currentValue * w + previousValue * (1 - w);
}
