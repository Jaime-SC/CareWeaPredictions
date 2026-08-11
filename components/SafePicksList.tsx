"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { addBetFromSinglePick } from "@/lib/history-tracker";
import type { SafePickItem } from "@/lib/parlay-storage";
import {
  formatCLP,
  formatKickoffTime,
  formatOdds,
  formatPercent,
  groupByKey,
} from "@/lib/utils";
import { Check, Loader2, Pin } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

interface SafePicksListProps {
  picks: SafePickItem[];
  date: string;
  loading?: boolean;
  fromCache?: boolean;
  onRefresh?: () => void;
  stakeCLP?: number;
}

export function SafePicksList({
  picks,
  date,
  loading = false,
  fromCache = false,
  onRefresh,
  stakeCLP = 1000,
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
    return `${p.matchId}:${p.market}`;
  }

  function handleRegister(pick: SafePickItem) {
    const bet = addBetFromSinglePick(pick, stakeCLP, date);
    if (!bet) return;
    setRegisteredKeys((prev) => new Set(prev).add(pickKey(pick)));
  }

  return (
    <Card className="border-emerald-500/20 bg-gradient-to-b from-slate-900 to-slate-950">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg">
              🎯 Picks Seguros Individuales
            </CardTitle>
            <CardDescription>
              {date} · modelo ≥ 85% · {picks.length} selección
              {picks.length === 1 ? "" : "es"} · stake sugerido{" "}
              {formatCLP(stakeCLP)}
            </CardDescription>
            {fromCache && (
              <p className="mt-2 text-xs text-sky-300/90">
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
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Actualizar"
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {picks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
            No hay picks con probabilidad modelo ≥ 85% para esta fecha.
          </p>
        ) : (
          <div className="max-h-[36rem] space-y-5 overflow-y-auto pr-1">
            {grouped.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/95 px-2.5 py-1.5 backdrop-blur">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    {group.key}
                  </h3>
                  <span className="text-[10px] text-slate-500">
                    {group.items.length} pick
                    {group.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.items.map((pick) => {
                    const key = pickKey(pick);
                    const registered = registeredKeys.has(key);
                    return (
                      <li
                        key={key}
                        className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium text-slate-100">
                              {pick.matchLabel}
                              <span className="ml-2 text-xs font-normal text-slate-500">
                                {formatKickoffTime(pick.kickoff)} CL
                              </span>
                            </p>
                            <p className="text-xs text-slate-400">
                              {pick.marketLabel}
                              <span className="mx-1.5 text-slate-600">·</span>
                              <span className="font-mono text-emerald-300">
                                @{formatOdds(pick.odds)}
                              </span>
                            </p>
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              <Badge variant="success">
                                {formatPercent(pick.modelProbability)}{" "}
                                Probabilidad
                              </Badge>
                              <Badge variant="info">
                                Edge {formatPercent(pick.edge)}
                              </Badge>
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
                                  <Check className="h-3.5 w-3.5" /> Registrado
                                </>
                              ) : (
                                <>
                                  <Pin className="h-3.5 w-3.5" /> 📌 Registrar
                                  Pick en Historial
                                </>
                              )}
                            </Button>
                            {registered && (
                              <Link
                                href="/stats"
                                className="text-center text-[11px] text-emerald-400 underline-offset-2 hover:underline"
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
