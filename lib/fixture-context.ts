/**
 * Enrich Match stats from local SQLite fixtures / API response cache.
 * Never issues live API-Football requests.
 */
import { prisma } from "./db";
import type { Match, TeamStats } from "./types";

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

function buildTeamIndex(fixtures: LocalFixtureRow[]): Map<string, TeamHistory> {
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

  // Fixtures are newest-first
  for (const fx of fixtures) {
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

    if (home.homeScored.length < 12) {
      home.homeScored.push(fx.homeGoals);
      home.homeConceded.push(fx.awayGoals);
    }
    if (away.awayScored.length < 12) {
      away.awayScored.push(fx.awayGoals);
      away.awayConceded.push(fx.homeGoals);
    }
    if (home.allScored.length < 12) {
      home.allScored.push(fx.homeGoals);
      home.allConceded.push(fx.awayGoals);
    }
    if (away.allScored.length < 12) {
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

/**
 * Overlay venue splits, recent form and last-match timestamps using only
 * SQLite MatchFixture rows + CachedApiResponse payloads (zero live HTTP).
 */
export async function enrichMatchesFromLocalData(
  matches: Match[]
): Promise<Match[]> {
  if (matches.length === 0) return matches;

  const [dbRows, cacheRows] = await Promise.all([
    loadFinishedFromMatchFixture(),
    loadFinishedFromApiCache(),
  ]);
  const fixtures = dedupeFixtures([...dbRows, ...cacheRows]);
  if (fixtures.length === 0) return matches;

  const index = buildTeamIndex(fixtures);

  return matches.map((match) => ({
    ...match,
    home: enrichTeam(match.home, findHistory(index, match.home.name)),
    away: enrichTeam(match.away, findHistory(index, match.away.name)),
  }));
}
