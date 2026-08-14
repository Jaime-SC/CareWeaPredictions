/**
 * Live context enrichment (injuries / H2H / team venue stats).
 * Quota-aware: prefers SQLite cache, then a tiny live batch under Free plan.
 */
import type { Match, TeamInjury, TeamStats } from "./types";
import { classifyInjuryRole } from "./context-engine";
import {
  CACHE_TTL_MINUTES,
  getCachedPayload,
} from "./api-cache";
import { fixtureIdFromMatchId } from "./odds-mapper";

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
};

/** Max uncached context API calls per enrichment pass (Free plan). */
const CONTEXT_LIVE_BATCH = 4;

type LiveGetter = <T>(
  path: string,
  opts?: { ttlMinutes?: number | null; cacheKey?: string }
) => Promise<ApiEnvelope<T>>;

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
  awayName: string
): Match["h2h"] | null {
  const finished = rows
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

function applyTeamStats(team: TeamStats, stats: TeamStatsRow | undefined, venue: "home" | "away"): TeamStats {
  if (!stats?.goals) return team;
  const scoredAvg =
    venue === "home"
      ? num(stats.goals.for?.average?.home, team.homeGoalsScoredAvg ?? team.goalsScoredAvg)
      : num(stats.goals.for?.average?.away, team.awayGoalsScoredAvg ?? team.goalsScoredAvg);
  const concededAvg =
    venue === "home"
      ? num(stats.goals.against?.average?.home, team.homeGoalsConcededAvg ?? team.goalsConcededAvg)
      : num(stats.goals.against?.average?.away, team.awayGoalsConcededAvg ?? team.goalsConcededAvg);

  if (scoredAvg <= 0 && concededAvg <= 0) return team;

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

async function readCachedH2h(
  homeId: number,
  awayId: number
): Promise<Match["h2h"] | null> {
  const key = `h2h_${Math.min(homeId, awayId)}_${Math.max(homeId, awayId)}_last`;
  const cached = await getCachedPayload<ApiEnvelope<H2hRow[]>>(key);
  if (!cached || hasErrors(cached.errors)) return null;
  return parseH2h(cached.response ?? [], homeId, "", "");
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
    if (h2hEmpty && homeId && awayId) {
      const cacheKey = `h2h_${Math.min(homeId, awayId)}_${Math.max(homeId, awayId)}_last`;
      let h2h = await readCachedH2h(homeId, awayId);
      if (!h2h && liveBudget > 0 && liveGet) {
        try {
          const json = await liveGet<H2hRow[]>(
            `/fixtures/headtohead?h2h=${homeId}-${awayId}&last=4`,
            {
              ttlMinutes: CACHE_TTL_MINUTES.ODDS,
              cacheKey,
            }
          );
          liveBudget -= 1;
          if (!hasErrors(json.errors)) {
            h2h = parseH2h(
              json.response ?? [],
              homeId,
              match.home.name,
              match.away.name
            );
          }
        } catch (err) {
          console.warn("[context-enrichment] H2H fetch failed:", err);
        }
      } else if (h2h) {
        // Re-parse with names if cache used empty names path
        const cached = await getCachedPayload<ApiEnvelope<H2hRow[]>>(cacheKey);
        if (cached?.response) {
          h2h = parseH2h(cached.response, homeId, match.home.name, match.away.name);
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
          if (!hasErrors(json.errors)) rows = json.response ?? [];
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
    const needHomeStats =
      homeId != null &&
      (match.home.homeGoalsScoredAvg == null || match.home.homeGoalsScoredAvg <= 0);
    const needAwayStats =
      awayId != null &&
      (match.away.awayGoalsScoredAvg == null || match.away.awayGoalsScoredAvg <= 0);
    const leagueId = Number(match.leagueId);
    const season = new Date(match.kickoff).getUTCFullYear();

    if (needHomeStats && Number.isFinite(leagueId) && liveBudget > 0 && liveGet) {
      const cacheKey = `team_stats_${homeId}_${leagueId}_${season}`;
      try {
        const cached = await getCachedPayload<ApiEnvelope<TeamStatsRow[]>>(cacheKey);
        let row = cached?.response?.[0];
        if (!row) {
          const json = await liveGet<TeamStatsRow[]>(
            `/teams/statistics?team=${homeId}&league=${leagueId}&season=${season}`,
            { ttlMinutes: CACHE_TTL_MINUTES.ROSTER, cacheKey }
          );
          liveBudget -= 1;
          row = json.response?.[0];
        }
        if (row) {
          next = { ...next, home: applyTeamStats(next.home, row, "home") };
        }
      } catch (err) {
        console.warn("[context-enrichment] home stats failed:", err);
      }
    }

    if (needAwayStats && Number.isFinite(leagueId) && liveBudget > 0 && liveGet) {
      const cacheKey = `team_stats_${awayId}_${leagueId}_${season}`;
      try {
        const cached = await getCachedPayload<ApiEnvelope<TeamStatsRow[]>>(cacheKey);
        let row = cached?.response?.[0];
        if (!row) {
          const json = await liveGet<TeamStatsRow[]>(
            `/teams/statistics?team=${awayId}&league=${leagueId}&season=${season}`,
            { ttlMinutes: CACHE_TTL_MINUTES.ROSTER, cacheKey }
          );
          liveBudget -= 1;
          row = json.response?.[0];
        }
        if (row) {
          next = { ...next, away: applyTeamStats(next.away, row, "away") };
        }
      } catch (err) {
        console.warn("[context-enrichment] away stats failed:", err);
      }
    }

    out.push(next);
  }

  return out;
}
