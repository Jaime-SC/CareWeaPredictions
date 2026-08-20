"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { API_RATE_LIMIT_MESSAGE } from "@/lib/api-messages";

/** Matches server Free-plan cooldown after HTTP 429 (10 req/min). */
export const API_RATE_LIMIT_COOLDOWN_MS = 60_000;

const STORAGE_KEY = "parleylab_api_rate_cooldown_v1";
const EVENT_NAME = "parleylab:api-rate-cooldown";

type CooldownPayload = {
  readyAt: number;
};

function readReadyAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Partial<CooldownPayload>;
    const readyAt = Number(parsed?.readyAt);
    if (!Number.isFinite(readyAt) || readyAt <= Date.now()) {
      if (readyAt > 0 && readyAt <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
      }
      return 0;
    }
    return readyAt;
  } catch {
    return 0;
  }
}

function writeReadyAt(readyAt: number) {
  if (typeof window === "undefined") return;
  try {
    if (readyAt <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ readyAt }));
    }
  } catch {
    /* ignore private mode */
  }
  window.dispatchEvent(new Event(EVENT_NAME));
}

/** Start or extend cooldown until `now + durationMs` (keeps the later readyAt). */
export function startApiRateLimitCooldown(
  durationMs: number = API_RATE_LIMIT_COOLDOWN_MS
): number {
  const nextReadyAt = Date.now() + Math.max(0, durationMs);
  const current = readReadyAt();
  const readyAt = Math.max(current, nextReadyAt);
  writeReadyAt(readyAt);
  return readyAt;
}

export function clearApiRateLimitCooldown() {
  writeReadyAt(0);
}

export function getApiRateLimitReadyAt(): number {
  return readReadyAt();
}

export function remainingCooldownMs(now = Date.now()): number {
  return Math.max(0, readReadyAt() - now);
}

/** mm:ss for UI countdowns. */
export function formatCountdown(totalSeconds: number): string {
  const sec = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Hours/minutes until next UTC midnight (API-Football daily reset). */
export function msUntilUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return Math.max(0, next - now);
}

export function formatDurationShort(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}:${s.toString().padStart(2, "0")}`;
  return `0:${s.toString().padStart(2, "0")}`;
}

export function isApiRateLimitFailure(
  status: number,
  error?: string | null
): boolean {
  if (status === 429) return true;
  if (!error) return false;
  const msg = error.toLowerCase();
  return (
    error === API_RATE_LIMIT_MESSAGE ||
    msg.includes("peticiones por minuto") ||
    msg.includes("10/min") ||
    msg.includes("too many requests") ||
    msg.includes("rate limit")
  );
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) onStoreChange();
  };
  window.addEventListener(EVENT_NAME, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot() {
  return 0;
}

/**
 * Live countdown for Free-plan per-minute lockout.
 * Also exposes helpers to arm the cooldown from API responses.
 */
export function useApiRateLimitCooldown() {
  const readyAt = useSyncExternalStore(
    subscribe,
    readReadyAt,
    getServerSnapshot
  );
  const [now, setNow] = useState(() =>
    typeof window === "undefined" ? 0 : Date.now()
  );

  useEffect(() => {
    setNow(Date.now());
    if (readyAt <= Date.now()) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (readyAt <= t) {
        writeReadyAt(0);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [readyAt]);

  const remainingMs = Math.max(0, readyAt - now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const isCoolingDown = remainingMs > 0;

  const arm = useCallback((durationMs?: number) => {
    startApiRateLimitCooldown(durationMs);
  }, []);

  const armFromResponse = useCallback(
    (status: number, error?: string | null) => {
      if (isApiRateLimitFailure(status, error)) {
        startApiRateLimitCooldown();
        return true;
      }
      return false;
    },
    []
  );

  return {
    readyAt,
    remainingMs,
    remainingSec,
    isCoolingDown,
    label: isCoolingDown ? formatCountdown(remainingSec) : null,
    arm,
    armFromResponse,
    clear: clearApiRateLimitCooldown,
  };
}
