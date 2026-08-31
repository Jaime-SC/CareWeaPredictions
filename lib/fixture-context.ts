/**
 * Enrich Match stats from local SQLite fixtures / API response cache.
 * Never issues live API-Football requests.
 */
import { prisma } from "./db";
import { warmTeamProfileCache } from "./team-profiler";
import type { Match, TeamInjury, TeamStats } from "./types";
import { classifyInjuryRole } from "./context-engine";
import { isKnockoutFixtureText } from "./knockout-engine";
import { fixtureIdFromMatchId } from "./odds-mapper";

type FormResult = "W" | "D" | "L";

type LocalFixtureRow = {
  homeTeam: string;
  awayTeam: string;
  matchDate: Date;
  homeGoals: number;
  awayGoals: number;
};

type CachedEnvelope = {
  response?: Array<{
    fixture?: {
      date?: string;
      status?: { short?: string };
    };
    teams?: {
      home?: { name?: string };
      away?: { name?: string };
    };
    goals?: {
      home?: number | null;
      away?: number | null;
    };
    score?: {
      fulltime?: {
        home?: number | null;
        away?: number | null;
      };
    };
  }>;
};

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(fc|cf|sc|ac|club|deportivo|de|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesEqual(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function parseScore(finalScore: string | null | undefined): {
  home: number;
  away: number;
} | null {
  if (!finalScore) return null;
  const parts = finalScore.split(/\s*-\s*/).map((p) => Number(p.trim()));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return null;
  }
  return { home: parts[0], away: parts[1] };
}

function isFinishedShort(status?: string | null): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return s === "FT" || s === "AET" || s === "PEN" || s === "ABD" || s === "AWD" || s === "WO";
}

async function loadFinishedFromMatchFixture(): Promise<LocalFixtureRow[]> {
  try {
    const rows = await prisma.matchFixture.findMany({
      where: {
        finalScore: { not: null },
      },
      select: {
        homeTeam: true,
        awayTeam: true,
        matchDate: true,
        finalScore: true,
      },
      orderBy: { matchDate: "desc" },
      take: 2_000,
    });

    const out: LocalFixtureRow[] = [];
    for (const row of rows) {
      const score = parseScore(row.finalScore);
      if (!score) continue;
      out.push({
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        matchDate: row.matchDate,
        homeGoals: score.home,
        awayGoals: score.away,
      });
    }
    return out;
  } catch (err) {
    console.warn("[fixture-context] MatchFixture read failed:", err);
    return [];
  }
}

async function loadFinishedFromApiCache(): Promise<LocalFixtureRow[]> {
  try {
    const rows = await prisma.cachedApiResponse.findMany({
      where: {
        OR: [
          { id: { startsWith: "fixtures_date_" } },
          { endpoint: { contains: "fixtures" } },
        ],
      },
      select: { payload: true },
      take: 120,
    });

    const out: LocalFixtureRow[] = [];
    for (const row of rows) {
      let parsed: CachedEnvelope;
      try {
        parsed = JSON.parse(row.payload) as CachedEnvelope;
      } catch {
        continue;
      }
      for (const item of parsed.response ?? []) {
        const short = item.fixture?.status?.short;
        const homeGoals =
          item.goals?.home ?? item.score?.fulltime?.home ?? null;
        const awayGoals =
          item.goals?.away ?? item.score?.fulltime?.away ?? null;
        if (homeGoals == null || awayGoals == null) continue;
        if (short && !isFinishedShort(short)) continue;
        const dateIso = item.fixture?.date;
        const homeTeam = item.teams?.home?.name;
        const awayTeam = item.teams?.away?.name;
        if (!dateIso || !homeTeam || !awayTeam) continue;
        const matchDate = new Date(dateIso);
        if (!Number.isFinite(matchDate.getTime())) continue;
        out.push({
          homeTeam,
          awayTeam,
          matchDate,
          homeGoals,
          awayGoals,
        });
      }
    }
    return out;
  } catch (err) {
    console.warn("[fixture-context] CachedApiResponse read failed:", err);
    return [];
  }
}

function dedupeFixtures(rows: LocalFixtureRow[]): LocalFixtureRow[] {
  const seen = new Set<string>();
  const out: LocalFixtureRow[] = [];
  for (const row of rows) {
    const key = [
      normalizeName(row.homeTeam),
      normalizeName(row.awayTeam),
      row.matchDate.toISOString().slice(0, 16),
      row.homeGoals,
      row.awayGoals,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => b.matchDate.getTime() - a.matchDate.getTime());
}

type TeamHistory = {
  form: FormResult[];
  lastMatchAt: string | null;
  homeScored: number[];
  homeConceded: number[];
  awayScored: number[];
  awayConceded: number[];
  allScored: number[];
  allConceded: number[];
};

function emptyHistory(): TeamHistory {
  return {
    form: [],
    lastMatchAt: null,
    homeScored: [],
    homeConceded: [],
    awayScored: [],
    awayConceded: [],
    allScored: [],
    allConceded: [],
  };
}

function avg(values: number[], fallback: number): number {
  if (!values.length) return fallback;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function buildTeamIndex(
  fixtures: LocalFixtureRow[],
  asOf?: Date
): Map<string, TeamHistory> {
  const index = new Map<string, TeamHistory>();

  const touch = (name: string): TeamHistory => {
    const key = normalizeName(name);
    let hist = index.get(key);
    if (!hist) {
      hist = emptyHistory();
      index.set(key, hist);
    }
    return hist;
  };

  // Fixtures are newest-first; only matches strictly before asOf contribute.
  for (const fx of fixtures) {
    if (asOf && fx.matchDate.getTime() >= asOf.getTime()) continue;
    const home = touch(fx.homeTeam);
    const away = touch(fx.awayTeam);
    const iso = fx.matchDate.toISOString();

    if (!home.lastMatchAt) home.lastMatchAt = iso;
    if (!away.lastMatchAt) away.lastMatchAt = iso;

    if (home.form.length < 5) {
      home.form.push(
        fx.homeGoals > fx.awayGoals
          ? "W"
          : fx.homeGoals === fx.awayGoals
            ? "D"
            : "L"
      );
    }
    if (away.form.length < 5) {
      away.form.push(
        fx.awayGoals > fx.homeGoals
          ? "W"
          : fx.awayGoals === fx.homeGoals
            ? "D"
            : "L"
      );
    }

    if (home.homeScored.length < 5) {
      home.homeScored.push(fx.homeGoals);
      home.homeConceded.push(fx.awayGoals);
    }
    if (away.awayScored.length < 5) {
      away.awayScored.push(fx.awayGoals);
      away.awayConceded.push(fx.homeGoals);
    }
    if (home.allScored.length < 5) {
      home.allScored.push(fx.homeGoals);
      home.allConceded.push(fx.awayGoals);
    }
    if (away.allScored.length < 5) {
      away.allScored.push(fx.awayGoals);
      away.allConceded.push(fx.homeGoals);
    }
  }

  return index;
}

function findHistory(
  index: Map<string, TeamHistory>,
  teamName: string
): TeamHistory | null {
  const key = normalizeName(teamName);
  const exact = index.get(key);
  if (exact) return exact;
  for (const [k, hist] of index) {
    if (namesEqual(k, key)) return hist;
  }
  return null;
}

function enrichTeam(team: TeamStats, hist: TeamHistory | null): TeamStats {
  if (!hist) return team;

  const goalsScoredAvg = avg(hist.allScored, team.goalsScoredAvg);
  const goalsConcededAvg = avg(hist.allConceded, team.goalsConcededAvg);

  return {
    ...team,
    form: hist.form.length ? hist.form : team.form,
    goalsScoredAvg: Number(goalsScoredAvg.toFixed(3)),
    goalsConcededAvg: Number(goalsConcededAvg.toFixed(3)),
    homeGoalsScoredAvg: Number(
      avg(hist.homeScored, goalsScoredAvg).toFixed(3)
    ),
    homeGoalsConcededAvg: Number(
      avg(hist.homeConceded, goalsConcededAvg).toFixed(3)
    ),
    awayGoalsScoredAvg: Number(
      avg(hist.awayScored, goalsScoredAvg).toFixed(3)
    ),
    awayGoalsConcededAvg: Number(
      avg(hist.awayConceded, goalsConcededAvg).toFixed(3)
    ),
    lastMatchAt: hist.lastMatchAt ?? team.lastMatchAt ?? null,
  };
}

function h2hForMatch(
  fixtures: LocalFixtureRow[],
  homeName: string,
  awayName: string,
  kickoffIso: string
): Match["h2h"] | null {
  const kickoff = Date.parse(kickoffIso);
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let goalSum = 0;
  let n = 0;
  let last4HomeWins = 0;
  let last4AwayWins = 0;
  let last4Draws = 0;
  let last4N = 0;

  for (const fx of fixtures) {
    if (Number.isFinite(kickoff) && fx.matchDate.getTime() >= kickoff) continue;
    const sameVenue =
      namesEqual(fx.homeTeam, homeName) && namesEqual(fx.awayTeam, awayName);
    const reversed =
      namesEqual(fx.homeTeam, awayName) && namesEqual(fx.awayTeam, homeName);
    if (!sameVenue && !reversed) continue;

    n += 1;
    goalSum += fx.homeGoals + fx.awayGoals;

    let homeWon = false;
    let awayWon = false;
    let draw = false;
    if (sameVenue) {
      if (fx.homeGoals > fx.awayGoals) homeWon = true;
      else if (fx.homeGoals === fx.awayGoals) draw = true;
      else awayWon = true;
    } else if (fx.awayGoals > fx.homeGoals) {
      homeWon = true;
    } else if (fx.homeGoals === fx.awayGoals) {
      draw = true;
    } else {
      awayWon = true;
    }

    if (homeWon) homeWins += 1;
    else if (awayWon) awayWins += 1;
    else draws += 1;

    if (last4N < 4) {
      last4N += 1;
      if (homeWon) last4HomeWins += 1;
      else if (awayWon) last4AwayWins += 1;
      else last4Draws += 1;
    }
  }

  if (n === 0) return null;
  return {
    homeWins,
    draws,
    awayWins,
    avgGoals: Number((goalSum / n).toFixed(3)),
    last4HomeWins,
    last4AwayWins,
    last4Draws,
  };
}

/** Two-legged ties are typically 7–21 days apart; 28d covers continental gaps. */
const FIRST_LEG_MAX_DAYS = 28;

/**
 * Most recent finished meeting between the same two clubs before kickoff,
 * mapped onto the current home/away sides.
 */
function firstLegScoreFor(
  fixtures: LocalFixtureRow[],
  homeName: string,
  awayName: string,
  kickoffIso: string
): { currentHome: number; currentAway: number } | null {
  const kickoff = Date.parse(kickoffIso);
  if (!Number.isFinite(kickoff)) return null;
  const minTs = kickoff - FIRST_LEG_MAX_DAYS * 24 * 60 * 60 * 1000;

  let best: LocalFixtureRow | null = null;
  let bestReversed = false;

  for (const fx of fixtures) {
    const ts = fx.matchDate.getTime();
    if (!Number.isFinite(ts) || ts >= kickoff || ts < minTs) continue;
    const sameVenue =
      namesEqual(fx.homeTeam, homeName) && namesEqual(fx.awayTeam, awayName);
    const reversed =
      namesEqual(fx.homeTeam, awayName) && namesEqual(fx.awayTeam, homeName);
    if (!sameVenue && !reversed) continue;
    if (!best || ts > best.matchDate.getTime()) {
      best = fx;
      bestReversed = reversed;
    }
  }

  if (!best) return null;
  if (bestReversed) {
    return { currentHome: best.awayGoals, currentAway: best.homeGoals };
  }
  return { currentHome: best.homeGoals, currentAway: best.awayGoals };
}

type CachedInjuryEnvelope = {
  response?: Array<{
    player?: {
      name?: string;
      type?: string;
      reason?: string;
      position?: string;
    };
    team?: { name?: string };
    fixture?: { id?: number };
  }>;
};

type InjuryIndex = {
  byTeam: Map<string, TeamInjury[]>;
  byFixtureTeam: Map<string, TeamInjury[]>;
};

function injuryKey(fixtureId: number, teamName: string): string {
  return `${fixtureId}|${normalizeName(teamName)}`;
}

function toTeamInjury(raw: {
  name?: string;
  type?: string;
  reason?: string;
  position?: string;
}): TeamInjury | null {
  const player = raw.name?.trim();
  if (!player) return null;
  const role = classifyInjuryRole(
    [raw.position, raw.type, raw.reason].filter(Boolean).join(" ")
  );
  const reason = (raw.reason ?? raw.type ?? "").toLowerCase();
  const doubtful = /doubt|questionable|probable|duda/.test(reason);
  return {
    player,
    role,
    reason: raw.reason ?? raw.type,
    status: doubtful ? "doubtful" : "out",
  };
}

async function loadInjuriesFromApiCache(): Promise<InjuryIndex> {
  const byTeam = new Map<string, TeamInjury[]>();
  const byFixtureTeam = new Map<string, TeamInjury[]>();

  try {
    const rows = await prisma.cachedApiResponse.findMany({
      where: {
        OR: [
          { id: { startsWith: "injuries" } },
          { endpoint: { contains: "injuries" } },
        ],
      },
      select: { payload: true },
      take: 80,
    });

    for (const row of rows) {
      let parsed: CachedInjuryEnvelope;
      try {
        parsed = JSON.parse(row.payload) as CachedInjuryEnvelope;
      } catch {
        continue;
      }
      for (const item of parsed.response ?? []) {
        const teamName = item.team?.name;
        if (!teamName) continue;
        const injury = toTeamInjury(item.player ?? {});
        if (!injury) continue;

        const teamKey = normalizeName(teamName);
        const list = byTeam.get(teamKey) ?? [];
        if (!list.some((x) => x.player === injury.player)) list.push(injury);
        byTeam.set(teamKey, list);

        const fixtureId = item.fixture?.id;
        if (fixtureId && Number.isFinite(fixtureId)) {
          const fk = injuryKey(fixtureId, teamName);
          const fxList = byFixtureTeam.get(fk) ?? [];
          if (!fxList.some((x) => x.player === injury.player)) fxList.push(injury);
          byFixtureTeam.set(fk, fxList);
        }
      }
    }
  } catch (err) {
    console.warn("[fixture-context] injury cache read failed:", err);
  }

  return { byTeam, byFixtureTeam };
}

function attachInjuries(
  team: TeamStats,
  match: Match,
  index: InjuryIndex
): TeamStats {
  if (team.injuries && team.injuries.length > 0) return team;

  const fixtureId = fixtureIdFromMatchId(match.id);
  if (fixtureId != null) {
    const keyed = index.byFixtureTeam.get(injuryKey(fixtureId, team.name));
    if (keyed?.length) return { ...team, injuries: keyed };
  }

  const key = normalizeName(team.name);
  let found = index.byTeam.get(key);
  if (!found) {
    for (const [k, list] of index.byTeam) {
      if (namesEqual(k, key)) {
        found = list;
        break;
      }
    }
  }
  if (!found?.length) return team;
  return { ...team, injuries: found };
}

/**
 * Overlay venue splits, recent form, H2H, injuries and last-match timestamps
 * using only SQLite MatchFixture rows + CachedApiResponse payloads (zero live HTTP).
 */
export async function enrichMatchesFromLocalData(
  matches: Match[]
): Promise<Match[]> {
  if (matches.length === 0) return matches;

  const [dbRows, cacheRows, injuryIndex] = await Promise.all([
    loadFinishedFromMatchFixture(),
    loadFinishedFromApiCache(),
    loadInjuriesFromApiCache(),
    warmTeamProfileCache(matches.flatMap((m) => [m.home.id, m.away.id])),
  ]);
  const fixtures = dedupeFixtures([...dbRows, ...cacheRows]);
  if (fixtures.length === 0 && injuryIndex.byTeam.size === 0) return matches;

  return matches.map((match) => {
    const asOf = new Date(match.kickoff);
    const index = Number.isFinite(asOf.getTime())
      ? buildTeamIndex(fixtures, asOf)
      : buildTeamIndex(fixtures);
    const h2h = h2hForMatch(
      fixtures,
      match.home.name,
      match.away.name,
      match.kickoff
    );
    const home = attachInjuries(
      enrichTeam(match.home, findHistory(index, match.home.name)),
      match,
      injuryIndex
    );
    const away = attachInjuries(
      enrichTeam(match.away, findHistory(index, match.away.name)),
      match,
      injuryIndex
    );
    return {
      ...match,
      home,
      away,
      h2h: h2h ?? match.h2h,
      firstLegScore:
        match.firstLegScore ??
        (isKnockoutFixtureText(match)
          ? firstLegScoreFor(
              fixtures,
              match.home.name,
              match.away.name,
              match.kickoff
            )
          : null),
    };
  });
}

/** ponytail: test-only export for leakage scripts — remove if fixture-context gets a dedicated test harness. */
export type LocalFixtureRowForTest = LocalFixtureRow;
export function buildTeamIndexAtCutoff(
  fixtures: LocalFixtureRow[],
  asOf: Date
): Map<string, TeamHistory> {
  return buildTeamIndex(fixtures, asOf);
}

export function teamFormAtCutoff(
  fixtures: LocalFixtureRow[],
  teamName: string,
  asOf: Date
): FormResult[] {
  const hist = findHistory(buildTeamIndex(fixtures, asOf), teamName);
  return hist?.form ?? [];
}
