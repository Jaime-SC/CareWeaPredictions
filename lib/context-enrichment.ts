/**
 * Live context enrichment (injuries / H2H / team venue stats).
 * Quota-aware: prefers cache, then a live batch sized for paid API plans.
 */
import type { Match, TeamInjury, TeamStats } from "./types";
import {
  classifyInjuryRole,
  needsPreviousSeasonBlend,
} from "./context-engine";
import {
  CACHE_TTL_MINUTES,
  getCachedPayload,
} from "./api-cache";
import { fixtureIdFromMatchId } from "./odds-mapper";
import {
  CORNER_HOME_SHARE,
  CORNER_PRIOR_TOTAL,
} from "./phase2-markets";
import {
  blendSeasonStat,
  getTargetSeason,
  seasonFallbackCandidates,
} from "./utils/season-mapper";

/** Max live /fixtures/statistics pulls for corner avgs per enrichment pass. */
const CORNER_STAT_LIVE_CAP = 8;
const CORNER_LOOKBACK = 5;

type FixtureListRow = {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  teams?: {
    home?: { id?: number };
    away?: { id?: number };
  };
};

type FixtureStatRow = {
  team?: { id?: number };
  statistics?: Array<{ type?: string; value?: number | string | null }>;
};

type ApiEnvelope<T> = {
  response?: T;
  errors?: Record<string, string> | string[];
};

type H2hRow = {
  fixture?: { date?: string; status?: { short?: string } };
  teams?: {
    home?: { id?: number; name?: string };
    away?: { id?: number; name?: string };
  };
  goals?: { home?: number | null; away?: number | null };
};

type InjuryRow = {
  player?: {
    id?: number;
    name?: string;
    type?: string;
    reason?: string;
    photo?: string;
  };
  team?: { id?: number; name?: string };
  fixture?: { id?: number; date?: string };
};

type TeamStatsRow = {
  team?: { id?: number };
  league?: { id?: number; season?: number };
  fixtures?: {
    played?: { home?: number; away?: number; total?: number };
  };
  goals?: {
    for?: {
      average?: { home?: string | number; away?: string | number; total?: string | number };
      total?: { home?: number; away?: number };
    };
    against?: {
      average?: { home?: string | number; away?: string | number; total?: string | number };
      total?: { home?: number; away?: number };
    };
  };
  cards?: {
    yellow?: Record<string, { total?: number | string } | number | string | null>;
  };
};

/** Max uncached context API calls per enrichment pass (paid plan). */
const CONTEXT_LIVE_BATCH = 24;

type LiveGetter = <T>(
  path: string,
  opts?: { ttlMinutes?: number | null; cacheKey?: string }
) => Promise<ApiEnvelope<T> | null>;

function hasErrors(errors: ApiEnvelope<unknown>["errors"]): boolean {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors).length > 0;
}

function num(value: string | number | null | undefined, fallback = 0): number {
  if (value == null) return fallback;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : fallback;
}

function finishedShort(short?: string): boolean {
  if (!short) return true;
  const s = short.toUpperCase();
  return s === "FT" || s === "AET" || s === "PEN";
}

function parseH2h(
  rows: H2hRow[],
  homeId: number | undefined,
  homeName: string,
  awayName: string,
  asOf?: Date
): Match["h2h"] | null {
  const asOfMs = asOf?.getTime();
  const finished = rows
    .filter((r) => {
      if (asOfMs == null) return true;
      const t = Date.parse(r.fixture?.date ?? "");
      return Number.isFinite(t) && t < asOfMs;
    })
    .filter((r) => finishedShort(r.fixture?.status?.short))
    .filter((r) => r.goals?.home != null && r.goals?.away != null)
    .sort(
      (a, b) =>
        Date.parse(b.fixture?.date ?? "") - Date.parse(a.fixture?.date ?? "")
    )
    .slice(0, 4);

  if (finished.length === 0) return null;

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let goalSum = 0;

  for (const row of finished) {
    const gh = row.goals!.home!;
    const ga = row.goals!.away!;
    goalSum += gh + ga;
    const rowHomeId = row.teams?.home?.id;
    const rowHomeName = row.teams?.home?.name ?? "";
    const listedIsHome =
      (homeId != null && rowHomeId === homeId) ||
      rowHomeName.toLowerCase() === homeName.toLowerCase();

    const listedGoals = listedIsHome ? gh : ga;
    const otherGoals = listedIsHome ? ga : gh;
    if (listedGoals > otherGoals) homeWins += 1;
    else if (listedGoals < otherGoals) awayWins += 1;
    else draws += 1;
  }

  return {
    homeWins,
    draws,
    awayWins,
    avgGoals: Number((goalSum / finished.length).toFixed(3)),
    last4HomeWins: homeWins,
    last4AwayWins: awayWins,
    last4Draws: draws,
  };
}

function parseInjuries(
  rows: InjuryRow[],
  teamId: number | undefined,
  teamName: string
): TeamInjury[] {
  const out: TeamInjury[] = [];
  for (const row of rows) {
    if (teamId != null && row.team?.id != null && row.team.id !== teamId) continue;
    if (
      teamId == null &&
      row.team?.name &&
      row.team.name.toLowerCase() !== teamName.toLowerCase()
    ) {
      continue;
    }
    const player = row.player?.name?.trim();
    if (!player) continue;
    const role = classifyInjuryRole(
      [row.player?.type, row.player?.reason].filter(Boolean).join(" ")
    );
    const reason = (row.player?.reason ?? row.player?.type ?? "").toLowerCase();
    const doubtful = /doubt|questionable|probable|duda/.test(reason);
    out.push({
      player,
      role,
      reason: row.player?.reason ?? row.player?.type,
      status: doubtful ? "doubtful" : "out",
      keyAbsence: role === "striker" || role === "goalkeeper",
    });
  }
  return out;
}

function playedTotal(stats: TeamStatsRow | undefined): number {
  if (!stats?.fixtures?.played) return 0;
  const total = stats.fixtures.played.total;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  return (
    (stats.fixtures.played.home ?? 0) + (stats.fixtures.played.away ?? 0)
  );
}

function venueAvgs(
  stats: TeamStatsRow | undefined,
  venue: "home" | "away"
): { scored: number; conceded: number } {
  if (!stats?.goals) return { scored: 0, conceded: 0 };
  return {
    scored:
      venue === "home"
        ? num(stats.goals.for?.average?.home)
        : num(stats.goals.for?.average?.away),
    conceded:
      venue === "home"
        ? num(stats.goals.against?.average?.home)
        : num(stats.goals.against?.average?.away),
  };
}

function yellowCardsTotal(stats: TeamStatsRow | undefined): number {
  const yellow = stats?.cards?.yellow;
  if (!yellow || typeof yellow !== "object") return 0;
  let sum = 0;
  for (const v of Object.values(yellow)) {
    if (v == null) continue;
    if (typeof v === "object" && "total" in v) sum += num(v.total);
    else sum += num(v as string | number);
  }
  return sum;
}

function yellowCardsAvg(stats: TeamStatsRow | undefined): number {
  const played = playedTotal(stats);
  if (played <= 0) return 0;
  const total = yellowCardsTotal(stats);
  return total > 0 ? total / played : 0;
}

function applyTeamStats(
  team: TeamStats,
  stats: TeamStatsRow | undefined,
  venue: "home" | "away",
  previousStats?: TeamStatsRow | null
): TeamStats {
  const cur = venueAvgs(stats, venue);
  const played = playedTotal(stats);
  let scoredAvg = cur.scored;
  let concededAvg = cur.conceded;

  if (previousStats && needsPreviousSeasonBlend(played)) {
    const prev = venueAvgs(previousStats, venue);
    scoredAvg = blendSeasonStat(cur.scored, prev.scored, played);
    concededAvg = blendSeasonStat(cur.conceded, prev.conceded, played);
  }

  let yellowAvg = yellowCardsAvg(stats);
  if (previousStats && needsPreviousSeasonBlend(played) && yellowAvg <= 0) {
    yellowAvg = yellowCardsAvg(previousStats);
  }

  if (scoredAvg <= 0 && concededAvg <= 0 && yellowAvg <= 0) return team;

  return {
    ...team,
    goalsScoredAvg:
      team.goalsScoredAvg > 0.15
        ? team.goalsScoredAvg
        : Number(scoredAvg.toFixed(3)),
    goalsConcededAvg:
      team.goalsConcededAvg > 0.15
        ? team.goalsConcededAvg
        : Number(concededAvg.toFixed(3)),
    ...(yellowAvg > 0
      ? {
          yellowCardsAvg: Number(yellowAvg.toFixed(3)),
          ...(venue === "home"
            ? { homeYellowCardsAvg: Number(yellowAvg.toFixed(3)) }
            : { awayYellowCardsAvg: Number(yellowAvg.toFixed(3)) }),
        }
      : {}),
    ...(venue === "home"
      ? {
          homeGoalsScoredAvg: Number(scoredAvg.toFixed(3)),
          homeGoalsConcededAvg: Number(concededAvg.toFixed(3)),
        }
      : {
          awayGoalsScoredAvg: Number(scoredAvg.toFixed(3)),
          awayGoalsConcededAvg: Number(concededAvg.toFixed(3)),
        }),
  };
}

async function loadTeamStatsRow(
  teamId: number,
  leagueId: number,
  season: number,
  liveGet: LiveGetter | undefined,
  liveBudget: { left: number }
): Promise<TeamStatsRow | null> {
  const cacheKey = `team_stats_${teamId}_${leagueId}_${season}`;
  try {
    const cached = await getCachedPayload<ApiEnvelope<TeamStatsRow[]>>(cacheKey);
    const hit = cached?.response?.[0];
    if (hit) return hit;
    if (!liveGet || liveBudget.left <= 0) return null;
    const json = await liveGet<TeamStatsRow[]>(
      `/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`,
      { ttlMinutes: CACHE_TTL_MINUTES.ROSTER, cacheKey }
    );
    liveBudget.left -= 1;
    if (!json || hasErrors(json.errors)) return null;
    return json.response?.[0] ?? null;
  } catch (err) {
    console.warn(
      `[context-enrichment] team stats failed team=${teamId} season=${season}:`,
      err
    );
    return null;
  }
}

function cornerKicksFromStats(rows: FixtureStatRow[], teamId: number): number | null {
  const row = rows.find((r) => r.team?.id === teamId);
  if (!row?.statistics) return null;
  const hit = row.statistics.find((s) =>
    String(s.type ?? "")
      .toLowerCase()
      .includes("corner")
  );
  if (!hit || hit.value == null) return null;
  const n = num(hit.value);
  return n >= 0 ? n : null;
}

/**
 * // ponytail: no team-stat corners field; upgrade when API adds it.
 * Avg corners for from last FT fixtures (+ /fixtures/statistics), budget-capped.
 */
async function enrichTeamCornerAvgs(
  team: TeamStats,
  teamId: number,
  venue: "home" | "away",
  liveGet: LiveGetter | undefined,
  liveBudget: { left: number },
  cornerStatBudget: { left: number },
  asOf?: Date
): Promise<TeamStats> {
  if (
    (venue === "home" && team.homeCornersForAvg != null && team.homeCornersForAvg > 0) ||
    (venue === "away" && team.awayCornersForAvg != null && team.awayCornersForAvg > 0)
  ) {
    return team;
  }

  const asOfMs = asOf?.getTime();
  const listKey = `fixtures_team_${teamId}_last_${CORNER_LOOKBACK}`;
  let fixtures: FixtureListRow[] = [];
  try {
    const cached = await getCachedPayload<ApiEnvelope<FixtureListRow[]>>(listKey);
    if (cached?.response?.length) {
      fixtures = cached.response;
    } else if (liveGet && liveBudget.left > 0) {
      const json = await liveGet<FixtureListRow[]>(
        `/fixtures?team=${teamId}&last=${CORNER_LOOKBACK}&status=FT-AET-PEN`,
        { ttlMinutes: CACHE_TTL_MINUTES.ROSTER, cacheKey: listKey }
      );
      liveBudget.left -= 1;
      if (json && !hasErrors(json.errors)) fixtures = json.response ?? [];
    }
  } catch (err) {
    console.warn(`[context-enrichment] corner fixtures team=${teamId}:`, err);
  }

  if (asOfMs != null && Number.isFinite(asOfMs)) {
    fixtures = fixtures.filter((fx) => {
      const t = Date.parse(fx.fixture?.date ?? "");
      return Number.isFinite(t) && t < asOfMs;
    });
  }

  const samples: number[] = [];
  for (const fx of fixtures) {
    const fid = fx.fixture?.id;
    if (!fid) continue;
    const isHome = fx.teams?.home?.id === teamId;
    if (venue === "home" && !isHome) continue;
    if (venue === "away" && isHome) continue;

    const statKey = `fixture_statistics_${fid}`;
    let rows: FixtureStatRow[] | undefined;
    try {
      const cached = await getCachedPayload<ApiEnvelope<FixtureStatRow[]>>(statKey);
      if (cached?.response?.length) {
        rows = cached.response;
      } else if (
        liveGet &&
        liveBudget.left > 0 &&
        cornerStatBudget.left > 0
      ) {
        const json = await liveGet<FixtureStatRow[]>(
          `/fixtures/statistics?fixture=${fid}`,
          { ttlMinutes: null, cacheKey: statKey }
        );
        liveBudget.left -= 1;
        cornerStatBudget.left -= 1;
        if (json && !hasErrors(json.errors)) rows = json.response ?? [];
      }
    } catch {
      /* skip */
    }
    if (!rows?.length) continue;
    const c = cornerKicksFromStats(rows, teamId);
    if (c != null) samples.push(c);
    if (samples.length >= 3) break;
  }

  const prior =
    CORNER_PRIOR_TOTAL *
    (venue === "home" ? CORNER_HOME_SHARE : 1 - CORNER_HOME_SHARE);
  const avg =
    samples.length > 0
      ? samples.reduce((a, b) => a + b, 0) / samples.length
      : prior;

  return {
    ...team,
    cornersForAvg: Number(avg.toFixed(3)),
    ...(venue === "home"
      ? { homeCornersForAvg: Number(avg.toFixed(3)) }
      : { awayCornersForAvg: Number(avg.toFixed(3)) }),
  };
}

async function readCachedH2h(
  homeId: number,
  awayId: number,
  asOf?: Date
): Promise<Match["h2h"] | null> {
  const key = `h2h_${Math.min(homeId, awayId)}_${Math.max(homeId, awayId)}_last`;
  const cached = await getCachedPayload<ApiEnvelope<H2hRow[]>>(key);
  if (!cached || hasErrors(cached.errors)) return null;
  return parseH2h(cached.response ?? [], homeId, "", "", asOf);
}

/**
 * Enrich matches with injuries / H2H / venue stats.
 * `liveGet` should be the rate-limited apiGet wrapper from api-football.
 * When omitted, only SQLite cache is consulted (zero live calls).
 */
export async function enrichMatchContextFeatures(
  matches: Match[],
  liveGet?: LiveGetter
): Promise<Match[]> {
  if (matches.length === 0) return matches;

  let liveBudget = liveGet ? CONTEXT_LIVE_BATCH : 0;
  const cornerBudget = { left: CORNER_STAT_LIVE_CAP };
  const out: Match[] = [];

  for (const match of matches) {
    let next: Match = { ...match };
    const homeId = match.home.id;
    const awayId = match.away.id;
    const fixtureId = fixtureIdFromMatchId(match.id);
    const h2hEmpty =
      match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins === 0 ||
      match.h2h.last4HomeWins == null;

    // --- H2H ---
    const kickoffMs = Date.parse(match.kickoff);
    const asOf =
      Number.isFinite(kickoffMs) ? new Date(kickoffMs) : undefined;
    if (h2hEmpty && homeId && awayId) {
      const cacheKey = `h2h_${Math.min(homeId, awayId)}_${Math.max(homeId, awayId)}_last`;
      let h2h = await readCachedH2h(homeId, awayId, asOf);
      if (!h2h && liveBudget > 0 && liveGet) {
        try {
          // Paid plan: `last` is allowed; parseH2h still slices locally
          const json = await liveGet<H2hRow[]>(
            `/fixtures/headtohead?h2h=${homeId}-${awayId}&last=10`,
            {
              ttlMinutes: CACHE_TTL_MINUTES.ODDS,
              cacheKey,
            }
          );
          liveBudget -= 1;
          if (json && !hasErrors(json.errors)) {
            h2h = parseH2h(
              json.response ?? [],
              homeId,
              match.home.name,
              match.away.name,
              asOf
            );
          }
        } catch (err) {
          console.warn("[context-enrichment] H2H fetch failed:", err);
        }
      } else if (h2h) {
        // Re-parse with names if cache used empty names path
        const cached = await getCachedPayload<ApiEnvelope<H2hRow[]>>(cacheKey);
        if (cached?.response) {
          h2h = parseH2h(
            cached.response,
            homeId,
            match.home.name,
            match.away.name,
            asOf
          );
        }
      }
      if (h2h) next = { ...next, h2h };
    }

    // --- Injuries ---
    const needInjuries =
      !(match.home.injuries && match.home.injuries.length) &&
      !(match.away.injuries && match.away.injuries.length);
    if (needInjuries && fixtureId != null) {
      const cacheKey = `injuries_fixture_${fixtureId}`;
      const cached = await getCachedPayload<ApiEnvelope<InjuryRow[]>>(cacheKey);
      let rows = !hasErrors(cached?.errors) ? cached?.response : undefined;
      if (!rows && liveBudget > 0 && liveGet) {
        try {
          const json = await liveGet<InjuryRow[]>(
            `/injuries?fixture=${fixtureId}`,
            { ttlMinutes: CACHE_TTL_MINUTES.ODDS, cacheKey }
          );
          liveBudget -= 1;
          if (json && !hasErrors(json.errors)) rows = json.response ?? [];
        } catch (err) {
          console.warn("[context-enrichment] injuries fetch failed:", err);
        }
      }
      if (rows?.length) {
        next = {
          ...next,
          home: {
            ...next.home,
            injuries: parseInjuries(rows, homeId, match.home.name),
          },
          away: {
            ...next.away,
            injuries: parseInjuries(rows, awayId, match.away.name),
          },
        };
      }
    }

    // --- Team statistics (home/away averages) ---
    // Live YTD API is only safe for upcoming kickoffs; past asOf would leak.
    const allowLiveYtd =
      Number.isFinite(kickoffMs) && kickoffMs > Date.now();
    const needHomeStats =
      allowLiveYtd &&
      homeId != null &&
      (match.home.homeGoalsScoredAvg == null || match.home.homeGoalsScoredAvg <= 0);
    const needAwayStats =
      allowLiveYtd &&
      awayId != null &&
      (match.away.awayGoalsScoredAvg == null || match.away.awayGoalsScoredAvg <= 0);
    const leagueId = Number(match.leagueId);
    const kickoffDate = Number.isFinite(kickoffMs)
      ? new Date(kickoffMs)
      : new Date(NaN);
    const season =
      Number.isFinite(leagueId) && Number.isFinite(kickoffDate.getTime())
        ? getTargetSeason(leagueId, kickoffDate)
        : kickoffDate.getFullYear();
    const [, prevSeason] = Number.isFinite(leagueId)
      ? seasonFallbackCandidates(leagueId, kickoffDate)
      : ([season, season - 1] as const);
    const budget = { left: liveBudget };

    if (needHomeStats && Number.isFinite(leagueId) && homeId != null) {
      const current = await loadTeamStatsRow(
        homeId,
        leagueId,
        season,
        liveGet,
        budget
      );
      const previous =
        current && needsPreviousSeasonBlend(playedTotal(current))
          ? await loadTeamStatsRow(homeId, leagueId, prevSeason, liveGet, budget)
          : null;
      if (current) {
        next = {
          ...next,
          home: applyTeamStats(next.home, current, "home", previous),
        };
      }
    }

    if (needAwayStats && Number.isFinite(leagueId) && awayId != null) {
      const current = await loadTeamStatsRow(
        awayId,
        leagueId,
        season,
        liveGet,
        budget
      );
      const previous =
        current && needsPreviousSeasonBlend(playedTotal(current))
          ? await loadTeamStatsRow(awayId, leagueId, prevSeason, liveGet, budget)
          : null;
      if (current) {
        next = {
          ...next,
          away: applyTeamStats(next.away, current, "away", previous),
        };
      }
    }

    // --- Corner averages (fixture statistics, budget-capped) ---
    if (homeId != null) {
      next = {
        ...next,
        home: await enrichTeamCornerAvgs(
          next.home,
          homeId,
          "home",
          liveGet,
          budget,
          cornerBudget,
          asOf
        ),
      };
    }
    if (awayId != null) {
      next = {
        ...next,
        away: await enrichTeamCornerAvgs(
          next.away,
          awayId,
          "away",
          liveGet,
          budget,
          cornerBudget,
          asOf
        ),
      };
    }

    liveBudget = budget.left;

    out.push(next);
  }

  return out;
}
