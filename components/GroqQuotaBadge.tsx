"use client";

import { cn } from "@/lib/utils";
import { formatDurationShort, msUntilUtcMidnight } from "@/lib/api-rate-limit-cooldown";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "parleylab_groq_quota_v1";
/** Poll / stale window — no focus revalidate. */
const STALE_MS = 60_000;

type QuotaState = {
  date: string;
  used: number;
  limit: number;
  remaining: number;
  configured: boolean;
};

let moduleCache: { at: number; data: QuotaState } | null = null;
let inflight: Promise<QuotaState | null> | null = null;

function readLocal(): QuotaState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuotaState>;
    if (
      typeof parsed?.date !== "string" ||
      typeof parsed?.used !== "number" ||
      typeof parsed?.limit !== "number"
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
      configured: parsed.configured !== false,
    };
  } catch {
    return null;
  }
}

function writeLocal(state: QuotaState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

async function fetchGroqQuota(opts?: {
  force?: boolean;
}): Promise<QuotaState | null> {
  const now = Date.now();
  if (!opts?.force && moduleCache && now - moduleCache.at < STALE_MS) {
    return moduleCache.data;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/quota/groq", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return moduleCache?.data ?? null;
      const limit = Number(data.limit) || 14_400;
      const remaining =
        typeof data.remaining === "number"
          ? data.remaining
          : Math.max(0, limit - (Number(data.used) || 0));
      const next: QuotaState = {
        date: String(data.date),
        used: Number(data.used) || 0,
        limit,
        remaining,
        configured: data.configured !== false,
      };
      moduleCache = { at: Date.now(), data: next };
      writeLocal(next);
      return next;
    } catch {
      return moduleCache?.data ?? null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

function toneForRatio(remaining: number, limit: number) {
  const ratio = limit > 0 ? remaining / limit : 0;
  if (remaining <= 0 || ratio <= 0.05) {
    return {
      className: "bg-[#ff453a]/12 text-[#ff453a] ring-[#ff453a]/25",
      dotClass: "bg-[#ff453a]",
      label: "Crítica",
    };
  }
  if (ratio <= 0.15) {
    return {
      className: "bg-[#ffd60a]/12 text-[#ffd60a] ring-[#ffd60a]/25",
      dotClass: "bg-[#ffd60a]",
      label: "Baja",
    };
  }
  return {
    className: "bg-[#64d2ff]/12 text-[#64d2ff] ring-[#0a84ff]/25",
    dotClass: "bg-[#64d2ff]",
    label: "OK",
  };
}

export function GroqQuotaBadge({ className }: { className?: string }) {
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [mounted, setMounted] = useState(false);
  const [dailyResetMs, setDailyResetMs] = useState(0);
  const started = useRef(false);

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    const next = await fetchGroqQuota(opts);
    if (next) setQuota(next);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setMounted(true);
    const cached = readLocal();
    if (cached) setQuota(cached);
    if (moduleCache) setQuota(moduleCache.data);

    void refresh({ force: true });
    const id = window.setInterval(() => void refresh(), STALE_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!mounted || !quota || quota.remaining > 0) {
      setDailyResetMs(0);
      return;
    }
    setDailyResetMs(msUntilUtcMidnight());
    const id = window.setInterval(() => {
      setDailyResetMs(msUntilUtcMidnight());
    }, 1000);
    return () => window.clearInterval(id);
  }, [mounted, quota?.remaining, quota?.date]);

  if (!mounted) return null;
  if (!quota) return null;

  if (!quota.configured) {
    return (
      <span
        role="status"
        aria-label="Groq AI Judge no configurado (falta GROQ_API_KEY)."
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-xs font-medium text-neutral-400 ring-1 ring-white/10",
          className
        )}
      >
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-500" />
        <span className="hidden sm:inline">Groq: off</span>
        <span className="sm:hidden">Groq off</span>
      </span>
    );
  }

  if (quota.remaining <= 0) {
    const resetLabel = formatDurationShort(dailyResetMs);
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={`Cuota diaria Groq agotada. Se reinicia en ${resetLabel}.`}
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
          Groq 0 · reset {resetLabel}
        </span>
        <span className="sm:hidden">Groq 0</span>
      </span>
    );
  }

  const { className: tone, dotClass, label } = toneForRatio(
    quota.remaining,
    quota.limit
  );

  return (
    <span
      role="status"
      aria-label={`Cuota Groq del ${quota.date}: ${quota.used} de ${quota.limit} usadas, ${quota.remaining} restantes. Estado ${label}.`}
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
      <span className="hidden sm:inline">
        Groq: {quota.used} / {quota.limit} · {quota.remaining} restantes
      </span>
      <span className="sm:hidden">
        Groq {quota.used}/{quota.limit}
      </span>
    </span>
  );
}
