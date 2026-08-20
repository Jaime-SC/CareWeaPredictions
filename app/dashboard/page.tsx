"use client";

import { MatchCard } from "@/components/MatchCard";
import { LivePicksOverview } from "@/components/StatsOverview";
import { SingleStakeBadge } from "@/components/stake-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  API_RATE_LIMIT_COOLDOWN_MS,
  remainingCooldownMs,
  useApiRateLimitCooldown,
} from "@/lib/api-rate-limit-cooldown";
import {
  cleanupExpiredDashboardCache,
  isDashboardCacheFresh,
  loadStoredDashboard,
  saveStoredDashboard,
} from "@/lib/dashboard-storage";
import type { MatchPrediction } from "@/lib/types";
import {
  formatKickoff,
  formatOdds,
  formatPercent,
  sortByKickoffDesc,
} from "@/lib/utils";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function DashboardPage() {
  const [predictions, setPredictions] = useState<MatchPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const {
    isCoolingDown,
    label: cooldownLabel,
    arm: armRateCooldown,
    armFromResponse: armRateLimitFromResponse,
  } = useApiRateLimitCooldown();

  const hasPaintedRef = useRef(false);

  const applySnapshot = useCallback(
    (
      nextPredictions: MatchPrediction[],
      nextEmpty: string | null,
      cached: boolean
    ) => {
      setPredictions(nextPredictions);
      setEmptyMessage(nextEmpty);
      setError(null);
      setFromCache(cached);
      hasPaintedRef.current = true;
    },
    []
  );

  const load = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = opts?.force === true;
      if (force && remainingCooldownMs() > 0) return;

      const cached = loadStoredDashboard();
      const hasCached =
        !!cached &&
        (cached.predictions.length > 0 || Boolean(cached.emptyMessage));

      if (!force && hasCached && cached) {
        applySnapshot(cached.predictions, cached.emptyMessage, true);
        setLoading(false);
        if (isDashboardCacheFresh(cached.savedAt)) {
          return;
        }
        setRefreshing(true);
      } else if (force && hasPaintedRef.current) {
        setRefreshing(true);
        setError(null);
      } else {
        setLoading(true);
        setRefreshing(false);
        setError(null);
        setEmptyMessage(null);
      }

      try {
        const res = await fetch(
          force ? "/api/predict?refresh=1" : "/api/predict"
        );
        const data = await res.json().catch(() => ({}));
        const errMsg =
          typeof data.error === "string" ? data.error : undefined;

        if (!res.ok) {
          const code = data?.code as string | undefined;
          if (code === "EMPTY") {
            const message = errMsg ?? EMPTY_MATCHES_MESSAGE;
            applySnapshot([], message, false);
            saveStoredDashboard([], message);
            return;
          }
          if (armRateLimitFromResponse(res.status, errMsg)) {
            setError(
              errMsg ??
                `Plan Free (10/min). Espera ${Math.ceil(API_RATE_LIMIT_COOLDOWN_MS / 1000)}s y vuelve a intentar.`
            );
            return;
          }
          if (hasCached) {
            if (force) {
              setError(errMsg ?? API_CONNECTION_ERROR_MESSAGE);
            }
            return;
          }
          setPredictions([]);
          setEmptyMessage(null);
          setFromCache(false);
          setError(errMsg ?? API_CONNECTION_ERROR_MESSAGE);
          return;
        }

        const nextPredictions = (data.predictions ?? []) as MatchPrediction[];
        const nextEmpty =
          nextPredictions.length === 0 ? EMPTY_MATCHES_MESSAGE : null;
        applySnapshot(nextPredictions, nextEmpty, Boolean(data.cached));
        saveStoredDashboard(nextPredictions, nextEmpty);
        if (force) {
          armRateCooldown(API_RATE_LIMIT_COOLDOWN_MS);
        }
      } catch {
        if (hasCached) {
          if (force) setError(API_CONNECTION_ERROR_MESSAGE);
          return;
        }
        setPredictions([]);
        setEmptyMessage(null);
        setFromCache(false);
        setError(API_CONNECTION_ERROR_MESSAGE);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [applySnapshot, armRateCooldown, armRateLimitFromResponse]
  );

  useEffect(() => {
    cleanupExpiredDashboardCache();
    void load();
  }, [load]);

  const busy = loading || refreshing;
  const showFullSpinner = loading && predictions.length === 0 && !emptyMessage;

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

  const orderedSafePicks = useMemo(
    () =>
      sortByKickoffDesc(
        safePicks.slice(0, 10),
        (p) => p.prediction.match.kickoff,
        (p) => p.prediction.match.leagueName
      ),
    [safePicks]
  );

  const orderedPredictions = useMemo(
    () =>
      sortByKickoffDesc(
        predictions,
        (p) => p.match.kickoff,
        (p) => p.match.leagueName
      ),
    [predictions]
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="info">Hoy / próximos días · hora Chile</Badge>
            {refreshing ? (
              <Badge variant="warning">Actualizando…</Badge>
            ) : fromCache ? (
              <Badge variant="info">Caché de hoy</Badge>
            ) : (
              <Badge variant="success">Datos en vivo</Badge>
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">
            Dashboard de Safe Picks
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
            Probabilidades Poisson + Dixon-Coles sobre fixtures reales de
            API-Football. Filtro: modelo ≥ 80% y cuotas entre 1.15–1.35.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void load({ force: true })}
            disabled={busy || isCoolingDown}
            aria-busy={busy}
            aria-label={
              busy
                ? "Actualizando predicciones"
                : isCoolingDown && cooldownLabel
                  ? `Espera ${cooldownLabel} para actualizar`
                  : "Actualizar predicciones"
            }
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {busy
              ? "Actualizando…"
              : isCoolingDown && cooldownLabel
                ? `Listo en ${cooldownLabel}`
                : "Actualizar"}
          </Button>
          <Link href="/builder" className={buttonVariants()}>
            Generar Combinada
          </Link>
        </div>
      </div>

      {error && (
        <Card role="alert" className="border-rose-400/50 bg-rose-950/40">
          <CardContent className="p-4 text-sm text-rose-100">
            {error}
          </CardContent>
        </Card>
      )}

      {!showFullSpinner && !error && emptyMessage && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <p className="text-base font-medium text-slate-100">
              {emptyMessage}
            </p>
          </CardContent>
        </Card>
      )}

      {!error && (
        <section aria-label="Resumen de safe picks">
          <LivePicksOverview
            safePickCount={safePicks.length}
            matchCount={predictions.length}
            avgEdge={avgEdge}
          />
        </section>
      )}

      <section className="space-y-4" aria-labelledby="top-safe-picks">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-300" aria-hidden />
          <h2 id="top-safe-picks" className="text-xl font-semibold text-slate-50">
            Top Safe Picks
          </h2>
        </div>

        {showFullSpinner ? (
          <div
            className="flex items-center justify-center py-16 text-slate-300"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
            Cargando fixtures en vivo…
          </div>
        ) : error ? null : safePicks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-slate-300">
              {emptyMessage ?? "No hay safe picks con los filtros actuales."}
            </CardContent>
          </Card>
        ) : (
          <div
            className="grid gap-3 md:grid-cols-2"
            aria-busy={refreshing}
            aria-live="polite"
          >
            {orderedSafePicks.map(({ prediction, market }) => (
                    <Card
                      key={`${prediction.matchId}-${market.market}`}
                      className="border-emerald-400/25"
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <CardDescription>
                              {prediction.match.leagueName}
                            </CardDescription>
                            <CardTitle className="mt-1">
                              {prediction.match.home.name} vs{" "}
                              {prediction.match.away.name}
                            </CardTitle>
                            <p className="mt-1 text-xs text-slate-300">
                              {formatKickoff(prediction.match.kickoff)}
                            </p>
                          </div>
                          <Badge variant="success">
                            Modelo {formatPercent(market.modelProbability)}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-end justify-between gap-3">
                          <div>
                            <p className="text-sm text-slate-100">
                              {market.label}
                            </p>
                            <p className="text-xs text-slate-300">
                              Edge {formatPercent(market.edge)} · xG{" "}
                              {prediction.expectedGoals.home.toFixed(2)}–
                              {prediction.expectedGoals.away.toFixed(2)}
                            </p>
                          </div>
                          <p className="font-mono text-2xl font-bold text-emerald-200">
                            @{formatOdds(market.odds)}
                          </p>
                        </div>
                        <SingleStakeBadge
                          modelProbability={market.modelProbability}
                          odds={market.odds}
                          pickCount={safePicks.length}
                        />
                      </CardContent>
                    </Card>
            ))}
          </div>
        )}
      </section>

      {!showFullSpinner && !error && predictions.length > 0 && (
        <section className="space-y-6" aria-labelledby="partidos-analizados">
          <h2 id="partidos-analizados" className="text-xl font-semibold text-slate-50">
            Partidos analizados
          </h2>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {orderedPredictions.map((p) => (
              <MatchCard
                key={p.matchId}
                prediction={p}
                pickCount={Math.max(1, safePicks.length)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
