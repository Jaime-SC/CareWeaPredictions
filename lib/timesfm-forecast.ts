/**
 * TimesFM t+1 forecast cache + Neon upsert (offline batch only).
 * // ponytail: TimesFM offline-only + ±8% λ blend + EWMA stub sin GPU; upgrade when walk-forward muestra lift
 */
import { prisma } from "./db";
import type {
  TimesfmForecastFields,
  TimesfmForecastSnapshot,
  TimesfmForecastUpdate,
} from "./team-profile-shared";

export type {
  TimesfmForecastFields,
  TimesfmForecastSnapshot,
  TimesfmForecastUpdate,
} from "./team-profile-shared";

const LIVE_CACHE_MAX = 2_000;
const AS_OF_CACHE_MAX = 8_000;

const liveCache = new Map<number, TimesfmForecastSnapshot>();
const asOfCache = new Map<string, TimesfmForecastSnapshot>();

function asOfDateUtc(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function ymdUtc(d: Date): string {
  return asOfDateUtc(d).toISOString().slice(0, 10);
}

function parseAsOfDate(raw: string): Date | null {
  const t = Date.parse(`${raw.trim()}T00:00:00.000Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}

function profileAtCacheKey(teamId: number, asOf: Date): string {
  return `${teamId}|${ymdUtc(asOf)}`;
}

function trimLiveCache(): void {
  if (liveCache.size <= LIVE_CACHE_MAX) return;
  const drop = liveCache.size - LIVE_CACHE_MAX;
  const keys = [...liveCache.keys()];
  for (let i = 0; i < drop; i++) liveCache.delete(keys[i]!);
}

function trimAsOfCache(): void {
  if (asOfCache.size <= AS_OF_CACHE_MAX) return;
  const drop = asOfCache.size - AS_OF_CACHE_MAX;
  const keys = [...asOfCache.keys()];
  for (let i = 0; i < drop; i++) asOfCache.delete(keys[i]!);
}

function rowToSnapshot(row: {
  teamId: number;
  asOfDate: Date;
  timesfmXgScored: number | null;
  timesfmXgConceded: number | null;
  timesfmNpxGScored: number | null;
  timesfmNpxGConceded: number | null;
  timesfmCornersFor: number | null;
  timesfmCornersAgainst: number | null;
  timesfmCardsFor: number | null;
  timesfmCardsAgainst: number | null;
  timesfmFormScore: number;
  updatedAt?: Date;
}): TimesfmForecastSnapshot {
  return {
    teamId: row.teamId,
    asOfDate: ymdUtc(row.asOfDate),
    timesfmXgScored: row.timesfmXgScored,
    timesfmXgConceded: row.timesfmXgConceded,
    timesfmNpxGScored: row.timesfmNpxGScored,
    timesfmNpxGConceded: row.timesfmNpxGConceded,
    timesfmCornersFor: row.timesfmCornersFor,
    timesfmCornersAgainst: row.timesfmCornersAgainst,
    timesfmCardsFor: row.timesfmCardsFor,
    timesfmCardsAgainst: row.timesfmCardsAgainst,
    timesfmFormScore: row.timesfmFormScore,
    updatedAt: row.updatedAt?.toISOString(),
  };
}

function pickFields(row: TimesfmForecastFields): TimesfmForecastFields {
  const out: TimesfmForecastFields = {};
  if (row.timesfmXgScored != null && Number.isFinite(row.timesfmXgScored)) {
    out.timesfmXgScored = row.timesfmXgScored;
  }
  if (row.timesfmXgConceded != null && Number.isFinite(row.timesfmXgConceded)) {
    out.timesfmXgConceded = row.timesfmXgConceded;
  }
  if (row.timesfmNpxGScored != null && Number.isFinite(row.timesfmNpxGScored)) {
    out.timesfmNpxGScored = row.timesfmNpxGScored;
  }
  if (
    row.timesfmNpxGConceded != null &&
    Number.isFinite(row.timesfmNpxGConceded)
  ) {
    out.timesfmNpxGConceded = row.timesfmNpxGConceded;
  }
  if (
    row.timesfmCornersFor != null &&
    Number.isFinite(row.timesfmCornersFor)
  ) {
    out.timesfmCornersFor = row.timesfmCornersFor;
  }
  if (
    row.timesfmCornersAgainst != null &&
    Number.isFinite(row.timesfmCornersAgainst)
  ) {
    out.timesfmCornersAgainst = row.timesfmCornersAgainst;
  }
  if (row.timesfmCardsFor != null && Number.isFinite(row.timesfmCardsFor)) {
    out.timesfmCardsFor = row.timesfmCardsFor;
  }
  if (
    row.timesfmCardsAgainst != null &&
    Number.isFinite(row.timesfmCardsAgainst)
  ) {
    out.timesfmCardsAgainst = row.timesfmCardsAgainst;
  }
  if (row.timesfmFormScore != null && Number.isFinite(row.timesfmFormScore)) {
    out.timesfmFormScore = Math.min(1, Math.max(0, row.timesfmFormScore));
  }
  return out;
}

/** Sync read of latest LIVE forecast (fail-open null). */
export function peekTimesfmForecast(
  teamId?: number | null
): TimesfmForecastSnapshot | null {
  if (teamId == null || !Number.isFinite(teamId) || teamId <= 0) return null;
  return liveCache.get(teamId) ?? null;
}

/** Sync read for a warmed asOf cutoff. No LIVE fallback. */
export function peekTimesfmForecastAt(
  teamId?: number | null,
  asOf?: Date | null
): TimesfmForecastSnapshot | null {
  if (teamId == null || !Number.isFinite(teamId) || teamId <= 0) return null;
  if (asOf == null || !Number.isFinite(asOf.getTime())) return null;
  return asOfCache.get(profileAtCacheKey(teamId, asOf)) ?? null;
}

export function primeTimesfmForecast(snapshot: TimesfmForecastSnapshot): void {
  if (!Number.isFinite(snapshot.teamId) || snapshot.teamId <= 0) return;
  liveCache.set(snapshot.teamId, snapshot);
  trimLiveCache();
}

export function primeTimesfmForecastAt(
  snapshot: TimesfmForecastSnapshot,
  asOf: Date
): void {
  if (!Number.isFinite(asOf.getTime())) return;
  if (!Number.isFinite(snapshot.teamId) || snapshot.teamId <= 0) return;
  asOfCache.set(profileAtCacheKey(snapshot.teamId, asOf), {
    ...snapshot,
    asOfDate: ymdUtc(asOf),
  });
  trimAsOfCache();
}

/** Clear caches (verify scripts). */
export function clearTimesfmForecastCache(): void {
  liveCache.clear();
  asOfCache.clear();
}

export type TimesfmBulkResult = {
  upserted: number;
  skipped: number;
  errors: string[];
};

/** Idempotent upsert of TeamTimesfmForecast rows. */
export async function bulkUpsertTimesfmForecasts(
  updates: TimesfmForecastUpdate[]
): Promise<TimesfmBulkResult> {
  const result: TimesfmBulkResult = { upserted: 0, skipped: 0, errors: [] };

  for (const row of updates) {
    const teamId = row.teamId;
    if (!Number.isFinite(teamId) || teamId <= 0) {
      result.errors.push(`invalid teamId: ${String(row.teamId)}`);
      continue;
    }
    const asOfDate = parseAsOfDate(row.asOfDate);
    if (!asOfDate) {
      result.errors.push(`invalid asOfDate for teamId=${teamId}`);
      continue;
    }

    const fields = pickFields(row);
    if (Object.keys(fields).length === 0 && row.timesfmFormScore == null) {
      result.skipped += 1;
      continue;
    }

    const data = {
      ...fields,
      timesfmFormScore: fields.timesfmFormScore ?? 0.5,
    };

    try {
      const existing = await prisma.teamTimesfmForecast.findUnique({
        where: { teamId_asOfDate: { teamId, asOfDate } },
      });
      if (existing) {
        await prisma.teamTimesfmForecast.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await prisma.teamTimesfmForecast.create({
          data: { teamId, asOfDate, ...data },
        });
      }
      const snap = rowToSnapshot({
        teamId,
        asOfDate,
        timesfmXgScored: data.timesfmXgScored ?? null,
        timesfmXgConceded: data.timesfmXgConceded ?? null,
        timesfmNpxGScored: data.timesfmNpxGScored ?? null,
        timesfmNpxGConceded: data.timesfmNpxGConceded ?? null,
        timesfmCornersFor: data.timesfmCornersFor ?? null,
        timesfmCornersAgainst: data.timesfmCornersAgainst ?? null,
        timesfmCardsFor: data.timesfmCardsFor ?? null,
        timesfmCardsAgainst: data.timesfmCardsAgainst ?? null,
        timesfmFormScore: data.timesfmFormScore,
      });
      primeTimesfmForecast(snap);
      primeTimesfmForecastAt(snap, asOfDate);
      result.upserted += 1;
    } catch (err) {
      result.errors.push(
        `teamId=${teamId} asOf=${row.asOfDate}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return result;
}

/** Warm point-in-time forecasts from Neon (fail-open 0 on DB error). */
export async function warmTimesfmForecastsForMatches(
  matches: Array<{
    kickoff: string;
    home: { id?: number };
    away: { id?: number };
  }>
): Promise<number> {
  const ids = [
    ...new Set(
      matches
        .flatMap((m) => [m.home.id, m.away.id])
        .filter(
          (id): id is number => id != null && Number.isFinite(id) && id > 0
        )
    ),
  ];
  if (ids.length === 0 || matches.length === 0) return 0;

  let maxDay = asOfDateUtc(new Date(0));
  for (const m of matches) {
    const asOf = new Date(m.kickoff);
    if (!Number.isFinite(asOf.getTime())) continue;
    const day = asOfDateUtc(asOf);
    if (day.getTime() > maxDay.getTime()) maxDay = day;
  }

  let rows: Array<{
    teamId: number;
    asOfDate: Date;
    timesfmXgScored: number | null;
    timesfmXgConceded: number | null;
    timesfmNpxGScored: number | null;
    timesfmNpxGConceded: number | null;
    timesfmCornersFor: number | null;
    timesfmCornersAgainst: number | null;
    timesfmCardsFor: number | null;
    timesfmCardsAgainst: number | null;
    timesfmFormScore: number;
    updatedAt: Date;
  }> = [];

  try {
    rows = await prisma.teamTimesfmForecast.findMany({
      where: { teamId: { in: ids }, asOfDate: { lte: maxDay } },
      orderBy: { asOfDate: "desc" },
    });
  } catch (err) {
    console.warn("[timesfm-forecast] warm failed:", err);
    return 0;
  }

  const byTeam = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byTeam.get(row.teamId);
    if (list) list.push(row);
    else byTeam.set(row.teamId, [row]);
  }

  let primed = 0;
  for (const m of matches) {
    const asOf = new Date(m.kickoff);
    if (!Number.isFinite(asOf.getTime())) continue;
    const dayMs = asOfDateUtc(asOf).getTime();
    for (const id of [m.home.id, m.away.id]) {
      if (id == null || !Number.isFinite(id) || id <= 0) continue;
      if (asOfCache.has(profileAtCacheKey(id, asOf))) continue;
      const list = byTeam.get(id);
      const hit = list?.find((r) => r.asOfDate.getTime() <= dayMs);
      if (!hit) continue;
      const snap = rowToSnapshot(hit);
      primeTimesfmForecastAt(snap, asOf);
      primeTimesfmForecast(snap);
      primed += 1;
    }
  }
  return primed;
}

/** Clamp ratio used as λ/μ multiplier (fail-open 1). */
export function timesfmRatioMult(
  forecast: number | null | undefined,
  baseline: number,
  lo = 0.92,
  hi = 1.08
): number {
  if (forecast == null || !Number.isFinite(forecast) || !(baseline > 0)) {
    return 1;
  }
  const r = forecast / baseline;
  if (!Number.isFinite(r)) return 1;
  return Math.min(hi, Math.max(lo, r));
}

/** Mean form score of two sides; null if both missing. */
export function meanTimesfmFormScore(
  home?: TimesfmForecastSnapshot | null,
  away?: TimesfmForecastSnapshot | null
): number | undefined {
  const scores = [home?.timesfmFormScore, away?.timesfmFormScore].filter(
    (s): s is number => s != null && Number.isFinite(s)
  );
  if (scores.length === 0) return undefined;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
