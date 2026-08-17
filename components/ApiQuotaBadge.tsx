"use client";

import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "parleylab_api_quota_v2";
const POLL_MS = 60_000;

type QuotaState = {
  date: string;
  used: number;
  limit: number;
  remaining: number;
  fromHeaders?: boolean;
};

function readLocal(): QuotaState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuotaState>;
    if (
      typeof parsed?.date !== "string" ||
      typeof parsed?.used !== "number" ||
      typeof parsed?.limit !== "number" ||
      !parsed.fromHeaders
    ) {
      return null;
    }
    const remaining =
      typeof parsed.remaining === "number"
        ? parsed.remaining
        : Math.max(0, parsed.limit - parsed.used);
    return {
      date: parsed.date,
      used: parsed.used,
      limit: parsed.limit,
      remaining,
      fromHeaders: true,
    };
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

function toneForRemaining(remaining: number) {
  if (remaining <= 10) {
    return {
      className: "border-rose-500/40 bg-rose-500/10 text-rose-200",
      dotClass: "bg-rose-400",
      label: "Crítica",
    };
  }
  if (remaining <= 20) {
    return {
      className: "border-amber-500/40 bg-amber-500/10 text-amber-200",
      dotClass: "bg-amber-400",
      label: "Baja",
    };
  }
  return {
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    dotClass: "bg-emerald-400",
    label: "OK",
  };
}

export function ApiQuotaBadge({ className }: { className?: string }) {
  // Always null on first render (SSR + client) to avoid hydration mismatch
  // from localStorage. Populate after mount.
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [mounted, setMounted] = useState(false);

  const refresh = useCallback(async (opts?: { sync?: boolean }) => {
    try {
      const qs = opts?.sync ? "?sync=1" : "";
      const res = await fetch(`/api/quota${qs}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return;
      const limit = Number(data.limit) || 100;
      const remaining =
        typeof data.remaining === "number"
          ? data.remaining
          : Math.max(0, limit - (Number(data.used) || 0));
      const next: QuotaState = {
        date: String(data.date),
        used: Number(data.used) || 0,
        limit,
        remaining,
        fromHeaders: Boolean(data.fromHeaders),
      };
      // Ignore stale local ++ counter until headers sync lands
      if (!next.fromHeaders) return;
      setQuota(next);
      writeLocal(next);
    } catch {
      /* keep last known local mirror */
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    const cached = readLocal();
    if (cached?.fromHeaders) setQuota(cached);

    void refresh({ sync: true });
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  if (!mounted || !quota) return null;

  const { className: tone, dotClass, label } = toneForRemaining(
    quota.remaining
  );

  return (
    <span
      role="status"
      aria-label={`Cuota oficial API-Football del ${quota.date}: ${quota.used} usadas, ${quota.remaining} restantes. Estado ${label}.`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium tabular-nums",
        tone,
        className
      )}
    >
      <span
        aria-hidden
        className={cn("h-2 w-2 shrink-0 rounded-full", dotClass)}
      />
      <span className="hidden sm:inline">
        API Quota: {quota.used} / {quota.limit} llamadas hoy · {quota.remaining}{" "}
        restantes
      </span>
      <span className="sm:hidden">
        API {quota.used}/{quota.limit} · {quota.remaining} restantes
      </span>
    </span>
  );
}
