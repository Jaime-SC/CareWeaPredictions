import type { GeneratedParlay, MarketType, StrategyMode } from "./types";
import { chileDateOffset, chileDateString } from "./utils";

/** User-requested key shape: parleylab_data_[mode]_[YYYY-MM-DD] */
const KEY_PREFIX = "parleylab_data_";
const LEGACY_PREFIXES = ["parleylab_mode_", "parleylab_parlay_"];

const MODE_STORAGE_SLUG: Record<StrategyMode, string> = {
  "daily-safe": "safe",
  "daily-fun": "fun",
  "monopoly-asymmetry": "monopoly",
};

export interface SafePickItem {
  matchId: string;
  matchLabel: string;
  leagueName: string;
  kickoff: string;
  market: MarketType;
  marketLabel: string;
  odds: number;
  modelProbability: number;
  edge: number;
  contextFlags?: string[];
  contextNotes?: string[];
  confidenceModifier?: number;
  referee?: string | null;
  venue?: string | null;
}

export interface StoredParlayPayload {
  kind: "parlay";
  date: string;
  strategyMode: StrategyMode;
  parlay: GeneratedParlay;
  clipboard: string;
  savedAt: string;
}

export interface StoredSafePicksPayload {
  kind: "safe-picks";
  date: string;
  strategyMode: "daily-safe";
  picks: SafePickItem[];
  savedAt: string;
}

export type StoredBuilderPayload =
  | StoredParlayPayload
  | StoredSafePicksPayload;

export function builderStorageKey(
  strategyMode: StrategyMode,
  date = chileDateString()
): string {
  return `${KEY_PREFIX}${MODE_STORAGE_SLUG[strategyMode]}_${date}`;
}

/** @deprecated Use builderStorageKey */
export function parlayStorageKey(
  strategyMode: StrategyMode,
  date = chileDateString()
): string {
  return builderStorageKey(strategyMode, date);
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Drop legacy keys and cache older than ~14 days. */
export function cleanupExpiredParlays(today = chileDateString()): void {
  if (!canUseStorage()) return;

  const keepFrom = chileDateOffset(-1, today);
  const keepTo = chileDateOffset(14, today);

  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;

    if (LEGACY_PREFIXES.some((p) => key.startsWith(p))) {
      toRemove.push(key);
      continue;
    }
    if (!key.startsWith(KEY_PREFIX)) continue;

    const datePart = key.slice(key.lastIndexOf("_") + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      toRemove.push(key);
      continue;
    }
    if (datePart < keepFrom || datePart > keepTo) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    localStorage.removeItem(key);
  }
}

export function loadStoredParlay(
  strategyMode: StrategyMode,
  date = chileDateString()
): StoredParlayPayload | null {
  if (!canUseStorage()) return null;
  if (strategyMode !== "daily-fun" && strategyMode !== "monopoly-asymmetry") {
    return null;
  }

  try {
    const raw = localStorage.getItem(builderStorageKey(strategyMode, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBuilderPayload;
    if (
      !parsed ||
      parsed.kind !== "parlay" ||
      parsed.date !== date ||
      parsed.strategyMode !== strategyMode ||
      !Array.isArray(parsed.parlay?.legs) ||
      parsed.parlay.legs.length === 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function loadStoredSafePicks(
  date = chileDateString()
): StoredSafePicksPayload | null {
  if (!canUseStorage()) return null;

  try {
    const raw = localStorage.getItem(builderStorageKey("daily-safe", date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBuilderPayload;
    if (
      !parsed ||
      parsed.kind !== "safe-picks" ||
      parsed.date !== date ||
      !Array.isArray(parsed.picks)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveParlay(
  strategyMode: StrategyMode,
  parlay: GeneratedParlay,
  clipboard: string,
  date = chileDateString()
): void {
  if (!canUseStorage()) return;
  if (!parlay.legs.length) return;

  const payload: StoredParlayPayload = {
    kind: "parlay",
    date,
    strategyMode,
    parlay,
    clipboard,
    savedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(
      builderStorageKey(strategyMode, date),
      JSON.stringify(payload)
    );
  } catch (err) {
    console.warn("[parlay-storage] Failed to save parlay:", err);
  }
}

export function saveSafePicks(
  picks: SafePickItem[],
  date = chileDateString()
): void {
  if (!canUseStorage()) return;

  const payload: StoredSafePicksPayload = {
    kind: "safe-picks",
    date,
    strategyMode: "daily-safe",
    picks,
    savedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(
      builderStorageKey("daily-safe", date),
      JSON.stringify(payload)
    );
  } catch (err) {
    console.warn("[parlay-storage] Failed to save safe picks:", err);
  }
}

export function clearStoredParlay(
  strategyMode: StrategyMode,
  date = chileDateString()
): void {
  if (!canUseStorage()) return;
  localStorage.removeItem(builderStorageKey(strategyMode, date));
}
