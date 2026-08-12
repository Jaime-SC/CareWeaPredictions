"use client";

import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "parleylab_api_quota_today";
const POLL_MS = 60_000;

type QuotaState = {
  date: string;
  used: number;
  limit: number;
};

function readLocal(): QuotaState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuotaState;
    if (
      typeof parsed?.date !== "string" ||
      typeof parsed?.used !== "number" ||
      typeof parsed?.limit !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLocal(state: QuotaState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota mirror failures */
  }
}

export function ApiQuotaBadge({ className }: { className?: string }) {
  // Always null on first render (SSR + client) to avoid hydration mismatch
  // from localStorage. Populate after mount.
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [mounted, setMounted] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/quota", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return;
      const next: QuotaState = {
        date: String(data.date),
        used: Number(data.used) || 0,
        limit: Number(data.limit) || 100,
      };
      setQuota(next);
      writeLocal(next);
    } catch {
      /* keep last known local mirror */
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const cached = readLocal();
    if (cached) setQuota(cached);

    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  if (!mounted || !quota) return null;

  const ratio = quota.limit > 0 ? quota.used / quota.limit : 0;
  const tone =
    ratio >= 0.95
      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
      : ratio >= 0.8
        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  const dot =
    ratio >= 0.95 ? "🔴" : ratio >= 0.8 ? "🟡" : "🟢";

  return (
    <span
      title={`Cuota API-Football del ${quota.date} (solo llamadas reales; cache hits no cuentan)`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium tabular-nums sm:text-[11px]",
        tone,
        className
      )}
    >
      <span aria-hidden>{dot}</span>
      <span className="hidden sm:inline">
        API Quota: {quota.used} / {quota.limit} llamadas hoy
      </span>
      <span className="sm:hidden">
        API {quota.used}/{quota.limit}
      </span>
    </span>
  );
}
