import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { BankrollSettings } from "@/types";
import {
  DEFAULT_BANKROLL_SETTINGS,
  parseBankrollSettings,
  settingsEqual,
  clampBankroll,
} from "@/lib/bankroll-settings";
import { roundCLP } from "@/lib/utils";

export type { BankrollSettings };
export {
  DEFAULT_BANKROLL_SETTINGS,
  parseBankrollSettings,
} from "@/lib/bankroll-settings";

const STORAGE_KEY = "parleylab_bankroll_settings_v1";
const CHANGE_EVENT = "parleylab:bankroll-change";
const API_PATH = "/api/bankroll";

let cachedRaw: string | null | undefined;
let cachedSettings: BankrollSettings = DEFAULT_BANKROLL_SETTINGS;
let hydrateStarted = false;
let syncGen = 0;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readRaw(): string | null {
  if (!canUseStorage()) return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function settingsFromRaw(raw: string | null): BankrollSettings {
  if (!raw) return DEFAULT_BANKROLL_SETTINGS;
  try {
    return parseBankrollSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_BANKROLL_SETTINGS;
  }
}

function getClientSnapshot(): BankrollSettings {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedSettings;
  cachedRaw = raw;
  cachedSettings = settingsFromRaw(raw);
  return cachedSettings;
}

function getServerSnapshot(): BankrollSettings {
  return DEFAULT_BANKROLL_SETTINGS;
}

function emitChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function persistLocal(next: BankrollSettings): BankrollSettings {
  const normalized = parseBankrollSettings(next);
  cachedSettings = normalized;
  cachedRaw = JSON.stringify(normalized);
  if (canUseStorage()) {
    try {
      localStorage.setItem(STORAGE_KEY, cachedRaw);
    } catch (err) {
      console.warn("[bankroll-store] Failed to persist settings:", err);
    }
  }
  emitChange();
  return normalized;
}

async function fetchJson(
  init?: RequestInit
): Promise<{
  ok: boolean;
  status: number;
  body: {
    success?: boolean;
    virgin?: boolean;
    settings?: BankrollSettings;
    reason?: string;
    error?: string;
  };
}> {
  const res = await fetch(API_PATH, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    virgin?: boolean;
    settings?: BankrollSettings;
    reason?: string;
    error?: string;
  };
  return { ok: res.ok, status: res.status, body };
}

function applyRemoteSettings(settings: BankrollSettings): BankrollSettings {
  return persistLocal(parseBankrollSettings(settings));
}

async function rehydrateFromServer(): Promise<void> {
  try {
    const { ok, body } = await fetchJson();
    if (ok && body.settings) applyRemoteSettings(body.settings);
  } catch (err) {
    console.warn("[bankroll-store] Rehydrate failed:", err);
  }
}

/**
 * Write-through to Neon. On failure, re-hydrate from server so local
 * does not drift permanently from source of truth.
 */
async function syncPatch(
  payload: Record<string, unknown>
): Promise<BankrollSettings | null> {
  const gen = ++syncGen;
  try {
    const { ok, status, body } = await fetchJson({
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (gen !== syncGen) return null;
    if (ok && body.settings) {
      return applyRemoteSettings(body.settings);
    }
    if (body.settings) {
      applyRemoteSettings(body.settings);
    } else {
      await rehydrateFromServer();
    }
    console.warn(
      "[bankroll-store] Sync failed:",
      body.error ?? `HTTP ${status}`
    );
    return null;
  } catch (err) {
    console.warn("[bankroll-store] Sync error:", err);
    if (gen === syncGen) await rehydrateFromServer();
    return null;
  }
}

async function syncPut(settings: BankrollSettings): Promise<void> {
  const gen = ++syncGen;
  try {
    const { ok, body } = await fetchJson({
      method: "PUT",
      body: JSON.stringify(settings),
    });
    if (gen !== syncGen) return;
    if (ok && body.settings) {
      applyRemoteSettings(body.settings);
      return;
    }
    console.warn("[bankroll-store] PUT failed:", body.error);
    await rehydrateFromServer();
  } catch (err) {
    console.warn("[bankroll-store] PUT error:", err);
    if (gen === syncGen) await rehydrateFromServer();
  }
}

/** One-shot hydrate: Neon wins unless virgin row + local differs → seed. */
export async function hydrateBankrollFromServer(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const local = getClientSnapshot();
    const hadLocalKey = canUseStorage() && localStorage.getItem(STORAGE_KEY) != null;
    const { ok, body } = await fetchJson();
    if (!ok || !body.settings) return;

    const remote = parseBankrollSettings(body.settings);
    if (body.virgin && hadLocalKey && !settingsEqual(local, remote)) {
      await syncPut(local);
      return;
    }
    applyRemoteSettings(remote);
  } catch (err) {
    console.warn("[bankroll-store] Hydrate failed:", err);
  }
}

function ensureHydrate(): void {
  if (hydrateStarted || typeof window === "undefined") return;
  hydrateStarted = true;
  void hydrateBankrollFromServer();
}

export function loadBankrollSettings(): BankrollSettings {
  return getClientSnapshot();
}

export function saveBankrollSettings(
  patch: Partial<BankrollSettings>
): BankrollSettings {
  const current = getClientSnapshot();
  const next = persistLocal({ ...current, ...patch });
  void syncPatch({ op: "patch", ...patch });
  return next;
}

export function setTotalBankroll(amountCLP: number): BankrollSettings {
  const next = persistLocal({
    ...getClientSnapshot(),
    totalBankroll: clampBankroll(amountCLP),
  });
  void syncPatch({ op: "set", totalBankroll: next.totalBankroll });
  return next;
}

export function adjustBankroll(deltaCLP: number): BankrollSettings {
  const delta = roundCLP(deltaCLP);
  const current = getClientSnapshot();
  const next = persistLocal({
    ...current,
    totalBankroll: clampBankroll(current.totalBankroll + delta),
  });
  void syncPatch({ op: "adjust", delta });
  return next;
}

export type DebitBankrollResult =
  | { ok: true; remaining: number }
  | { ok: false; remaining: number; reason: "invalid" | "insufficient" };

/** Resta el stake al colocar un ticket. No deja la banca en negativo. */
export function debitBankroll(amountCLP: number): DebitBankrollResult {
  const amount = roundCLP(amountCLP);
  const remaining = getClientSnapshot().totalBankroll;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, remaining, reason: "invalid" };
  }
  if (amount > remaining) {
    return { ok: false, remaining, reason: "insufficient" };
  }
  const next = persistLocal({
    ...getClientSnapshot(),
    totalBankroll: remaining - amount,
  });
  void syncPatch({ op: "debit", amount });
  return { ok: true, remaining: next.totalBankroll };
}

/** Devuelve el stake si se cancela un ticket pendiente o anulado. */
export function refundBankroll(amountCLP: number): BankrollSettings {
  const amount = roundCLP(amountCLP);
  if (!Number.isFinite(amount) || amount <= 0) {
    return getClientSnapshot();
  }
  const current = getClientSnapshot();
  const next = persistLocal({
    ...current,
    totalBankroll: clampBankroll(current.totalBankroll + amount),
  });
  void syncPatch({ op: "refund", amount });
  return next;
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  ensureHydrate();
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onStoreChange();
  };
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useBankrollSettings(): BankrollSettings {
  const settings = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot
  );
  useEffect(() => {
    ensureHydrate();
  }, []);
  return settings;
}

export function useBankroll(): {
  settings: BankrollSettings;
  setTotalBankroll: (amountCLP: number) => void;
  adjustBankroll: (deltaCLP: number) => void;
  saveSettings: (patch: Partial<BankrollSettings>) => void;
} {
  const settings = useBankrollSettings();
  const setTotal = useCallback((amountCLP: number) => {
    setTotalBankroll(amountCLP);
  }, []);
  const adjust = useCallback((deltaCLP: number) => {
    adjustBankroll(deltaCLP);
  }, []);
  const save = useCallback((patch: Partial<BankrollSettings>) => {
    saveBankrollSettings(patch);
  }, []);
  return {
    settings,
    setTotalBankroll: setTotal,
    adjustBankroll: adjust,
    saveSettings: save,
  };
}
