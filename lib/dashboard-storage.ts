import type { MatchPrediction } from "./types";
import { chileDateOffset, chileDateString } from "./utils";

const KEY_PREFIX = "parleylab_dashboard_";

/** Skip a background refetch if the snapshot is newer than this. */
export const DASHBOARD_CACHE_FRESH_MS = 2 * 60 * 1000;

export interface StoredDashboardPayload {
  kind: "dashboard";
  date: string;
  predictions: MatchPrediction[];
  emptyMessage: string | null;
  savedAt: string;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function dashboardStorageKey(date = chileDateString()): string {
  return `${KEY_PREFIX}${date}`;
}

export function isDashboardCacheFresh(
  savedAt: string,
  maxAgeMs = DASHBOARD_CACHE_FRESH_MS
): boolean {
  const t = Date.parse(savedAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < maxAgeMs;
}

/** Drop snapshots that are not for today (Chile civil date). */
export function cleanupExpiredDashboardCache(
  today = chileDateString()
): void {
  if (!canUseStorage()) return;

  const keepFrom = chileDateOffset(-1, today);
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(KEY_PREFIX)) continue;
    const datePart = key.slice(KEY_PREFIX.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || datePart < keepFrom) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    localStorage.removeItem(key);
  }
}

export function loadStoredDashboard(
  date = chileDateString()
): StoredDashboardPayload | null {
  if (!canUseStorage()) return null;

  try {
    const raw = localStorage.getItem(dashboardStorageKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDashboardPayload;
    if (
      !parsed ||
      parsed.kind !== "dashboard" ||
      parsed.date !== date ||
      !Array.isArray(parsed.predictions)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredDashboard(
  predictions: MatchPrediction[],
  emptyMessage: string | null,
  date = chileDateString()
): void {
  if (!canUseStorage()) return;

  const payload: StoredDashboardPayload = {
    kind: "dashboard",
    date,
    predictions,
    emptyMessage,
    savedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(dashboardStorageKey(date), JSON.stringify(payload));
  } catch (err) {
    console.warn("[dashboard-storage] Failed to save snapshot:", err);
  }
}
