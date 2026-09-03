/**
 * Referee strictness resolution across all 35 whitelisted competitions.
 * League-specific stats with competition-baseline fallback when n < MIN_SAMPLE.
 */
import {
  isInternationalKnockoutCompetitionId,
  parseLeagueId,
  resolveLeagueRegion,
} from "../config/allowed-leagues";

export { isInternationalKnockoutCompetitionId };

/** Minimum referee fixtures in a league before using league-specific strictness. */
export const MIN_REFEREE_LEAGUE_SAMPLE = 5;

const STRICTNESS_MIN = 0.6;
const STRICTNESS_MAX = 1.6;
const GLOBAL_YELLOW_BASELINE = 3.8;

export type RefereeLeagueCacheEntry = {
  strictnessIndex: number;
  matchCount: number;
  avgYellowCards: number;
};

export type RefereeCacheEntry = {
  globalStrictness: number;
  matchCount: number;
  byLeague: Map<number, RefereeLeagueCacheEntry>;
};

const baselineByLeague = new Map<number, number>();
const refereeCache = new Map<string, RefereeCacheEntry>();

function clampStrictness(v: number): number {
  return Math.max(STRICTNESS_MIN, Math.min(STRICTNESS_MAX, v));
}

function normalizeRefereeName(referee?: string | null): string | null {
  if (!referee?.trim()) return null;
  return referee.split(",")[0].trim() || null;
}

export function strictnessFromYellow(
  avgYellow: number,
  baseline: number
): number {
  if (!(baseline > 0)) return 1;
  return clampStrictness(avgYellow / baseline);
}

/** Register competition yellow-card baseline (from ingest). */
export function setCompetitionBaseline(leagueId: number, avgYellow: number): void {
  if (Number.isFinite(avgYellow) && avgYellow > 0) {
    baselineByLeague.set(leagueId, avgYellow);
  }
}

export function getCompetitionBaseline(leagueId?: number | null): number {
  if (leagueId != null && baselineByLeague.has(leagueId)) {
    return baselineByLeague.get(leagueId)!;
  }
  return GLOBAL_YELLOW_BASELINE;
}

async function getCompetitionBaselineAsync(
  leagueId?: number | null
): Promise<number> {
  const cached = getCompetitionBaseline(leagueId);
  if (leagueId != null && baselineByLeague.has(leagueId)) {
    return cached;
  }
  if (leagueId == null) return GLOBAL_YELLOW_BASELINE;
  try {
    const { prisma } = await import("./db");
    const row = await prisma.competitionCardBaseline.findUnique({
      where: { leagueId },
      select: { avgYellowCards: true },
    });
    if (row) {
      setCompetitionBaseline(leagueId, row.avgYellowCards);
      return row.avgYellowCards;
    }
  } catch {
    /* fallback */
  }
  return GLOBAL_YELLOW_BASELINE;
}

/** Warm in-memory cache from DB rows (call at startup or after ingest). */
export async function warmRefereeCache(): Promise<void> {
  const { prisma } = await import("./db");
  const [profiles, baselines] = await Promise.all([
    prisma.refereeProfile.findMany({
      include: { leagueStats: true },
    }),
    prisma.competitionCardBaseline.findMany(),
  ]);

  refereeCache.clear();
  baselineByLeague.clear();

  for (const b of baselines) {
    setCompetitionBaseline(b.leagueId, b.avgYellowCards);
  }

  for (const p of profiles) {
    const byLeague = new Map<number, RefereeLeagueCacheEntry>();
    for (const ls of p.leagueStats) {
      byLeague.set(ls.leagueId, {
        strictnessIndex: ls.strictnessIndex,
        matchCount: ls.matchCount,
        avgYellowCards: ls.avgYellowCards,
      });
    }
    refereeCache.set(p.name, {
      globalStrictness: p.strictnessIndex,
      matchCount: p.matchCount,
      byLeague,
    });
  }
}

export function resetRefereeCache(): void {
  refereeCache.clear();
  baselineByLeague.clear();
}

/** Sync peek for poisson path; uses warmed cache only. */
export function peekRefereeStrictness(
  referee?: string | null,
  leagueId?: number | null
): number {
  const name = normalizeRefereeName(referee);
  if (!name) return 1;

  const cached = refereeCache.get(name);
  if (!cached) return 1;

  const lid = leagueId ?? undefined;
  if (lid != null) {
    const league = cached.byLeague.get(lid);
    if (league && league.matchCount >= MIN_REFEREE_LEAGUE_SAMPLE) {
      return league.strictnessIndex;
    }
    const baseline = getCompetitionBaseline(lid);
    if (league && league.matchCount > 0) {
      return strictnessFromYellow(league.avgYellowCards, baseline);
    }
  }

  return cached.globalStrictness;
}

/**
 * Async strictness with temporal cutoff — aggregates RefereeMatchRecord before asOf.
 */
export async function resolveRefereeStrictnessAt(
  referee?: string | null,
  leagueId?: number | null,
  asOf?: Date
): Promise<number> {
  const name = normalizeRefereeName(referee);
  if (!name) return 1;

  if (!asOf) {
    return peekRefereeStrictness(name, leagueId);
  }

  try {
    const { prisma } = await import("./db");
    const profile = await prisma.refereeProfile.findUnique({
      where: { name },
      select: { id: true, strictnessIndex: true },
    });
    if (!profile) return 1;

    const lid = parseLeagueId(leagueId);
    const where: {
      refereeId: string;
      matchDate: { lt: Date };
      leagueId?: number;
    } = {
      refereeId: profile.id,
      matchDate: { lt: asOf },
    };
    if (lid != null) where.leagueId = lid;

    const records = await prisma.refereeMatchRecord.findMany({
      where,
      select: {
        yellowCards: true,
        leagueId: true,
      },
    });

    if (records.length === 0) {
      return peekRefereeStrictness(name, leagueId);
    }

    const avgYellow =
      records.reduce((s, r) => s + r.yellowCards, 0) / records.length;
    const baseline = await getCompetitionBaselineAsync(
      lid ?? records[0]?.leagueId
    );
    return strictnessFromYellow(avgYellow, baseline);
  } catch {
    return peekRefereeStrictness(name, leagueId);
  }
}

/** @deprecated Use peekRefereeStrictness — kept for xgboost-runner re-export. */
export function resolveRefereeStrictness(
  referee?: string | null,
  leagueId?: number | null
): number {
  return peekRefereeStrictness(referee, leagueId);
}

/** Async alias; warms cache on first miss. */
export async function resolveRefereeStrictnessAsync(
  referee?: string | null,
  leagueId?: number | null,
  asOf?: Date
): Promise<number> {
  if (refereeCache.size === 0) {
    try {
      await warmRefereeCache();
    } catch {
      /* DB unavailable */
    }
  }
  if (asOf) {
    return resolveRefereeStrictnessAt(referee, leagueId, asOf);
  }
  return peekRefereeStrictness(referee, leagueId);
}

export function refereeRegionForLeague(
  leagueId?: number | null
): string | undefined {
  const region = resolveLeagueRegion(leagueId);
  return region ?? undefined;
}
