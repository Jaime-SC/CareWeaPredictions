"use client";

import { StatsOverview } from "@/components/StatsOverview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  DateMarketStatsRow,
  LeagueStatsRow,
  TrainingFeatureRow,
} from "@/lib/bet-types";
import {
  type BetStatus,
  type BreakdownItem,
  type HistoryBet,
  type HistoryBetLeg,
  type HistorySummary,
  type LegStatus,
  clearHistory,
  computeBankrollSeries,
  computeLeagueBreakdown,
  computeMarketBreakdown,
  computeStrategyBreakdown,
  computeSummary,
  countLegHits,
  deleteBetById,
  formatSignedUnits,
  loadBets,
  purgeFakeHistory,
  replaceBets,
  updateBetStatus,
} from "@/lib/history-tracker";
import { formatLegMatchStatus, updatePendingBets } from "@/lib/result-checker";
import { cn, formatOdds, formatPercent } from "@/lib/utils";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  Download,
  Loader2,
  RefreshCw,
  Settings2,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type StatsApiPayload = {
  success: boolean;
  tickets?: HistoryBet[];
  summary?: {
    totalTickets: number;
    pending: number;
    won: number;
    lost: number;
    voided: number;
    totalStaked: number;
    netProfit: number;
    roi: number;
    legsWon: number;
    legsEvaluated: number;
    legAccuracy: number;
  };
  byLeague?: LeagueStatsRow[];
  byDateMarket?: DateMarketStatsRow[];
  trainingExport?: TrainingFeatureRow[];
  error?: string;
};

function summaryFromApi(
  api: StatsApiPayload["summary"],
  bets: HistoryBet[]
): HistorySummary {
  if (!api) return computeSummary(bets);
  return {
    netProfit: api.netProfit,
    totalStaked: api.totalStaked,
    totalReturned: 0,
    roi: api.roi,
    winRate:
      api.won + api.lost > 0 ? api.won / (api.won + api.lost) : 0,
    legAccuracy: api.legAccuracy,
    legsWon: api.legsWon,
    legsEvaluated: api.legsEvaluated,
    totalBets: api.totalTickets,
    won: api.won,
    lost: api.lost,
    pending: api.pending,
    voided: api.voided,
    completed: api.won + api.lost,
  };
}

export default function StatsPage() {
  const [bets, setBets] = useState<HistoryBet[]>([]);
  const [byLeague, setByLeague] = useState<LeagueStatsRow[]>([]);
  const [byDateMarket, setByDateMarket] = useState<DateMarketStatsRow[]>([]);
  const [trainingExport, setTrainingExport] = useState<TrainingFeatureRow[]>(
    []
  );
  const [apiSummary, setApiSummary] =
    useState<StatsApiPayload["summary"]>(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrateMsg, setCalibrateMsg] = useState<string | null>(null);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const refreshFromDb = useCallback(async () => {
    purgeFakeHistory();
    const local = loadBets();
    try {
      const res = await fetch("/api/stats/summary");
      const data = (await res.json()) as StatsApiPayload;
      if (res.ok && data.success) {
        const tickets = data.tickets ?? [];
        // Prefer SQLite; keep localStorage if DB still empty (pre-migration)
        if (tickets.length > 0) {
          setBets(tickets);
          replaceBets(tickets);
        } else {
          setBets(local);
        }
        setByLeague(data.byLeague ?? []);
        setByDateMarket(data.byDateMarket ?? []);
        setTrainingExport(data.trainingExport ?? []);
        setApiSummary(data.summary);
        setHydrated(true);
        return;
      }
    } catch {
      // fall through to local
    }

    setBets(local);
    setByLeague([]);
    setByDateMarket([]);
    setTrainingExport([]);
    setApiSummary(undefined);
    setHydrated(true);
  }, []);

  useEffect(() => {
    void refreshFromDb();
  }, [refreshFromDb]);

  useEffect(() => {
    if (!hydrated) return;
    const pending = bets.some(
      (b) => b.status === "pending" || b.legs.some((l) => l.status === "pending")
    );
    if (!pending) return;

    let cancelled = false;
    (async () => {
      setUpdating(true);
      const result = await updatePendingBets();
      if (cancelled) return;
      setUpdating(false);
      if (result.ok && result.updatedTickets > 0) {
        setUpdateMsg(
          `Auto-check: ${result.updatedTickets} ticket(s) actualizado(s) con API-Football.`
        );
        await refreshFromDb();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once after hydrate
  }, [hydrated]);

  const summary = useMemo(
    () => summaryFromApi(apiSummary, bets),
    [apiSummary, bets]
  );
  const series = useMemo(() => computeBankrollSeries(bets), [bets]);
  const marketBreakdown = useMemo(
    () => computeMarketBreakdown(bets),
    [bets]
  );
  const strategyBreakdown = useMemo(
    () => computeStrategyBreakdown(bets),
    [bets]
  );
  const leagueBreakdownFallback = useMemo(
    () => computeLeagueBreakdown(bets),
    [bets]
  );

  const leagueRows =
    byLeague.length > 0
      ? byLeague
      : leagueBreakdownFallback.map((item) => ({
          leagueName: item.label,
          total: item.total,
          won: item.won,
          lost: item.lost,
          winRate: item.winRate,
          netRoi: 0,
        }));

  async function handleUpdateFromApi() {
    setUpdating(true);
    setUpdateMsg(null);
    setUpdateError(null);
    const result = await updatePendingBets();

    // Also settle PENDING tickets directly in SQLite (cron path)
    try {
      await fetch("/api/cron/settle", { method: "POST" });
    } catch {
      // Non-fatal — local history already updated
    }

    setUpdating(false);

    if (!result.ok) {
      setUpdateError(result.error ?? "Error al actualizar.");
      return;
    }

    await refreshFromDb();

    if (result.checkedFixtures === 0) {
      setUpdateMsg(
        result.stillPending > 0
          ? "Hay tickets pendientes pero sin fixture_id válido para consultar."
          : "No hay partidos pendientes por consultar."
      );
      return;
    }

    setUpdateMsg(
      `API-Football: ${result.checkedFixtures} fixture(s) · ${result.updatedTickets} ticket(s) actualizado(s) · ${result.stillPending} pendiente(s).`
    );
  }

  async function handleStatus(id: string, status: BetStatus) {
    updateBetStatus(id, status);
    try {
      await fetch("/api/stats/summary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", ticketId: id, status }),
      });
    } catch {
      // local already updated
    }
    await refreshFromDb();
  }

  async function handleClear() {
    if (
      !window.confirm(
        "¿Limpiar todo el historial (SQLite + local)? Esta acción no se puede deshacer."
      )
    ) {
      return;
    }
    clearHistory();
    try {
      await fetch("/api/stats/summary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
    } catch {
      // ignore
    }
    setBets([]);
    setByLeague([]);
    setByDateMarket([]);
    setTrainingExport([]);
    setApiSummary(undefined);
    setUpdateMsg(null);
    setUpdateError(null);
  }

  async function handleDeleteBet(betId: string) {
    if (
      !window.confirm(
        "¿Seguro que deseas eliminar esta combinada del historial?"
      )
    ) {
      return;
    }

    setRemovingIds((prev) => new Set(prev).add(betId));

    // Smooth exit, then drop from state so KPIs recompute immediately
    window.setTimeout(async () => {
      deleteBetById(betId);

      setBets((prev) => prev.filter((b) => b.id !== betId));
      setApiSummary(undefined);
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(betId);
        return next;
      });

      try {
        const res = await fetch("/api/stats/summary", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", ticketId: betId }),
        });
        const data = (await res.json().catch(() => null)) as StatsApiPayload | null;
        if (res.ok && data?.success) {
          const tickets = data.tickets ?? [];
          setBets(tickets);
          replaceBets(tickets);
          setByLeague(data.byLeague ?? []);
          setByDateMarket(data.byDateMarket ?? []);
          setTrainingExport(data.trainingExport ?? []);
          setApiSummary(data.summary);
          if (tickets.length === 0) {
            setUpdateMsg(null);
          }
        }
      } catch {
        // local already removed; keep optimistic UI
      }
    }, 220);
  }

  function handleExportTraining() {
    const payload = {
      exportedAt: new Date().toISOString(),
      featureVectors: trainingExport.length
        ? trainingExport
        : bets.flatMap((bet) =>
            bet.legs.map((leg) => ({
              league: leg.leagueName,
              market: leg.market,
              selection: leg.marketLabel,
              modelProbability: 0,
              odds: leg.odds,
              outcome:
                leg.status === "won"
                  ? "WON"
                  : leg.status === "lost"
                    ? "LOST"
                    : leg.status === "void"
                      ? "VOID"
                      : "PENDING",
              matchDate: leg.kickoff,
              homeTeam: leg.homeTeam ?? "",
              awayTeam: leg.awayTeam ?? "",
            }))
          ),
      schema: {
        league: "string",
        market: "MarketType",
        selection: "string",
        modelProbability: "0-1",
        odds: "decimal",
        outcome: "WON|LOST|PENDING|VOID",
      },
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parleylab-training-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCalibrateModel() {
    setCalibrating(true);
    setCalibrateMsg(null);
    setUpdateError(null);
    try {
      const res = await fetch("/api/model/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureVectors: trainingExport.length
            ? trainingExport
            : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setUpdateError(
          typeof data.error === "string"
            ? data.error
            : "No se pudo recalibrar el modelo."
        );
        return;
      }
      setCalibrateMsg(
        typeof data.message === "string"
          ? data.message
          : `Parámetros actualizados: ${data.leaguesAdjusted ?? 0} ligas ajustadas, umbral de goles ajustado a ${Math.round((data.over15MinProbability ?? 0.78) * 100)}%`
      );
    } catch {
      setUpdateError("Error de red al recalibrar el modelo.");
    } finally {
      setCalibrating(false);
    }
  }

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center text-sm text-slate-500">
        Cargando analytics desde SQLite…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="info">Estadísticas</Badge>
            <Badge variant="success">Prisma · SQLite</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">
            Analytics de entrenamiento
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Win rate, ROI en unidades (1U) y conteo de tickets — sin montos en
            CLP. Datos persistidos para afinar el modelo Poisson / ML.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportTraining}
            disabled={bets.length === 0 && trainingExport.length === 0}
          >
            <Download className="h-4 w-4" />
            📥 Exportar Datos de Entrenamiento (JSON)
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleUpdateFromApi}
            disabled={updating || bets.length === 0}
          >
            {updating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Actualizar Resultados
          </Button>
          {bets.length > 0 && (
            <Button variant="danger" size="sm" onClick={handleClear}>
              <Trash2 className="h-4 w-4" />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {updateError && (
        <Card className="border-rose-500/40 bg-rose-950/20">
          <CardContent className="p-4 text-sm text-rose-300">
            {updateError}
          </CardContent>
        </Card>
      )}
      {updateMsg && !updateError && (
        <Card className="border-emerald-500/20 bg-emerald-950/10">
          <CardContent className="p-4 text-sm text-emerald-200/90">
            {updateMsg}
          </CardContent>
        </Card>
      )}
      {calibrateMsg && !updateError && (
        <Card className="border-sky-500/30 bg-sky-950/20">
          <CardContent className="p-4 text-sm text-sky-100">
            ⚙️ {calibrateMsg}
          </CardContent>
        </Card>
      )}

      {bets.length === 0 ? (
        <Card className="border-dashed border-slate-700">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <p className="max-w-lg text-sm leading-relaxed text-slate-300">
              Aún no hay tickets en SQLite. Genera una combinada y pulsa
              &apos;Registrar Apuesta&apos; para alimentar el motor de
              analytics.
            </p>
            <Link href="/builder">
              <Button>Ir al Generador</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <StatsOverview summary={summary} />

          {/* 1. By competition */}
          <Card>
            <CardHeader>
              <CardTitle>Rendimiento por Competición</CardTitle>
              <CardDescription>
                Identifica ligas predecibles vs. alta varianza — Total · Won ·
                Lost · Win Rate · Net ROI
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {leagueRows.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Sin legs evaluadas todavía. Actualiza resultados tras el FT.
                </p>
              ) : (
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-2 pr-3 font-medium">Liga / Torneo</th>
                      <th className="pb-2 pr-3 font-medium">Total</th>
                      <th className="pb-2 pr-3 font-medium">Won</th>
                      <th className="pb-2 pr-3 font-medium">Lost</th>
                      <th className="pb-2 pr-3 font-medium">Win Rate</th>
                      <th className="pb-2 font-medium">Net ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leagueRows.map((row) => (
                      <tr
                        key={row.leagueName}
                        className="border-b border-slate-800/60"
                      >
                        <td className="py-2.5 pr-3 font-medium text-slate-100">
                          {row.leagueName}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-300">
                          {row.total}
                        </td>
                        <td className="py-2.5 pr-3 text-emerald-400">
                          {row.won}
                        </td>
                        <td className="py-2.5 pr-3 text-rose-400">
                          {row.lost}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge
                            variant={
                              row.winRate >= 0.55
                                ? "success"
                                : row.winRate >= 0.4
                                  ? "warning"
                                  : "danger"
                            }
                          >
                            {formatPercent(row.winRate)}
                          </Badge>
                        </td>
                        <td
                          className={cn(
                            "py-2.5 font-mono text-xs",
                            row.netRoi >= 0
                              ? "text-emerald-400"
                              : "text-rose-400"
                          )}
                        >
                          {row.netRoi >= 0 ? "+" : ""}
                          {row.netRoi.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* 2. By date & market */}
          <Card>
            <CardHeader>
              <CardTitle>Acierto por Fecha y Mercado</CardTitle>
              <CardDescription>
                Doble Oportunidad · +1.5 Goles · Apuesta sin Empate · etc.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {byDateMarket.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    Vista agregada por mercado (sin desglose diario aún — se
                    llena al resolver picks en SQLite).
                  </p>
                  <MarketBars items={marketBreakdown} />
                </div>
              ) : (
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-2 pr-3 font-medium">Fecha</th>
                      <th className="pb-2 pr-3 font-medium">Mercado</th>
                      <th className="pb-2 pr-3 font-medium">Total</th>
                      <th className="pb-2 pr-3 font-medium">Won / Lost</th>
                      <th className="pb-2 font-medium">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDateMarket.map((row) => (
                      <tr
                        key={`${row.date}-${row.marketLabel}`}
                        className="border-b border-slate-800/60"
                      >
                        <td className="py-2.5 pr-3 font-mono text-xs text-slate-400">
                          {row.date}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-100">
                          {row.marketLabel}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-300">
                          {row.total}
                        </td>
                        <td className="py-2.5 pr-3 text-xs">
                          <span className="text-emerald-400">{row.won}</span>
                          <span className="text-slate-600"> / </span>
                          <span className="text-rose-400">{row.lost}</span>
                        </td>
                        <td className="py-2.5">
                          <Badge
                            variant={
                              row.winRate >= 0.55
                                ? "success"
                                : row.winRate >= 0.4
                                  ? "warning"
                                  : "danger"
                            }
                          >
                            {formatPercent(row.winRate)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* 3. Model insight */}
          <Card className="border-sky-500/20 bg-sky-950/10">
            <CardHeader>
              <CardTitle>Model Decision Insight</CardTitle>
              <CardDescription>
                Vectores de features listos para reentrenar pesos Poisson / ML:
                League · Market · Model Prob · Odds · Outcome
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-300">
                {trainingExport.length ||
                  bets.reduce((n, b) => n + b.legs.length, 0)}{" "}
                filas de entrenamiento disponibles en SQLite.
              </p>
              <Button variant="default" size="sm" onClick={handleExportTraining}>
                <Download className="h-4 w-4" />
                📥 Exportar Datos de Entrenamiento (JSON)
              </Button>
            </CardContent>
          </Card>

          <Card className="border-amber-500/25 bg-amber-950/10">
            <CardHeader>
              <CardTitle>Auto-Tuning Engine</CardTitle>
              <CardDescription>
                Recalcula multiplicadores por liga, pesos de mercado y umbrales
                de probabilidad a partir del historial (SQLite / JSON). Los
                nuevos pesos se aplican automáticamente a futuras predicciones.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-sm text-slate-400">
                Ligas &lt;70% WR → mayor penalización · Ligas &gt;88% → umbral de
                cuota más flexible · Mercados con ROI negativo → cutoff más alto.
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={handleCalibrateModel}
                disabled={calibrating}
              >
                {calibrating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Settings2 className="h-4 w-4" />
                )}
                ⚙️ Re-Calibrar Modelo con Datos Históricos
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rendimiento acumulado (unidades)</CardTitle>
              <CardDescription>
                P&amp;L en unidades (1U por ticket resuelto)
              </CardDescription>
            </CardHeader>
            <CardContent className="h-72 pt-2 sm:h-80">
              {series.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-slate-500">
                  Sin tickets resueltos aún.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={series}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="unitsFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#34d399"
                          stopOpacity={0.35}
                        />
                        <stop
                          offset="100%"
                          stopColor="#34d399"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#1e293b"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      tickFormatter={(v: string) => v.slice(5)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      tickFormatter={(v: number) =>
                        `${v >= 0 ? "" : "−"}${Math.abs(Number(v.toFixed(1)))}U`
                      }
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #1e293b",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "#94a3b8" }}
                      formatter={(value) => [
                        formatSignedUnits(Number(value ?? 0)),
                        "Unidades",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="bankroll"
                      stroke="#34d399"
                      strokeWidth={2}
                      fill="url(#unitsFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownCard
              title="Acierto por Estrategia"
              description="Modo Segura vs Modo Diversión (tickets)"
              items={strategyBreakdown}
            />
            <BreakdownCard
              title="Acierto por Mercado (agregado)"
              description="Win rate global por familia de mercado"
              items={marketBreakdown}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Historial de apuestas</CardTitle>
              <CardDescription>
                Persistido en SQLite · override manual disponible
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {bets.map((bet) => (
                <BetRow
                  key={bet.id}
                  bet={bet}
                  removing={removingIds.has(bet.id)}
                  onStatus={(status) => handleStatus(bet.id, status)}
                  onDelete={() => handleDeleteBet(bet.id)}
                />
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MarketBars({ items }: { items: BreakdownItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Sin legs evaluadas todavía.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.key} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-200">{item.label}</span>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  item.winRate >= 0.55
                    ? "success"
                    : item.winRate >= 0.4
                      ? "warning"
                      : "danger"
                }
              >
                {formatPercent(item.winRate)}
              </Badge>
              <span className="text-[11px] text-slate-500">
                {item.won}/{item.total}
              </span>
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500/80"
              style={{ width: `${Math.round(item.winRate * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BreakdownCard({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: BreakdownItem[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <MarketBars items={items} />
      </CardContent>
    </Card>
  );
}

function legHitsBadgeVariant(
  betStatus: BetStatus
): "success" | "danger" | "warning" | "info" {
  if (betStatus === "won") return "success";
  if (betStatus === "lost") return "danger";
  if (betStatus === "void") return "warning";
  return "info";
}

function LegResultIcon({ status }: { status: LegStatus }) {
  if (status === "won") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400"
        title="Acertada"
      >
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "lost") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400"
        title="Fallida"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "void") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300"
        title="Anulada"
      >
        <CircleSlash className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700/60 text-slate-400"
      title="Pendiente"
    >
      <Clock className="h-3.5 w-3.5" />
    </span>
  );
}

function LegDetailRow({ leg }: { leg: HistoryBetLeg }) {
  const home = leg.homeTeam || leg.matchLabel.split(/\s+vs\.?\s+/i)[0] || "—";
  const away =
    leg.awayTeam || leg.matchLabel.split(/\s+vs\.?\s+/i)[1] || "";
  const matchName = away ? `${home} vs ${away}` : home;
  const statusLine = formatLegMatchStatus(leg);

  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-2.5",
        leg.status === "won" && "border-emerald-500/20 bg-emerald-500/5",
        leg.status === "lost" && "border-rose-500/20 bg-rose-500/5",
        leg.status === "void" && "border-amber-500/20 bg-amber-500/5",
        leg.status === "pending" && "border-slate-800 bg-slate-900/40"
      )}
    >
      <LegResultIcon status={leg.status} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium leading-snug text-slate-100">
          {matchName}
        </p>
        <p className="text-xs text-slate-400">
          {leg.marketLabel}
          <span className="mx-1.5 text-slate-600">·</span>
          <span className="font-mono text-emerald-300/90">
            @{formatOdds(leg.odds)}
          </span>
        </p>
        <p className="text-xs text-slate-500">
          {statusLine}
          {leg.leagueName ? (
            <span className="text-slate-600"> · {leg.leagueName}</span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function BetRow({
  bet,
  removing = false,
  onStatus,
  onDelete,
}: {
  bet: HistoryBet;
  removing?: boolean;
  onStatus: (status: BetStatus) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(
    () => bet.status === "pending" || bet.status === "lost"
  );

  const hits = countLegHits(bet.legs);
  const hitsVariant = legHitsBadgeVariant(bet.status);

  const statusBadge =
    bet.status === "won"
      ? { variant: "success" as const, label: "Ganada" }
      : bet.status === "lost"
        ? { variant: "danger" as const, label: "Perdida" }
        : bet.status === "void"
          ? { variant: "warning" as const, label: "Cancelada" }
          : { variant: "info" as const, label: "Pendiente" };

  const unitPnl =
    bet.status === "won"
      ? bet.potentialReturn - bet.stakeCLP
      : bet.status === "lost"
        ? -bet.stakeCLP
        : 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50 transition-all duration-200 ease-out",
        removing
          ? "max-h-0 -translate-y-1 scale-[0.98] border-transparent opacity-0"
          : "max-h-[2000px] translate-y-0 scale-100 opacity-100"
      )}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            <button
              type="button"
              aria-label="Eliminar esta combinada del historial"
              title="Eliminar del historial"
              onClick={onDelete}
              disabled={removing}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <Badge
              variant={hitsVariant}
              className="font-semibold tracking-tight"
            >
              ✔ {hits.won} / {hits.total} Acertadas
            </Badge>
            <Badge variant={bet.mode === "Segura" ? "success" : "warning"}>
              {bet.mode} · {bet.timeframe}
            </Badge>
            <span className="text-xs text-slate-500">{bet.date}</span>
          </div>
          <p className="text-sm text-slate-200">
            {bet.legs.length} legs · Multiplicador{" "}
            {formatOdds(bet.totalOdds)}x · 1U
          </p>
          {(bet.status === "won" || bet.status === "lost") && (
            <p
              className={`text-xs font-medium ${
                unitPnl >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              Resultado {formatSignedUnits(unitPnl)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={bet.status === "won" ? "default" : "outline"}
            onClick={() => onStatus("won")}
            disabled={removing}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ganada
          </Button>
          <Button
            size="sm"
            variant={bet.status === "lost" ? "danger" : "outline"}
            onClick={() => onStatus("lost")}
            disabled={removing}
          >
            <XCircle className="h-3.5 w-3.5" />
            Perdida
          </Button>
          <Button
            size="sm"
            variant={bet.status === "void" ? "secondary" : "ghost"}
            onClick={() => onStatus("void")}
            disabled={removing}
          >
            <CircleSlash className="h-3.5 w-3.5" />
            Cancelada
          </Button>
        </div>
      </div>

      <div className="border-t border-slate-800/80 px-2 pb-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2.5 text-left text-sm text-slate-300 transition hover:bg-slate-900/80 hover:text-slate-100"
          aria-expanded={expanded}
          disabled={removing}
        >
          <span>
            Desglose de legs
            <span className="ml-2 text-xs text-slate-500">
              {hits.won}✔ · {hits.lost}✖ · {hits.pending}⏳
              {hits.voided > 0 ? ` · ${hits.voided}⊘` : ""}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-slate-500 transition-transform",
              expanded && "rotate-180"
            )}
          />
        </button>

        {expanded && (
          <ul className="space-y-2 px-1 pb-2 pt-1">
            {bet.legs.map((leg, idx) => (
              <LegDetailRow
                key={`${leg.fixtureId}-${leg.market}-${idx}`}
                leg={leg}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
