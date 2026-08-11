"use client";

import { MatchCard } from "@/components/MatchCard";
import { LivePicksOverview } from "@/components/StatsOverview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  API_CONNECTION_ERROR_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
} from "@/lib/api-messages";
import type { MatchPrediction } from "@/lib/types";
import {
  formatKickoff,
  formatOdds,
  formatPercent,
  groupByKey,
} from "@/lib/utils";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function DashboardPage() {
  const [predictions, setPredictions] = useState<MatchPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmptyMessage(null);
    try {
      const res = await fetch("/api/predict");
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const code = data?.code as string | undefined;
        if (code === "EMPTY") {
          setPredictions([]);
          setEmptyMessage(
            typeof data.error === "string"
              ? data.error
              : EMPTY_MATCHES_MESSAGE
          );
          return;
        }
        setPredictions([]);
        setError(
          typeof data.error === "string"
            ? data.error
            : API_CONNECTION_ERROR_MESSAGE
        );
        return;
      }

      setPredictions(data.predictions ?? []);
      if ((data.predictions ?? []).length === 0) {
        setEmptyMessage(EMPTY_MATCHES_MESSAGE);
      }
    } catch {
      setPredictions([]);
      setError(API_CONNECTION_ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const safePicks = useMemo(
    () =>
      predictions
        .flatMap((p) =>
          p.markets
            .filter((m) => m.isSafePick)
            .map((m) => ({ prediction: p, market: m }))
        )
        .sort((a, b) => b.market.edge - a.market.edge),
    [predictions]
  );

  const avgEdge = useMemo(() => {
    if (safePicks.length === 0) return 0;
    return (
      safePicks.reduce((s, p) => s + p.market.edge, 0) / safePicks.length
    );
  }, [safePicks]);

  const safePicksByLeague = useMemo(
    () =>
      groupByKey(safePicks.slice(0, 10), (p) => p.prediction.match.leagueName).map(
        (group) => ({
          ...group,
          items: [...group.items].sort(
            (a, b) =>
              new Date(a.prediction.match.kickoff).getTime() -
              new Date(b.prediction.match.kickoff).getTime()
          ),
        })
      ),
    [safePicks]
  );

  const predictionsByLeague = useMemo(
    () =>
      groupByKey(predictions, (p) => p.match.leagueName).map((group) => ({
        ...group,
        items: [...group.items].sort(
          (a, b) =>
            new Date(a.match.kickoff).getTime() -
            new Date(b.match.kickoff).getTime()
        ),
      })),
    [predictions]
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="info">Hoy / próximos días · hora Chile</Badge>
            <Badge variant="success">data: live</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">
            Dashboard de Safe Picks
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Probabilidades Poisson + Dixon-Coles sobre fixtures reales de
            API-Football. Filtro: modelo ≥ 80% y cuotas entre 1.15–1.35.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Actualizar
          </Button>
          <Link href="/builder">
            <Button>Generar Combinada</Button>
          </Link>
        </div>
      </div>

      {error && (
        <Card className="border-rose-500/40 bg-rose-950/20">
          <CardContent className="p-4 text-sm text-rose-300">
            {error}
          </CardContent>
        </Card>
      )}

      {!loading && !error && emptyMessage && (
        <Card className="border-sky-500/20 bg-gradient-to-br from-slate-900/80 to-slate-950/90">
          <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <p className="text-base font-medium text-slate-200">
              {emptyMessage}
            </p>
          </CardContent>
        </Card>
      )}

      {!error && (
        <LivePicksOverview
          safePickCount={safePicks.length}
          matchCount={predictions.length}
          avgEdge={avgEdge}
        />
      )}

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <h2 className="text-xl font-semibold text-slate-50">
            Top Safe Picks
          </h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Cargando fixtures live…
          </div>
        ) : error ? null : safePicks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-slate-400">
              {emptyMessage ?? "No hay safe picks con los filtros actuales."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {safePicksByLeague.map((group) => (
              <div key={group.key} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                    {group.key}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {group.items.length} pick
                    {group.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {group.items.map(({ prediction, market }) => (
                    <Card
                      key={`${prediction.matchId}-${market.market}`}
                      className="border-emerald-500/10"
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <CardDescription>
                              {formatKickoff(prediction.match.kickoff)}
                            </CardDescription>
                            <CardTitle className="mt-1">
                              {prediction.match.home.name} vs{" "}
                              {prediction.match.away.name}
                            </CardTitle>
                          </div>
                          <Badge variant="success">
                            {formatPercent(market.modelProbability)}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="flex items-end justify-between gap-3">
                        <div>
                          <p className="text-sm text-slate-200">
                            {market.label}
                          </p>
                          <p className="text-xs text-slate-500">
                            Edge {formatPercent(market.edge)} · xG{" "}
                            {prediction.expectedGoals.home.toFixed(2)}–
                            {prediction.expectedGoals.away.toFixed(2)}
                          </p>
                        </div>
                        <p className="font-mono text-2xl font-bold text-emerald-300">
                          @{formatOdds(market.odds)}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {!loading && !error && predictions.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-slate-50">
            Partidos analizados
          </h2>
          {predictionsByLeague.map((group) => (
            <div key={group.key} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  {group.key}
                </h3>
                <span className="text-xs text-slate-500">
                  {group.items.length} partido
                  {group.items.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {group.items.map((p) => (
                  <MatchCard key={p.matchId} prediction={p} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
