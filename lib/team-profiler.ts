/**
 * Team profiles from finished MatchFixture history + soft Poisson calibration.
 * Neon HTTP: find + create/update (no Prisma.upsert).
 *
 * Rolling window: last ROLLING_WINDOW settled appearances per team, with
 * exponential recency decay. Calibration gates use venue-specific N ≥ 4.
 */
import { prisma } from "./db";
import { isFixtureFinished } from "./match-status";
import {
  isTeamProfileOriginLeagueId,
  parseLeagueId,
} from "../config/allowed-leagues";
import {
  getLeagueCountry,
  getLeagueDisplayName,
} from "./utils/league-labels";
import {
  needsDomesticLeagueRemap,
  resolveDomesticLeagueByTeamId,
} from "./team-league-resolve";
import {
  MANAGER_CHANGE_COOLDOWN_DAYS,
  countKeyAbsencesFromLists,
  isRecentManagerStart,
  type TeamProfileSnapshot,
} from "./team-profile-shared";
import type { MarketType } from "./types";

export type { TeamProfileSnapshot } from "./team-profile-shared";
export {
  countKeyAbsencesFromLists,
  isRecentManagerStart,
  MANAGER_CHANGE_COOLDOWN_DAYS,
} from "./team-profile-shared";

const ROLLING_WINDOW = 10;
/** weight_i = RECENCY_DECAY^i (i=0 most recent). */
const RECENCY_DECAY = 0.85;
/** Venue-specific sample gate for calibration. */
const MIN_VENUE_SAMPLE = 4;
const OVER15_RATE_GATE = 0.8;
const CLEAN_SHEET_GATE = 0.6;
/** Soft relative bump before clamping. */
const RELATIVE_BOOST = 1.05;
/** Absolute ceiling after any historical boost. */
const PROB_CEILING = 0.92;
/** Max additive lift = base × MAX_RELATIVE_BOOST_FRAC. */
const MAX_RELATIVE_BOOST_FRAC = 0.08;
const MANAGER_CHANGE_MIN_MATCHES = 3;
/** λ multiplier when keyAbsencesCount ≥ 1 (attacking line). */
const KEY_ABSENCE_LAMBDA = 0.85;

type TeamEvent = {
  at: number;
  venue: "home" | "away";
  scored: number;
  conceded: number;
  totalGoals: number;
  teamName: string;
};

type CachedFixtureItem = {
  fixture?: { id?: number; status?: { short?: string } };
  teams?: {
    home?: { id?: number; name?: string };
    away?: { id?: number; name?: string };
  };
};

type CachedEnvelope = { response?: CachedFixtureItem[] };

const profileCache = new Map<number, TeamProfileSnapshot>();

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseScore(finalScore: string | null | undefined): {
  home: number;
  away: number;
} | null {
  if (!finalScore) return null;
  const parts = finalScore.split(/\s*-\s*/).map((p) => Number(p.trim()));
  if (
    parts.length !== 2 ||
    !Number.isFinite(parts[0]) ||
    !Number.isFinite(parts[1])
  ) {
    return null;
  }
  return { home: parts[0], away: parts[1] };
}

function round3(n: number): number {
  return Number(n.toFixed(3));
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function weightedAvg(sum: number, weight: number): number {
  return weight > 0 ? round3(sum / weight) : 0;
}

function weightedRate(hits: number, weight: number): number {
  return weight > 0 ? round4(hits / weight) : 0;
}

type ProfileRow = {
  teamId: number;
  teamName: string;
  primaryLeagueId?: number | null;
  country?: string | null;
  totalMatchesAnalyzed: number;
  homeMatchesCount?: number | null;
  awayMatchesCount?: number | null;
  avgGoalsScoredHome: number;
  avgGoalsConcededHome: number;
  avgGoalsScoredAway: number;
  avgGoalsConcededAway: number;
  over15GoalsRate: number;
  over15GoalsRateHome?: number | null;
  over15GoalsRateAway?: number | null;
  over25GoalsRate: number;
  cleanSheetRate: number;
  cleanSheetRateHome?: number | null;
  cleanSheetRateAway?: number | null;
  lastManagerChangeDate?: Date | string | null;
  keyAbsencesCount?: number | null;
  brierCalibrationFactor?: number | null;
  updatedAt?: Date | string;
};

function toIsoOrNull(
  value: Date | string | null | undefined
): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function toSnapshot(row: ProfileRow): TeamProfileSnapshot {
  const primaryLeagueId =
    row.primaryLeagueId != null && Number.isFinite(row.primaryLeagueId)
      ? row.primaryLeagueId
      : null;
  return {
    teamId: row.teamId,
    teamName: row.teamName,
    primaryLeagueId,
    country: row.country ?? getLeagueCountry(primaryLeagueId),
    leagueName: primaryLeagueId != null
      ? getLeagueDisplayName(primaryLeagueId)
      : undefined,
    totalMatchesAnalyzed: row.totalMatchesAnalyzed,
    homeMatchesCount: row.homeMatchesCount ?? 0,
    awayMatchesCount: row.awayMatchesCount ?? 0,
    avgGoalsScoredHome: row.avgGoalsScoredHome,
    avgGoalsConcededHome: row.avgGoalsConcededHome,
    avgGoalsScoredAway: row.avgGoalsScoredAway,
    avgGoalsConcededAway: row.avgGoalsConcededAway,
    over15GoalsRate: row.over15GoalsRate,
    over15GoalsRateHome: row.over15GoalsRateHome ?? 0,
    over15GoalsRateAway: row.over15GoalsRateAway ?? 0,
    over25GoalsRate: row.over25GoalsRate,
    cleanSheetRate: row.cleanSheetRate,
    cleanSheetRateHome: row.cleanSheetRateHome ?? 0,
    cleanSheetRateAway: row.cleanSheetRateAway ?? 0,
    lastManagerChangeDate: toIsoOrNull(row.lastManagerChangeDate),
    keyAbsencesCount: row.keyAbsencesCount ?? 0,
    brierCalibrationFactor:
      typeof row.brierCalibrationFactor === "number" &&
      Number.isFinite(row.brierCalibrationFactor)
        ? row.brierCalibrationFactor
        : 1,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt,
  };
}

/**
 * Last ROLLING_WINDOW events with exponential recency weights.
 * If managerChangeCutoffMs is set, drops appearances before that reset.
 */
export function aggregateTeamEvents(
  events: TeamEvent[],
  opts?: {
    managerChangeCutoffMs?: number | null;
    lastManagerChangeDate?: string | null;
    keyAbsencesCount?: number;
  }
): Omit<TeamProfileSnapshot, "teamId" | "updatedAt"> {
  const cutoff = opts?.managerChangeCutoffMs;
  const filtered =
    cutoff != null && Number.isFinite(cutoff)
      ? events.filter((e) => e.at >= cutoff)
      : events;
  const sorted = [...filtered].sort((a, b) => b.at - a.at);
  const window = sorted.slice(0, ROLLING_WINDOW);
  const teamName = window[0]?.teamName ?? events[0]?.teamName ?? "Unknown";

  let homeScored = 0;
  let homeConceded = 0;
  let homeW = 0;
  let homeN = 0;
  let awayScored = 0;
  let awayConceded = 0;
  let awayW = 0;
  let awayN = 0;
  let over15 = 0;
  let over25 = 0;
  let cleanSheets = 0;
  let allW = 0;
  let over15Home = 0;
  let over15Away = 0;
  let csHome = 0;
  let csAway = 0;

  for (let i = 0; i < window.length; i++) {
    const e = window[i];
    const w = Math.pow(RECENCY_DECAY, i);
    allW += w;
    if (e.totalGoals > 1.5) over15 += w;
    if (e.totalGoals > 2.5) over25 += w;
    if (e.conceded === 0) cleanSheets += w;

    if (e.venue === "home") {
      homeN += 1;
      homeW += w;
      homeScored += e.scored * w;
      homeConceded += e.conceded * w;
      if (e.totalGoals > 1.5) over15Home += w;
      if (e.conceded === 0) csHome += w;
    } else {
      awayN += 1;
      awayW += w;
      awayScored += e.scored * w;
      awayConceded += e.conceded * w;
      if (e.totalGoals > 1.5) over15Away += w;
      if (e.conceded === 0) csAway += w;
    }
  }

  return {
    teamName,
    totalMatchesAnalyzed: window.length,
    homeMatchesCount: homeN,
    awayMatchesCount: awayN,
    avgGoalsScoredHome: weightedAvg(homeScored, homeW),
    avgGoalsConcededHome: weightedAvg(homeConceded, homeW),
    avgGoalsScoredAway: weightedAvg(awayScored, awayW),
    avgGoalsConcededAway: weightedAvg(awayConceded, awayW),
    over15GoalsRate: weightedRate(over15, allW),
    over15GoalsRateHome: weightedRate(over15Home, homeW),
    over15GoalsRateAway: weightedRate(over15Away, awayW),
    over25GoalsRate: weightedRate(over25, allW),
    cleanSheetRate: weightedRate(cleanSheets, allW),
    cleanSheetRateHome: weightedRate(csHome, homeW),
    cleanSheetRateAway: weightedRate(csAway, awayW),
    lastManagerChangeDate: opts?.lastManagerChangeDate ?? null,
    keyAbsencesCount: opts?.keyAbsencesCount ?? 0,
  };
}

/** Build apiFixtureId → team ids and name → id from CachedApiResponse. */
async function loadTeamIdMaps(): Promise<{
  byFixture: Map<
    number,
    { homeId: number; awayId: number; home: string; away: string }
  >;
  byName: Map<string, number>;
}> {
  const byFixture = new Map<
    number,
    { homeId: number; awayId: number; home: string; away: string }
  >();
  const byName = new Map<string, number>();

  try {
    const rows = await prisma.cachedApiResponse.findMany({
      where: {
        OR: [
          { id: { startsWith: "fixtures_date_" } },
          { endpoint: { contains: "fixtures" } },
        ],
      },
      select: { payload: true },
      take: 200,
    });

    for (const row of rows) {
      let parsed: CachedEnvelope;
      try {
        parsed = JSON.parse(row.payload) as CachedEnvelope;
      } catch {
        continue;
      }
      for (const item of parsed.response ?? []) {
        const fxId = item.fixture?.id;
        const homeId = item.teams?.home?.id;
        const awayId = item.teams?.away?.id;
        const home = item.teams?.home?.name?.trim() ?? "";
        const away = item.teams?.away?.name?.trim() ?? "";
        if (
          fxId == null ||
          homeId == null ||
          awayId == null ||
          !Number.isFinite(fxId) ||
          !Number.isFinite(homeId) ||
          !Number.isFinite(awayId)
        ) {
          continue;
        }
        byFixture.set(fxId, { homeId, awayId, home, away });
        if (home) byName.set(normalizeName(home), homeId);
        if (away) byName.set(normalizeName(away), awayId);
      }
    }
  } catch (err) {
    console.warn("[team-profiler] cache id map failed:", err);
  }

  return { byFixture, byName };
}

function resolveTeamId(
  name: string,
  preferred: number | undefined,
  byName: Map<string, number>
): number | null {
  if (preferred != null && Number.isFinite(preferred) && preferred > 0) {
    return preferred;
  }
  const key = normalizeName(name);
  const direct = byName.get(key);
  if (direct != null) return direct;
  for (const [k, id] of byName) {
    if (k.includes(key) || key.includes(k)) return id;
  }
  return null;
}

function profileWriteData(
  data: Omit<TeamProfileSnapshot, "teamId" | "updatedAt">
) {
  return {
    teamName: data.teamName,
    totalMatchesAnalyzed: data.totalMatchesAnalyzed,
    homeMatchesCount: data.homeMatchesCount,
    awayMatchesCount: data.awayMatchesCount,
    avgGoalsScoredHome: data.avgGoalsScoredHome,
    avgGoalsConcededHome: data.avgGoalsConcededHome,
    avgGoalsScoredAway: data.avgGoalsScoredAway,
    avgGoalsConcededAway: data.avgGoalsConcededAway,
    over15GoalsRate: data.over15GoalsRate,
    over15GoalsRateHome: data.over15GoalsRateHome,
    over15GoalsRateAway: data.over15GoalsRateAway,
    over25GoalsRate: data.over25GoalsRate,
    cleanSheetRate: data.cleanSheetRate,
    cleanSheetRateHome: data.cleanSheetRateHome,
    cleanSheetRateAway: data.cleanSheetRateAway,
  };
}

function warnProfilePersist(teamName: string): void {
  console.warn(
    `[TEAM PROFILER WARNING] Could not persist profile for ${teamName}. Continuing in-memory.`
  );
}

async function httpUpsertProfile(
  teamId: number,
  data: Omit<TeamProfileSnapshot, "teamId" | "updatedAt">,
  options?: { leagueId?: number | null }
): Promise<boolean> {
  const leagueId = options?.leagueId;
  if (
    leagueId != null &&
    Number.isFinite(leagueId) &&
    !isTeamProfileOriginLeagueId(leagueId)
  ) {
    console.log(
      `[team-profiler] skip upsert ${data.teamName} (teamId=${teamId}): league ${leagueId} not profile-origin`
    );
    return false;
  }

  const payload = {
    ...profileWriteData(data),
    ...(leagueId != null && isTeamProfileOriginLeagueId(leagueId)
      ? {
          primaryLeagueId: leagueId,
          country: getLeagueCountry(leagueId),
        }
      : {}),
  };

  try {
    const existing = await prisma.teamProfile.findUnique({ where: { teamId } });
    if (existing) {
      await prisma.teamProfile.update({
        where: { id: existing.id },
        data: payload,
      });
      return true;
    }

    // New rows only for clubs from domestic 1ª/2ª origin leagues
    if (leagueId == null || !isTeamProfileOriginLeagueId(leagueId)) {
      console.log(
        `[team-profiler] skip create ${data.teamName} (teamId=${teamId}): missing/unanalyzed origin league`
      );
      return false;
    }

    try {
      await prisma.teamProfile.create({
        data: {
          teamId,
          ...payload,
          primaryLeagueId: leagueId,
          country: getLeagueCountry(leagueId),
        },
      });
    } catch {
      const raced = await prisma.teamProfile.findUnique({ where: { teamId } });
      if (!raced) {
        warnProfilePersist(data.teamName);
        return true; // in-memory path still usable by caller
      }
      await prisma.teamProfile.update({
        where: { id: raced.id },
        data: payload,
      });
    }
    return true;
  } catch {
    warnProfilePersist(data.teamName);
    return true;
  }
}

/**
 * Recalculate TeamProfile rows from finished/settled MatchFixture scores.
 */
export async function updateTeamProfilesFromSettledMatches(): Promise<{
  teamsUpserted: number;
  matchesUsed: number;
}> {
  const fixtures = await prisma.matchFixture.findMany({
    where: { finalScore: { not: null } },
    select: {
      apiFixtureId: true,
      homeTeam: true,
      awayTeam: true,
      finalScore: true,
      status: true,
      matchDate: true,
      leagueId: true,
    },
    orderBy: { matchDate: "desc" },
    take: 5_000,
  });

  const rows = fixtures.filter(
    (r) => isFixtureFinished(r.status) || Boolean(parseScore(r.finalScore))
  );

  const { byFixture, byName } = await loadTeamIdMaps();
  const eventsByTeam = new Map<number, TeamEvent[]>();
  /** Prefer a domestic origin leagueId when upserting each team. */
  const originLeagueByTeam = new Map<number, number>();
  let matchesUsed = 0;

  const push = (teamId: number, event: TeamEvent, leagueId: number | null) => {
    const list = eventsByTeam.get(teamId);
    if (list) list.push(event);
    else eventsByTeam.set(teamId, [event]);
    if (
      leagueId != null &&
      isTeamProfileOriginLeagueId(leagueId) &&
      !originLeagueByTeam.has(teamId)
    ) {
      originLeagueByTeam.set(teamId, leagueId);
    }
  };

  for (const row of rows) {
    const leagueId = parseLeagueId(row.leagueId);
    // Stats only from active domestic 1ª/2ª — skip cups/UEFA/purged leagues
    if (leagueId == null || !isTeamProfileOriginLeagueId(leagueId)) continue;

    const score = parseScore(row.finalScore);
    if (!score) continue;
    const mapped = byFixture.get(row.apiFixtureId);
    const homeId = resolveTeamId(row.homeTeam, mapped?.homeId, byName);
    const awayId = resolveTeamId(row.awayTeam, mapped?.awayId, byName);
    if (homeId == null && awayId == null) continue;

    const at =
      row.matchDate instanceof Date
        ? row.matchDate.getTime()
        : Date.parse(String(row.matchDate));
    if (!Number.isFinite(at)) continue;

    const total = score.home + score.away;
    matchesUsed += 1;

    if (homeId != null) {
      push(
        homeId,
        {
          at,
          venue: "home",
          scored: score.home,
          conceded: score.away,
          totalGoals: total,
          teamName: mapped?.home || row.homeTeam,
        },
        leagueId
      );
    }
    if (awayId != null) {
      push(
        awayId,
        {
          at,
          venue: "away",
          scored: score.away,
          conceded: score.home,
          totalGoals: total,
          teamName: mapped?.away || row.awayTeam,
        },
        leagueId
      );
    }
  }

  let teamsUpserted = 0;
  const teamIds = [...eventsByTeam.keys()];
  const existingMeta = new Map<
    number,
    { lastManagerChangeDate: string | null; keyAbsencesCount: number }
  >();
  if (teamIds.length > 0) {
    try {
      const metas = await prisma.teamProfile.findMany({
        where: { teamId: { in: teamIds } },
        select: {
          teamId: true,
          lastManagerChangeDate: true,
          keyAbsencesCount: true,
        },
      });
      for (const m of metas) {
        existingMeta.set(m.teamId, {
          lastManagerChangeDate: toIsoOrNull(m.lastManagerChangeDate),
          keyAbsencesCount: m.keyAbsencesCount ?? 0,
        });
      }
    } catch (err) {
      console.warn("[team-profiler] meta load failed:", err);
    }
  }

  for (const [teamId, events] of eventsByTeam) {
    const meta = existingMeta.get(teamId);
    const cutoffIso = meta?.lastManagerChangeDate ?? null;
    const cutoffMs = cutoffIso ? Date.parse(cutoffIso) : null;
    const snapshot = aggregateTeamEvents(events, {
      managerChangeCutoffMs:
        cutoffMs != null && Number.isFinite(cutoffMs) ? cutoffMs : null,
      lastManagerChangeDate: cutoffIso,
      keyAbsencesCount: meta?.keyAbsencesCount ?? 0,
    });
    const saved = await httpUpsertProfile(teamId, snapshot, {
      leagueId: originLeagueByTeam.get(teamId) ?? null,
    });
    if (!saved) continue;
    const lid = originLeagueByTeam.get(teamId) ?? null;
    profileCache.set(teamId, {
      teamId,
      ...snapshot,
      primaryLeagueId: lid,
      country: lid != null ? getLeagueCountry(lid) : null,
      leagueName: lid != null ? getLeagueDisplayName(lid) : "Otros",
    });
    teamsUpserted += 1;
  }

  return { teamsUpserted, matchesUsed };
}

export function peekTeamProfile(
  teamId?: number | null
): TeamProfileSnapshot | null {
  if (teamId == null || !Number.isFinite(teamId) || teamId <= 0) return null;
  return profileCache.get(teamId) ?? null;
}

/** Prefetch profiles into the process cache (for sync Poisson calibration). */
export async function warmTeamProfileCache(
  teamIds: Array<number | undefined | null>
): Promise<number> {
  const ids = [
    ...new Set(
      teamIds.filter(
        (id): id is number => id != null && Number.isFinite(id) && id > 0
      )
    ),
  ];
  if (ids.length === 0) return 0;

  const missing = ids.filter((id) => !profileCache.has(id));
  if (missing.length === 0) return ids.length;

  try {
    const rows = await prisma.teamProfile.findMany({
      where: { teamId: { in: missing } },
    });
    for (const row of rows) {
      profileCache.set(row.teamId, toSnapshot(row));
    }
  } catch (err) {
    console.warn("[team-profiler] warm cache failed:", err);
  }
  return ids.length;
}

export async function searchTeamProfiles(
  query: string,
  limit = 40
): Promise<TeamProfileSnapshot[]> {
  const q = query.trim();
  const take = Math.min(500, Math.max(1, limit));
  try {
    const rows = await prisma.teamProfile.findMany({
      where: q
        ? { teamName: { contains: q, mode: "insensitive" } }
        : undefined,
      orderBy: [{ totalMatchesAnalyzed: "desc" }, { teamName: "asc" }],
      take,
    });
    const snapshots = rows.map(toSnapshot);
    return attachLeagueNames(snapshots);
  } catch (err) {
    console.warn("[team-profiler] search failed:", err);
    return [];
  }
}

/** Attach display league from primaryLeagueId; remap cup/null → domestic origin. */
async function attachLeagueNames(
  profiles: TeamProfileSnapshot[]
): Promise<TeamProfileSnapshot[]> {
  if (profiles.length === 0) return profiles;

  const needsResolve = profiles.some((p) =>
    needsDomesticLeagueRemap(p.primaryLeagueId)
  );
  let domestic = new Map<number, number>();
  if (needsResolve) {
    try {
      domestic = await resolveDomesticLeagueByTeamId();
    } catch (err) {
      console.warn("[team-profiler] domestic league resolve failed:", err);
    }
  }

  return profiles.map((p) => {
    let primaryLeagueId =
      p.primaryLeagueId != null &&
      Number.isFinite(p.primaryLeagueId) &&
      !needsDomesticLeagueRemap(p.primaryLeagueId)
        ? p.primaryLeagueId
        : null;

    if (primaryLeagueId == null) {
      primaryLeagueId = domestic.get(p.teamId) ?? null;
    }

    if (primaryLeagueId == null) {
      return {
        ...p,
        primaryLeagueId: null,
        leagueName: "Otros",
        country: null,
      };
    }

    return {
      ...p,
      primaryLeagueId,
      country: getLeagueCountry(primaryLeagueId),
      leagueName: getLeagueDisplayName(primaryLeagueId),
    };
  });
}

/** Persist manual / automated flag overrides on TeamProfile. */
export async function updateTeamProfileFlags(
  teamId: number,
  teamName: string,
  patch: {
    lastManagerChangeDate?: string | null;
    keyAbsencesCount?: number;
  },
  options?: { leagueId?: number | string | null }
): Promise<TeamProfileSnapshot | null> {
  if (!Number.isFinite(teamId) || teamId <= 0) return null;
  await patchTeamProfileFlags(teamId, teamName, patch, options);
  try {
    const row = await prisma.teamProfile.findUnique({ where: { teamId } });
    if (!row) return null;
    const [withLeague] = await attachLeagueNames([toSnapshot(row)]);
    return withLeague ?? toSnapshot(row);
  } catch {
    return profileCache.get(teamId) ?? null;
  }
}

/**
 * Cap historical boosts: ≤ +8% of base and never above PROB_CEILING.
 * rawCalibrated is typically base * RELATIVE_BOOST.
 */
export function clampHistoricalBoost(
  baseProbability: number,
  rawCalibratedProb: number
): number {
  const base = Math.max(0, baseProbability);
  const maxBoost = base * MAX_RELATIVE_BOOST_FRAC;
  return Math.min(
    PROB_CEILING,
    Math.min(base + maxBoost, Math.max(0, rawCalibratedProb))
  );
}

function boostMarket(
  out: Record<MarketType, number>,
  market: MarketType
): void {
  const base = out[market];
  out[market] = clampHistoricalBoost(base, base * RELATIVE_BOOST);
}

/**
 * True when a recent manager change still blocks historical multipliers:
 * change within MANAGER_CHANGE_COOLDOWN_DAYS and fewer than
 * MANAGER_CHANGE_MIN_MATCHES settled under the new staff (post-cutoff sample).
 */
export function isTeamProfileCalibrationSuspended(
  profile: TeamProfileSnapshot | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!profile?.lastManagerChangeDate) return false;
  const changedAt = Date.parse(profile.lastManagerChangeDate);
  if (!Number.isFinite(changedAt)) return false;
  const ageDays = (nowMs - changedAt) / 86_400_000;
  if (ageDays < 0 || ageDays > MANAGER_CHANGE_COOLDOWN_DAYS) return false;
  return profile.totalMatchesAnalyzed < MANAGER_CHANGE_MIN_MATCHES;
}

/** λ dampener for key attacking-line absences stored on the profile. */
export function keyAbsenceLambdaFactor(
  profile: TeamProfileSnapshot | null | undefined
): number {
  if (profile == null) return 1;
  return (profile.keyAbsencesCount ?? 0) >= 1 ? KEY_ABSENCE_LAMBDA : 1;
}

/**
 * Prefer TeamProfile.keyAbsencesCount; fallback to match.injuries keyAbsence flags
 * already attached by context-enrichment (0 extra API).
 */
export function keyAbsenceLambdaFactorForSide(
  teamId: number | undefined,
  injuries?: Array<{ keyAbsence?: boolean; status?: string }>
): number {
  const fromProfile = keyAbsenceLambdaFactor(peekTeamProfile(teamId));
  if (fromProfile < 1) return fromProfile;
  const keys = (injuries ?? []).filter(
    (i) => i.keyAbsence && i.status !== "doubtful"
  ).length;
  return keys >= 1 ? KEY_ABSENCE_LAMBDA : 1;
}

/**
 * Historical calibration on raw Poisson market probs (venue-gated).
 * Manager-change cooldown → that side is ignored (base Poisson for boosts).
 */
export function applyTeamProfileCalibration(
  probs: Record<MarketType, number>,
  home: TeamProfileSnapshot | null,
  away: TeamProfileSnapshot | null,
  nowMs = Date.now()
): { probs: Record<MarketType, number>; flags: string[]; notes: string[] } {
  const out = { ...probs };
  const flags: string[] = [];
  const notes: string[] = [];

  const homeActive =
    home != null && !isTeamProfileCalibrationSuspended(home, nowMs)
      ? home
      : null;
  const awayActive =
    away != null && !isTeamProfileCalibrationSuspended(away, nowMs)
      ? away
      : null;

  if (home != null && homeActive == null) {
    flags.push("TEAM_PROFILE_MANAGER_RESET_HOME");
    notes.push("Cambio de DT reciente (local): perfil histórico suspendido");
  }
  if (away != null && awayActive == null) {
    flags.push("TEAM_PROFILE_MANAGER_RESET_AWAY");
    notes.push("Cambio de DT reciente (visita): perfil histórico suspendido");
  }

  const homeOverHot =
    homeActive != null &&
    homeActive.homeMatchesCount >= MIN_VENUE_SAMPLE &&
    homeActive.over15GoalsRateHome > OVER15_RATE_GATE;
  const awayOverHot =
    awayActive != null &&
    awayActive.awayMatchesCount >= MIN_VENUE_SAMPLE &&
    awayActive.over15GoalsRateAway > OVER15_RATE_GATE;

  if (homeOverHot || awayOverHot) {
    boostMarket(out, "over_1_5");
    flags.push("TEAM_PROFILE_OVER15");
    notes.push("Perfil venue: Over 1.5 reforzado (boost acotado)");
  }

  if (
    homeActive != null &&
    homeActive.homeMatchesCount >= MIN_VENUE_SAMPLE &&
    homeActive.cleanSheetRateHome > CLEAN_SHEET_GATE
  ) {
    boostMarket(out, "1x");
    boostMarket(out, "dnb_home");
    flags.push("TEAM_PROFILE_HOME_CS");
    notes.push("Perfil local (N≥4): clean sheet → boost 1X / DNB 1");
  }

  if (
    awayActive != null &&
    awayActive.awayMatchesCount >= MIN_VENUE_SAMPLE &&
    awayActive.cleanSheetRateAway > CLEAN_SHEET_GATE
  ) {
    boostMarket(out, "x2");
    boostMarket(out, "dnb_away");
    flags.push("TEAM_PROFILE_AWAY_CS");
    notes.push("Perfil visitante (N≥4): clean sheet → boost X2 / DNB 2");
  }

  return { probs: out, flags, notes };
}

/** Never throws — settlement / cron must keep going. */
export async function maybeUpdateTeamProfilesAfterSettlement(
  settledCount: number
): Promise<{ teamsUpserted: number; matchesUsed: number } | null> {
  if (settledCount <= 0) return null;
  try {
    return await updateTeamProfilesFromSettledMatches();
  } catch (err) {
    console.error("[team-profiler] post-settle update failed:", err);
    return null;
  }
}

/** Patch in-memory Brier factor after learning-engine persists to DB. */
export function patchCachedBrierFactor(teamId: number, factor: number): void {
  const cur = profileCache.get(teamId);
  if (!cur) return;
  const n = Number(factor);
  if (!Number.isFinite(n)) return;
  profileCache.set(teamId, { ...cur, brierCalibrationFactor: n });
}

// ── Automated coach / key-injury detection (API-Football) ──────────────

/** Max uncached live calls per sync pass (Free-plan quota). */
const PROFILE_AUTO_LIVE_BATCH = 8;

type ApiEnvelope<T> = {
  response?: T;
  errors?: Record<string, string> | string[];
};

type CoachCareerRow = {
  team?: { id?: number; name?: string };
  start?: string | null;
  end?: string | null;
};

type CoachRow = {
  id?: number;
  name?: string;
  career?: CoachCareerRow[];
};

function envelopeHasErrors(errors: ApiEnvelope<unknown>["errors"]): boolean {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors).length > 0;
}

/** Active stint start for team (career.end null). Exported for verify. */
export function findActiveCoachStartDate(
  coaches: CoachRow[],
  teamId: number
): string | null {
  let best: string | null = null;
  for (const coach of coaches) {
    for (const stint of coach.career ?? []) {
      if (stint.team?.id !== teamId) continue;
      const end = stint.end?.trim() || null;
      if (end) continue;
      const start = stint.start?.trim();
      if (!start) continue;
      if (!best || Date.parse(start) > Date.parse(best)) best = start;
    }
  }
  return best;
}

async function patchTeamProfileFlags(
  teamId: number,
  teamName: string,
  patch: {
    lastManagerChangeDate?: string | null;
    keyAbsencesCount?: number;
  },
  options?: { leagueId?: number | string | null }
): Promise<void> {
  const leagueId = parseLeagueId(options?.leagueId ?? null);
  const displayName = teamName || `Team ${teamId}`;

  try {
    const existing = await prisma.teamProfile.findUnique({ where: { teamId } });

    // Updates OK for existing analyzable clubs (even mid-cup / UEFA).
    // Creates require a domestic 1ª/2ª origin league id.
    if (!existing) {
      if (leagueId == null || !isTeamProfileOriginLeagueId(leagueId)) {
        console.log(
          `[team-profiler] skip create flags ${displayName}: missing/unanalyzed origin league`
        );
      } else {
        try {
          await prisma.teamProfile.create({
            data: {
              teamId,
              teamName: displayName,
              totalMatchesAnalyzed: 0,
              homeMatchesCount: 0,
              awayMatchesCount: 0,
              keyAbsencesCount: patch.keyAbsencesCount ?? 0,
              lastManagerChangeDate: patch.lastManagerChangeDate
                ? new Date(patch.lastManagerChangeDate)
                : null,
              primaryLeagueId: leagueId,
              country: getLeagueCountry(leagueId),
            },
          });
        } catch {
          const raced = await prisma.teamProfile.findUnique({
            where: { teamId },
          });
          if (raced) {
            await prisma.teamProfile.update({
              where: { id: raced.id },
              data: {
                ...(patch.lastManagerChangeDate !== undefined
                  ? {
                      lastManagerChangeDate: patch.lastManagerChangeDate
                        ? new Date(patch.lastManagerChangeDate)
                        : null,
                    }
                  : {}),
                ...(patch.keyAbsencesCount !== undefined
                  ? { keyAbsencesCount: patch.keyAbsencesCount }
                  : {}),
              },
            });
          } else {
            warnProfilePersist(displayName);
          }
        }
      }
    } else {
      await prisma.teamProfile.update({
        where: { id: existing.id },
        data: {
          ...(patch.lastManagerChangeDate !== undefined
            ? {
                lastManagerChangeDate: patch.lastManagerChangeDate
                  ? new Date(patch.lastManagerChangeDate)
                  : null,
              }
            : {}),
          ...(patch.keyAbsencesCount !== undefined
            ? { keyAbsencesCount: patch.keyAbsencesCount }
            : {}),
          teamName: teamName || existing.teamName,
        },
      });
    }
  } catch {
    warnProfilePersist(displayName);
  }

  const cached = profileCache.get(teamId);
  if (cached) {
    profileCache.set(teamId, {
      ...cached,
      teamName: teamName || cached.teamName,
      ...(patch.lastManagerChangeDate !== undefined
        ? { lastManagerChangeDate: patch.lastManagerChangeDate }
        : {}),
      ...(patch.keyAbsencesCount !== undefined
        ? { keyAbsencesCount: patch.keyAbsencesCount }
        : {}),
    });
  } else if (leagueId != null && isTeamProfileOriginLeagueId(leagueId)) {
    profileCache.set(teamId, {
      teamId,
      teamName: teamName || `Team ${teamId}`,
      totalMatchesAnalyzed: 0,
      homeMatchesCount: 0,
      awayMatchesCount: 0,
      avgGoalsScoredHome: 0,
      avgGoalsConcededHome: 0,
      avgGoalsScoredAway: 0,
      avgGoalsConcededAway: 0,
      over15GoalsRate: 0,
      over15GoalsRateHome: 0,
      over15GoalsRateAway: 0,
      over25GoalsRate: 0,
      cleanSheetRate: 0,
      cleanSheetRateHome: 0,
      cleanSheetRateAway: 0,
      lastManagerChangeDate: patch.lastManagerChangeDate ?? null,
      keyAbsencesCount: patch.keyAbsencesCount ?? 0,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Fetch `/coachs?team=` and persist lastManagerChangeDate when the active
 * coach started within the last 14 days.
 */
export async function checkAutomatedManagerChange(
  teamId: number,
  teamName = "",
  options?: { leagueId?: number | string | null }
): Promise<{ updated: boolean; startDate: string | null }> {
  if (!Number.isFinite(teamId) || teamId <= 0) {
    return { updated: false, startDate: null };
  }
  try {
    const { apiFootballGet } = await import("./api-football");
    const { CACHE_TTL_MINUTES } = await import("./api-cache");
    const json = await apiFootballGet<CoachRow[]>(`/coachs?team=${teamId}`, {
      ttlMinutes: CACHE_TTL_MINUTES.ROSTER,
      cacheKey: `coachs_team_${teamId}`,
    });
    if (!json || envelopeHasErrors(json.errors)) {
      return { updated: false, startDate: null };
    }
    const start = findActiveCoachStartDate(json.response ?? [], teamId);
    if (!start || !isRecentManagerStart(start)) {
      return { updated: false, startDate: start };
    }
    const iso = new Date(Date.parse(start)).toISOString();
    await patchTeamProfileFlags(
      teamId,
      teamName,
      { lastManagerChangeDate: iso },
      options
    );
    return { updated: true, startDate: iso };
  } catch (err) {
    console.warn(`[team-profiler] coachs team=${teamId} failed:`, err);
    return { updated: false, startDate: null };
  }
}

/**
 * Injuries ∩ top scorers → keyAbsencesCount (delegates to injuries-checker).
 */
export async function fetchKeyAbsencesForFixture(
  fixtureId: number,
  teamId: number,
  teamName = ""
): Promise<{ count: number; updated: boolean }> {
  if (
    !Number.isFinite(fixtureId) ||
    fixtureId <= 0 ||
    !Number.isFinite(teamId) ||
    teamId <= 0
  ) {
    return { count: 0, updated: false };
  }
  try {
    const { checkMatchInjuries } = await import("./injuries-checker");
    // Need opponent id for the checker API; use teamId as both when unknown.
    const result = await checkMatchInjuries(fixtureId, teamId, teamId, {
      homeName: teamName,
      awayName: teamName,
      persistProfiles: true,
      allowLive: true,
    });
    const count =
      result.home.teamId === teamId
        ? result.home.keyAbsencesCount
        : result.away.keyAbsencesCount;
    return { count, updated: true };
  } catch (err) {
    console.warn(
      `[team-profiler] key absences fixture=${fixtureId} team=${teamId}:`,
      err
    );
    return { count: 0, updated: false };
  }
}

/**
 * Before Poisson: auto-detect recent DT changes + key absences (injuries-checker).
 * Injuries use shared cache key injuries_fixture_{id}, TTL 12h on live miss.
 */
export async function syncAutomatedTeamProfileFlags(
  matches: Array<{
    id: string;
    leagueId?: string | number;
    home: { id?: number; name: string };
    away: { id?: number; name: string };
  }>
): Promise<{
  managersChecked: number;
  managersUpdated: number;
  absencesUpdated: number;
  injuryLiveFetches?: number;
}> {
  if (matches.length === 0) {
    return { managersChecked: 0, managersUpdated: 0, absencesUpdated: 0 };
  }

  const { getCachedPayload } = await import("./api-cache");

  const teams = new Map<number, { name: string; leagueId?: string | number }>();
  for (const m of matches) {
    if (m.home.id != null && m.home.id > 0) {
      teams.set(m.home.id, { name: m.home.name, leagueId: m.leagueId });
    }
    if (m.away.id != null && m.away.id > 0) {
      teams.set(m.away.id, { name: m.away.name, leagueId: m.leagueId });
    }
  }

  let liveLeft = Math.max(2, Math.floor(PROFILE_AUTO_LIVE_BATCH / 2));
  let managersChecked = 0;
  let managersUpdated = 0;

  for (const [teamId, meta] of teams) {
    const cacheKey = `coachs_team_${teamId}`;
    const cached = await getCachedPayload<unknown>(cacheKey);
    if (cached == null && liveLeft <= 0) continue;
    if (cached == null) liveLeft -= 1;
    managersChecked += 1;
    const result = await checkAutomatedManagerChange(teamId, meta.name, {
      leagueId: meta.leagueId,
    });
    if (result.updated) managersUpdated += 1;
  }

  const { applyInjuryChecksToMatchPool } = await import("./injuries-checker");
  const injury = await applyInjuryChecksToMatchPool(matches, {
    maxLiveFetches: Math.max(liveLeft, 4),
  });

  await warmTeamProfileCache([...teams.keys()]);
  return {
    managersChecked,
    managersUpdated,
    absencesUpdated: injury.profilesTouched,
    injuryLiveFetches: injury.liveFetches,
  };
}

/** Pure helpers for verify scripts. */
export const TEAM_PROFILE_RULES = {
  ROLLING_WINDOW,
  RECENCY_DECAY,
  MIN_VENUE_SAMPLE,
  /** @deprecated use MIN_VENUE_SAMPLE */
  MIN_SAMPLE: MIN_VENUE_SAMPLE,
  OVER15_RATE_GATE,
  CLEAN_SHEET_GATE,
  RELATIVE_BOOST,
  PROB_CEILING,
  MAX_RELATIVE_BOOST_FRAC,
  MANAGER_CHANGE_COOLDOWN_DAYS,
  MANAGER_CHANGE_MIN_MATCHES,
  KEY_ABSENCE_LAMBDA,
  PROFILE_AUTO_LIVE_BATCH,
} as const;
