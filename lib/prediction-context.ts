/**
 * Unified point-in-time prediction context.
 * Resolves team profiles, form index, and H2H — all strictly before cutoffDate.
 */
import { getTeamProfileAt, type TeamProfileSnapshot } from "./team-profiler";
import {
  buildTeamIndexAtCutoff,
  h2hForMatchAtCutoff,
} from "./fixture-context";
import { prisma } from "./db";
import type { Match } from "./types";

export interface PredictionContext {
  homeProfile: TeamProfileSnapshot | null;
  awayProfile: TeamProfileSnapshot | null;
  /** Form/goals index keyed by normalized team name — strictly before cutoffDate. */
  teamIndex: ReturnType<typeof buildTeamIndexAtCutoff>;
  h2h: Match["h2h"] | null;
}

type ParsedFixture = {
  homeTeam: string;
  awayTeam: string;
  matchDate: Date;
  homeGoals: number;
  awayGoals: number;
};

function parseFixtureRows(
  rawFixtures: Array<{
    homeTeam: string;
    awayTeam: string;
    matchDate: Date;
    finalScore: string | null;
  }>
): ParsedFixture[] {
  return rawFixtures.flatMap((r) => {
    const parts = (r.finalScore ?? "").split(/\s*-\s*/).map((p) => Number(p.trim()));
    if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
      return [];
    }
    return [
      {
        homeTeam: r.homeTeam,
        awayTeam: r.awayTeam,
        matchDate: r.matchDate,
        homeGoals: parts[0]!,
        awayGoals: parts[1]!,
      },
    ];
  });
}

function h2hIsEmpty(h2h: Match["h2h"]): boolean {
  return (
    h2h.homeWins + h2h.draws + h2h.awayWins === 0 || h2h.last4HomeWins == null
  );
}

/**
 * Resolve all prediction inputs for a match in a point-in-time safe manner.
 * All aggregates include only data strictly before `cutoffDate`.
 */
export async function resolvePredictionContext({
  homeId,
  awayId,
  homeName,
  awayName,
  cutoffDate,
}: {
  homeId: number;
  awayId: number;
  /** Used for H2H lookup in local fixtures. */
  homeName: string;
  awayName: string;
  cutoffDate: Date;
}): Promise<PredictionContext> {
  const [homeProfile, awayProfile, rawFixtures] = await Promise.all([
    getTeamProfileAt(homeId, cutoffDate),
    getTeamProfileAt(awayId, cutoffDate),
    prisma.matchFixture.findMany({
      where: { matchDate: { lt: cutoffDate }, finalScore: { not: null } },
      select: { homeTeam: true, awayTeam: true, matchDate: true, finalScore: true },
      orderBy: { matchDate: "asc" },
    }),
  ]);

  const parsedFixtures = parseFixtureRows(rawFixtures);
  const teamIndex = buildTeamIndexAtCutoff(parsedFixtures, cutoffDate);
  const h2h = h2hForMatchAtCutoff(
    parsedFixtures,
    homeName,
    awayName,
    cutoffDate.toISOString()
  );

  return { homeProfile, awayProfile, teamIndex, h2h };
}

/**
 * Batch apply point-in-time H2H (+ prime profiles via getTeamProfileAt cache)
 * with a single fixture query. Call after warmTeamProfilesForMatches.
 */
export async function applyPredictionContexts(
  matches: Match[]
): Promise<Match[]> {
  if (matches.length === 0) return matches;

  let maxKickoff = 0;
  for (const m of matches) {
    const t = Date.parse(m.kickoff);
    if (Number.isFinite(t) && t > maxKickoff) maxKickoff = t;
  }
  if (maxKickoff <= 0) return matches;

  const cutoffMax = new Date(maxKickoff);
  let parsedFixtures: ParsedFixture[] = [];
  try {
    const rawFixtures = await prisma.matchFixture.findMany({
      where: { matchDate: { lt: cutoffMax }, finalScore: { not: null } },
      select: {
        homeTeam: true,
        awayTeam: true,
        matchDate: true,
        finalScore: true,
      },
      orderBy: { matchDate: "asc" },
    });
    parsedFixtures = parseFixtureRows(rawFixtures);
  } catch (err) {
    console.warn("[prediction-context] fixture batch load failed:", err);
    return matches;
  }

  const out: Match[] = [];
  for (const match of matches) {
    const cutoff = new Date(match.kickoff);
    if (!Number.isFinite(cutoff.getTime())) {
      out.push(match);
      continue;
    }

    const homeId = match.home.id;
    const awayId = match.away.id;
    if (homeId != null && Number.isFinite(homeId) && homeId > 0) {
      await getTeamProfileAt(homeId, cutoff);
    }
    if (awayId != null && Number.isFinite(awayId) && awayId > 0) {
      await getTeamProfileAt(awayId, cutoff);
    }

    const h2h = h2hForMatchAtCutoff(
      parsedFixtures,
      match.home.name,
      match.away.name,
      cutoff.toISOString()
    );
    if (h2h && h2hIsEmpty(match.h2h)) {
      out.push({ ...match, h2h });
    } else {
      out.push(match);
    }
  }
  return out;
}
