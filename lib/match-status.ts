/**
 * API-Football fixture.status.short classification for settlement.
 * https://www.api-football.com/documentation-v3#tag/Fixtures
 */
import { chileDateString } from "./utils";

/** Full time / finished — evaluate the market against the final score. */
export const FINISHED_STATUSES = [
  "FT",
  "AET",
  "PEN",
  "EXTRA",
  "AWD",
  "WO",
] as const;

/** Postponed / cancelled / abandoned / interrupted → CANCELLED (odds 1.00). */
export const VOID_STATUSES = [
  "POSTP",
  "PST",
  "CANC",
  "CAN",
  "ABD",
  "SUSP",
  "INT",
] as const;

/** In-play — never settle as WON/LOST even if a live score exists. */
export const LIVE_STATUSES = [
  "1H",
  "2H",
  "HT",
  "ET",
  "BT",
  "P",
  "LIVE",
] as const;

/** @deprecated Kickoff-in-the-past is enough; kept at 0 for callers. */
export const SETTLE_DELAY_MS = 0;

const FINISHED_SET = new Set<string>(FINISHED_STATUSES);
const VOID_SET = new Set<string>(VOID_STATUSES);
const LIVE_SET = new Set<string>(LIVE_STATUSES);

export function normalizeStatusShort(statusShort: string | null | undefined): string {
  return (statusShort ?? "").trim().toUpperCase();
}

export function isFixtureFinished(statusShort: string | null | undefined): boolean {
  return FINISHED_SET.has(normalizeStatusShort(statusShort));
}

export function isFixtureVoided(statusShort: string | null | undefined): boolean {
  return VOID_SET.has(normalizeStatusShort(statusShort));
}

export function isFixtureLive(statusShort: string | null | undefined): boolean {
  return LIVE_SET.has(normalizeStatusShort(statusShort));
}

/**
 * Pending legs whose kickoff already happened (kickoff < NOW),
 * plus Chile-calendar days already in the past (timezone mismatch safety).
 */
export function isKickoffDueForSettlement(
  matchDate: Date | string | number | null | undefined,
  nowMs = Date.now()
): boolean {
  if (matchDate == null) return true;
  const t =
    matchDate instanceof Date
      ? matchDate.getTime()
      : new Date(matchDate).getTime();
  if (!Number.isFinite(t)) return true;
  if (t < nowMs) return true;
  const chileToday = chileDateString(new Date(nowMs));
  const chileKick = chileDateString(new Date(t));
  return chileKick < chileToday;
}
