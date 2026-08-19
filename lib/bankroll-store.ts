import { useCallback, useSyncExternalStore } from "react";

export interface BankrollSettings {
  totalBankroll: number;
  currency: string;
  minBookmakerStake: number;
  maxRiskSingle: number;
  maxRiskParlay: number;
}

export const DEFAULT_BANKROLL_SETTINGS: BankrollSettings = {
  totalBankroll: 30_000,
  currency: "CLP",
  minBookmakerStake: 75,
  maxRiskSingle: 0.02,
  maxRiskParlay: 0.01,
};

const STORAGE_KEY = "parleylab_bankroll_settings_v1";
const CHANGE_EVENT = "parleylab:bankroll-change";

let cachedRaw: string | null | undefined;
let cachedSettings: BankrollSettings = DEFAULT_BANKROLL_SETTINGS;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function clampBankroll(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BANKROLL_SETTINGS.totalBankroll;
  return Math.max(0, Math.round(value));
}

function clampRate(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) return fallback;
  return value;
}

function clampStake(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.round(value);
}

export function parseBankrollSettings(raw: unknown): BankrollSettings {
  const src =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    totalBankroll: clampBankroll(
      typeof src.totalBankroll === "number"
        ? src.totalBankroll
        : DEFAULT_BANKROLL_SETTINGS.totalBankroll
    ),
    currency:
      typeof src.currency === "string" && src.currency.trim()
        ? src.currency.trim().toUpperCase()
        : DEFAULT_BANKROLL_SETTINGS.currency,
    minBookmakerStake: clampStake(
      typeof src.minBookmakerStake === "number"
        ? src.minBookmakerStake
        : DEFAULT_BANKROLL_SETTINGS.minBookmakerStake,
      DEFAULT_BANKROLL_SETTINGS.minBookmakerStake
    ),
    maxRiskSingle: clampRate(
      typeof src.maxRiskSingle === "number"
        ? src.maxRiskSingle
        : DEFAULT_BANKROLL_SETTINGS.maxRiskSingle,
      DEFAULT_BANKROLL_SETTINGS.maxRiskSingle
    ),
    maxRiskParlay: clampRate(
      typeof src.maxRiskParlay === "number"
        ? src.maxRiskParlay
        : DEFAULT_BANKROLL_SETTINGS.maxRiskParlay,
      DEFAULT_BANKROLL_SETTINGS.maxRiskParlay
    ),
  };
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

function persist(next: BankrollSettings): BankrollSettings {
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

export function loadBankrollSettings(): BankrollSettings {
  return getClientSnapshot();
}

export function saveBankrollSettings(
  patch: Partial<BankrollSettings>
): BankrollSettings {
  const current = getClientSnapshot();
  return persist({ ...current, ...patch });
}

export function setTotalBankroll(amountCLP: number): BankrollSettings {
  return saveBankrollSettings({ totalBankroll: clampBankroll(amountCLP) });
}

export function adjustBankroll(deltaCLP: number): BankrollSettings {
  const current = getClientSnapshot();
  return setTotalBankroll(current.totalBankroll + deltaCLP);
}

export type DebitBankrollResult =
  | { ok: true; remaining: number }
  | { ok: false; remaining: number; reason: "invalid" | "insufficient" };

/** Resta el stake al colocar un ticket. No deja la banca en negativo. */
export function debitBankroll(amountCLP: number): DebitBankrollResult {
  const amount = Math.round(amountCLP);
  const remaining = getClientSnapshot().totalBankroll;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, remaining, reason: "invalid" };
  }
  if (amount > remaining) {
    return { ok: false, remaining, reason: "insufficient" };
  }
  const next = setTotalBankroll(remaining - amount);
  return { ok: true, remaining: next.totalBankroll };
}

/** Devuelve el stake si se cancela un ticket pendiente o anulado. */
export function refundBankroll(amountCLP: number): BankrollSettings {
  const amount = Math.round(amountCLP);
  if (!Number.isFinite(amount) || amount <= 0) {
    return getClientSnapshot();
  }
  return adjustBankroll(amount);
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
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
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
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
