"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  addBetFromSinglePick,
  collectRegisteredIndividualPickKeys,
  findExistingSinglePick,
  individualPickKey,
  loadBets,
  saveBets,
  type HistoryBet,
} from "@/lib/history-tracker";
import { contextBadgeLabels } from "@/lib/context-engine";
import type { SafePickItem } from "@/lib/parlay-storage";
import {
  formatExplicitBetLine,
  getExplicitPickFromLeg,
} from "@/lib/formatters";
import {
  formatKickoffTime,
  formatOdds,
  formatPercent,
  groupByKey,
  UNIT_STAKE,
} from "@/lib/utils";
import { formatValueBadge } from "@/lib/value-finder";
import {
  AlertTriangle,
  Check,
  Flame,
  Lightbulb,
  Loader2,
  Pin,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface SafePicksListProps {
  picks: SafePickItem[];
  date: string;
  loading?: boolean;
  fromCache?: boolean;
  onRefresh?: () => void;
}

export function SafePicksList({
  picks,
  date,
  loading = false,
  fromCache = false,
  onRefresh,
}: SafePicksListProps) {
  const [registeredKeys, setRegisteredKeys] = useState<Set<string>>(
    () => new Set()
  );

  const grouped = useMemo(() => {
    return groupByKey(picks, (p) => p.leagueName || "Otros").map((g) => ({
      ...g,
      items: [...g.items].sort(
        (a, b) =>
          new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
      ),
    }));
  }, [picks]);

  function pickKey(p: SafePickItem) {
    return individualPickKey(p.matchId, p.market);
  }

  useEffect(() => {
    setRegisteredKeys(collectRegisteredIndividualPickKeys(picks));

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stats/summary", { cache: "no-store" });
        const data = (await res.json()) as {
          success?: boolean;
          tickets?: HistoryBet[];
        };
        if (!res.ok || !data.success || cancelled) return;
        const tickets = data.tickets ?? [];
        if (tickets.length === 0) return;
        const fromDb = collectRegisteredIndividualPickKeys(picks, tickets);
        setRegisteredKeys((prev) => {
          const next = new Set(prev);
          for (const key of fromDb) next.add(key);
          return next;
        });
      } catch {
        // localStorage already applied
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [picks]);

  async function handleRegister(pick: SafePickItem) {
    const already = findExistingSinglePick(pick);
    const local = addBetFromSinglePick(pick, UNIT_STAKE, date);
    if (!local) return;
    setRegisteredKeys((prev) => new Set(prev).add(pickKey(pick)));
    if (already) return;

    try {
      const res = await fetch("/api/bets/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          strategyMode: "daily-safe",
          mode: "Segura",
          stakeCLP: UNIT_STAKE,
          totalOdds: pick.odds,
          payoutCLP: UNIT_STAKE * pick.odds,
          legs: [
            {
              matchId: pick.matchId,
              matchLabel: pick.matchLabel,
              leagueName: pick.leagueName,
              kickoff: pick.kickoff,
              market: pick.market,
              marketLabel: pick.marketLabel,
              odds: pick.odds,
              modelProbability: pick.modelProbability,
            },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && typeof data.ticketId === "string") {
        const bets = loadBets().map((b) =>
          b.id === local.id ? { ...b, id: data.ticketId as string } : b
        );
        saveBets(bets);
      }
    } catch {
      // Local registration already applied
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-50">
              <Target className="h-5 w-5 text-emerald-300" aria-hidden />
              Picks seguros individuales
            </h2>
            <CardDescription>
              {date} · modelo ≥ 85% · {picks.length} selección
              {picks.length === 1 ? "" : "es"} · referencia 1U
            </CardDescription>
            {fromCache && (
              <p role="status" className="mt-2 text-sm text-sky-200">
                Lista recuperada de caché para esta fecha.
              </p>
            )}
          </div>
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              aria-busy={loading}
              aria-label={loading ? "Actualizando picks" : "Actualizar picks"}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {loading ? "Actualizando…" : "Actualizar"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {picks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-600 p-6 text-center text-sm text-slate-200">
            No hay picks con probabilidad modelo ≥ 85% para esta fecha.
          </p>
        ) : (
          <div className="max-h-[36rem] space-y-5 overflow-y-auto pr-1">
            {grouped.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-md border border-slate-600 bg-[var(--background-elevated)] px-2.5 py-1.5">
                  <p className="text-sm font-semibold text-slate-100">
                    {group.key}
                  </p>
                  <span className="text-xs text-slate-300">
                    {group.items.length} pick
                    {group.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.items.map((pick) => {
                    const key = pickKey(pick);
                    const registered = registeredKeys.has(key);
                    const valueBadge = formatValueBadge(pick.edge);
                    const explicit = getExplicitPickFromLeg(pick);
                    return (
                      <li
                        key={key}
                        className="rounded-xl border border-slate-600 bg-slate-950/50 p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium text-slate-50">
                              {pick.matchLabel}
                              <span className="ml-2 text-xs font-normal text-slate-300">
                                {formatKickoffTime(pick.kickoff)} CL
                              </span>
                            </p>
                            <p className="text-sm text-slate-100">
                              Apuesta: {formatExplicitBetLine(explicit)}
                              <span className="mx-1.5 text-slate-400">·</span>
                              <span className="font-mono text-emerald-200">
                                @{formatOdds(pick.odds)}
                              </span>
                            </p>
                            <p
                              className="text-xs leading-snug text-slate-300"
                              title={explicit.condition}
                            >
                              Condición: {explicit.condition}
                            </p>
                            <p className="text-xs leading-snug text-sky-200">
                              {explicit.bookmakerTab}
                            </p>
                            <p className="flex items-start gap-1.5 text-xs leading-snug text-amber-100">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                              <span>{explicit.warningNote}</span>
                            </p>
                            {explicit.cupEquivalent ? (
                              <p className="flex items-start gap-1.5 text-xs leading-snug text-emerald-100">
                                <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                                <span>{explicit.cupEquivalent}</span>
                              </p>
                            ) : null}
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              <Badge variant="success">
                                {formatPercent(pick.modelProbability)}{" "}
                                Probabilidad
                              </Badge>
                              <Badge variant="info">
                                Edge {formatPercent(pick.edge)}
                              </Badge>
                              {contextBadgeLabels(pick.contextFlags)
                                .slice(0, 3)
                                .map((label) => (
                                  <Badge
                                    key={label}
                                    variant="default"
                                    className="font-normal"
                                  >
                                    {label}
                                  </Badge>
                                ))}
                              {valueBadge && (
                                <Badge variant="warning" className="gap-1">
                                  <Flame className="h-3 w-3 text-amber-400" />
                                  {valueBadge}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-stretch gap-1 sm:items-end">
                            <Button
                              size="sm"
                              variant={registered ? "secondary" : "default"}
                              disabled={registered}
                              onClick={() => handleRegister(pick)}
                            >
                              {registered ? (
                                <>
                                  <Check className="h-3.5 w-3.5" aria-hidden /> Registrado
                                </>
                              ) : (
                                <>
                                  <Pin className="h-3.5 w-3.5" aria-hidden />
                                  Registrar pick en historial
                                </>
                              )}
                            </Button>
                            {registered && (
                              <Link
                                href="/stats"
                                className="inline-flex min-h-11 items-center justify-center text-center text-sm text-emerald-200 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                              >
                                Ver en Estadísticas
                              </Link>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
