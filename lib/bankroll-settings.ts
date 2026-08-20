import type { BankrollSettings } from "@/types";
import { roundCLP } from "@/lib/utils";

export type { BankrollSettings };

export const BANKROLL_ROW_ID = "default";

export const DEFAULT_BANKROLL_SETTINGS: BankrollSettings = {
  totalBankroll: 30_000,
  currency: "CLP",
  minBookmakerStake: 75,
  maxRiskSingle: 0.02,
  maxRiskParlay: 0.01,
};

export function clampBankroll(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BANKROLL_SETTINGS.totalBankroll;
  return Math.max(0, roundCLP(value));
}

function clampRate(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) return fallback;
  return value;
}

function clampStake(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return roundCLP(value);
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

/** Row never meaningfully written (upsert defaults only). */
export function isVirginBankrollRow(row: {
  totalBankroll: number;
  currency: string;
  minBookmakerStake: number;
  maxRiskSingle: number;
  maxRiskParlay: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}): boolean {
  const d = DEFAULT_BANKROLL_SETTINGS;
  const created = new Date(row.createdAt).getTime();
  const updated = new Date(row.updatedAt).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;
  if (Math.abs(updated - created) > 2_000) return false;
  return (
    row.totalBankroll === d.totalBankroll &&
    row.currency === d.currency &&
    row.minBookmakerStake === d.minBookmakerStake &&
    row.maxRiskSingle === d.maxRiskSingle &&
    row.maxRiskParlay === d.maxRiskParlay
  );
}

export function settingsEqual(
  a: BankrollSettings,
  b: BankrollSettings
): boolean {
  return (
    a.totalBankroll === b.totalBankroll &&
    a.currency === b.currency &&
    a.minBookmakerStake === b.minBookmakerStake &&
    a.maxRiskSingle === b.maxRiskSingle &&
    a.maxRiskParlay === b.maxRiskParlay
  );
}
