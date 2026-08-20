"use client";

import { cn } from "@/lib/utils";
import {
  formatDurationShort,
  msUntilUtcMidnight,
  useApiRateLimitCooldown,
} from "@/lib/api-rate-limit-cooldown";
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
      className: "bg-[#ff453a]/12 text-[#ff453a] ring-[#ff453a]/25",
      dotClass: "bg-[#ff453a]",
      label: "Crítica",
    };
  }
  if (remaining <= 20) {
    return {
      className: "bg-[#ffd60a]/12 text-[#ffd60a] ring-[#ffd60a]/25",
      dotClass: "bg-[#ffd60a]",
      label: "Baja",
    };
  }
  return {
    className: "bg-[#30d158]/12 text-[#30d158] ring-[#30d158]/25",
    dotClass: "bg-[#30d158]",
    label: "OK",
  };
}

export function ApiQuotaBadge({ className }: { className?: string }) {
  // Always null on first render (SSR + client) to avoid hydration mismatch
  // from localStorage. Populate after mount.
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [mounted, setMounted] = useState(false);
  const [dailyResetMs, setDailyResetMs] = useState(0);
  const cooldown = useApiRateLimitCooldown();

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

  useEffect(() => {
    if (!mounted) return;
    setDailyResetMs(msUntilUtcMidnight());
    const id = window.setInterval(() => {
      setDailyResetMs(msUntilUtcMidnight());
    }, 1000);
    return () => window.clearInterval(id);
  }, [mounted]);

  if (!mounted) return null;

  if (cooldown.isCoolingDown) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={`Límite por minuto del plan Free. Podrás generar de nuevo en ${cooldown.label}.`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-[#ffd60a]/12 px-2.5 py-1 text-xs font-medium tabular-nums text-[#ffd60a] ring-1 ring-[#ffd60a]/25",
          className
        )}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#ffd60a]"
        />
        <span className="hidden sm:inline">
          Plan Free · listo en {cooldown.label}
        </span>
        <span className="sm:hidden">Listo en {cooldown.label}</span>
      </span>
    );
  }

  if (!quota) return null;

  const resetLabel = formatDurationShort(dailyResetMs);

  if (quota.remaining <= 0) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={`Cuota diaria agotada. Se reinicia en ${resetLabel} (medianoche UTC).`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-[#ff453a]/12 px-2.5 py-1 text-xs font-medium tabular-nums text-[#ff453a] ring-1 ring-[#ff453a]/25",
          className
        )}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#ff453a]"
        />
        <span className="hidden sm:inline">
          Cupo diario 0 · reset en {resetLabel}
        </span>
        <span className="sm:hidden">Reset en {resetLabel}</span>
      </span>
    );
  }

  const { className: tone, dotClass, label } = toneForRemaining(
    quota.remaining
  );

  return (
    <span
      role="status"
      aria-label={`Cuota oficial API-Football del ${quota.date}: ${quota.used} de ${quota.limit} usadas (${quota.remaining} restantes). Se reinicia en ${resetLabel} (medianoche UTC). Estado ${label}.`}
      title={`API ${quota.used}/${quota.limit} · ${quota.remaining} restantes`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ring-1",
        tone,
        className
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)}
      />
      <span>Reset en {resetLabel}</span>
    </span>
  );
}
