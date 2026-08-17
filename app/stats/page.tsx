"use client";

import { StatsOverview } from "@/components/StatsOverview";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
  countSettledByStrategy,
  marketGroupLabel,
  countLegHits,
  deleteBetById,
  formatSignedUnits,
  loadBets,
  purgeFakeHistory,
  replaceBets,
} from "@/lib/history-tracker";
import { formatLegMatchStatus, updatePendingBets } from "@/lib/result-checker";
import {
  formatExplicitBetLine,
  getExplicitPickLabel,
} from "@/lib/formatters";
import { cn, chileDateString, formatOdds, formatPercent } from "@/lib/utils";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  Download,
  Info,
  Loader2,
  RefreshCw,
  Settings2,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type SettlementDiagnostic = {
  ticketId: string;
  fixtureApiId: number;
  match: string;
  kickoff: string;
  statusShort: string;
  action: "settled" | "voided" | "skipped" | "unresolved";
  reason: string;
  outcome?: string;
};

type SettleApiPayload = {
  success: boolean;
  settledTicketsCount: number;
  updatedLegsCount: number;
  ticketsWon?: number;
  ticketsLost?: number;
  ticketsVoided?: number;
  stillPending?: number;
  overduePending?: number;
  checkedFixtures?: number;
  diagnostics?: SettlementDiagnostic[];
  errors?: string[];
  error?: string;
};

type StatsApiPayload = {
  success: boolean;
  tickets?: HistoryBet[];
  summary?: {
    totalTickets: number;
    settledTickets?: number;
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
  const settled = api.settledTickets ?? api.won + api.lost;
  const byStrategy = countSettledByStrategy(bets);
  return {
    netProfit: api.netProfit,
    totalStaked: api.totalStaked,
    totalReturned: 0,
    roi: api.roi,
    winRate: settled > 0 ? api.won / settled : 0,
    legAccuracy: api.legAccuracy,
    legsWon: api.legsWon,
    legsEvaluated: api.legsEvaluated,
    totalBets: api.totalTickets,
    won: api.won,
    lost: api.lost,
    pending: api.pending,
    voided: api.voided,
    completed: settled,
    ...byStrategy,
  };
}

function ticketStatusBadge(status: BetStatus): {
  variant: "success" | "danger" | "warning" | "info";
  label: ReactNode;
} {
  if (status === "won") {
    return {
      variant: "success",
      label: (
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          Ganada
        </span>
      ),
    };
  }
  if (status === "lost") {
    return {
      variant: "danger",
      label: (
        <span className="inline-flex items-center gap-1">
          <XCircle className="h-3 w-3 text-rose-400" />
          Perdida
        </span>
      ),
    };
  }
  if (status === "void") {
    return {
      variant: "warning",
      label: (
        <span className="inline-flex items-center gap-1">
          <CircleSlash className="h-3 w-3 text-amber-300" />
          Cancelada
        </span>
      ),
    };
  }
  return {
    variant: "info",
    label: (
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3 text-sky-400" />
        En juego
      </span>
    ),
  };
}

function LegHitsInline({
  hits,
  className,
}: {
  hits: { won: number; lost: number; pending: number; voided?: number };
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs",
        className
      )}
    >
      <span className="inline-flex items-center gap-0.5 text-emerald-200">
        <Check className="h-3 w-3" strokeWidth={2.5} />
        {hits.won}
      </span>
      <span className="inline-flex items-center gap-0.5 text-rose-200">
        <X className="h-3 w-3" strokeWidth={2.5} />
        {hits.lost}
      </span>
      <span className="inline-flex items-center gap-0.5 text-sky-200">
        <Clock className="h-3 w-3" />
        {hits.pending}
      </span>
      {(hits.voided ?? 0) > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-amber-300">
          <CircleSlash className="h-3 w-3" />
          {hits.voided}
        </span>
      ) : null}
    </span>
  );
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

  const refreshFromDb = useCallback(async (): Promise<StatsApiPayload | null> => {
    purgeFakeHistory();
    const local = loadBets();
    try {
      const res = await fetch("/api/stats/summary", { cache: "no-store" });
      const data = (await res.json()) as StatsApiPayload;
      if (res.ok && data.success) {
        const tickets = data.tickets ?? [];
        // Prefer Neon/Postgres; keep localStorage if DB still empty (pre-migration)
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
        return data;
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
    return null;
  }, []);

  const runSettle = useCallback(async (): Promise<SettleApiPayload | null> => {
    try {
      const res = await fetch("/api/settle", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json()) as SettleApiPayload;
      return data;
    } catch {
      return {
        success: false,
        settledTicketsCount: 0,
        updatedLegsCount: 0,
        errors: ["Error de red al sincronizar marcadores."],
        error: "Error de red al sincronizar marcadores.",
      };
    }
  }, []);

  const applySettleFeedback = useCallback(
    (settle: SettleApiPayload | null, opts?: { silentIfIdle?: boolean }) => {
      if (!settle) return;

      const n = settle.settledTicketsCount ?? 0;
      const won = settle.ticketsWon ?? 0;
      const lost = settle.ticketsLost ?? 0;
      const voided = settle.ticketsVoided ?? 0;
      const unresolved =
        settle.diagnostics?.filter((d) => d.action === "unresolved") ?? [];

      console.info("[settle] Sincronización de marcadores", {
        settledTicketsCount: n,
        ticketsWon: won,
        ticketsLost: lost,
        ticketsVoided: voided,
        stillPending: settle.stillPending,
        overduePending: settle.overduePending,
        checkedFixtures: settle.checkedFixtures,
        diagnostics: settle.diagnostics,
        errors: settle.errors,
      });

      if (n > 0) {
        setUpdateMsg(
          `Sincronización completada: ${n} boletos actualizados (${won} Ganados, ${lost} Perdidos).`
        );
        if (unresolved.length > 0) {
          setUpdateError(
            unresolved
              .slice(0, 4)
              .map((d) => `${d.match}: ${d.reason}`)
              .join(" · ")
          );
        } else if (!settle.success && (settle.error || settle.errors?.length)) {
          setUpdateError(settle.error ?? settle.errors?.[0] ?? null);
        }
        return;
      }
      if (!settle.success && (settle.error || settle.errors?.length)) {
        setUpdateError(
          settle.error ?? settle.errors?.[0] ?? "Error al sincronizar."
        );
        return;
      }
      if (unresolved.length > 0) {
        setUpdateError(
          unresolved
            .slice(0, 4)
            .map((d) => `${d.match}: ${d.reason}`)
            .join(" · ")
        );
        return;
      }
      if (opts?.silentIfIdle) return;
      if ((settle.stillPending ?? 0) > 0) {
        setUpdateMsg(
          "Hay boletos en juego; se consultaron marcadores pero aún no están FT / AET / PEN."
        );
        return;
      }
      setUpdateMsg("No hay boletos pendientes por liquidar.");
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setUpdating(true);
      const settle = await runSettle();
      if (cancelled) return;
      await refreshFromDb();
      if (cancelled) return;
      applySettleFeedback(settle, { silentIfIdle: true });
      setUpdating(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [runSettle, refreshFromDb, applySettleFeedback]);

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
  const pendingBets = useMemo(
    () => bets.filter((b) => b.status === "pending"),
    [bets]
  );
  const overduePendingCount = useMemo(() => {
    const today = chileDateString();
    return pendingBets.filter((b) => {
      if (b.date && b.date < today) return true;
      return b.legs.some((leg) => {
        if (!leg.kickoff) return false;
        const t = new Date(leg.kickoff);
        return Number.isFinite(t.getTime()) && chileDateString(t) < today;
      });
    }).length;
  }, [pendingBets]);

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

  async function handleSyncScores() {
    setUpdating(true);
    setUpdateMsg(null);
    setUpdateError(null);

    const settle = await runSettle();
    if (!settle?.success) {
      const alreadyHitLiveApi =
        (settle.checkedFixtures ?? 0) > 0 ||
        (settle.diagnostics?.length ?? 0) > 0;
      if (!alreadyHitLiveApi) {
        const fallback = await updatePendingBets();
        if (fallback.ok && fallback.updatedTickets > 0) {
          setBets(fallback.bets);
          replaceBets(fallback.bets);
          setUpdateMsg(
            `Sincronización completada: ${fallback.updatedTickets} boletos actualizados.`
          );
          await refreshFromDb();
          setUpdating(false);
          return;
        }
      }
      applySettleFeedback(settle);
      await refreshFromDb();
      setUpdating(false);
      return;
    }

    await refreshFromDb();
    applySettleFeedback(settle);
    setUpdating(false);
  }

  async function handleClear() {
    if (
      !window.confirm(
        "¿Limpiar todo el historial (base de datos + local)? Esta acción no se puede deshacer."
      )
    ) {
      return;
    }
    clearHistory();
    try {
      await fetch("/api/stats/summary", {
        method: "PATCH",
        cache: "no-store",
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
          cache: "no-store",
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
    a.download = `careweapredictions-training-${new Date().toISOString().slice(0, 10)}.json`;
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
      <div
        role="status"
        className="mx-auto max-w-7xl px-4 py-16 text-center text-sm text-slate-300"
      >
        Cargando analytics y sincronizando marcadores…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="info">Estadísticas</Badge>
            <Badge variant="success">Prisma · Neon</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">
            Analytics de entrenamiento
          </h1>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-slate-200">
            Win rate y ROI se calculan solo con boletos liquidados (ganada /
            perdida). Los pendientes en juego no distorsionan el rendimiento.
            Al cargar el panel se sincronizan los marcadores de partidos con
            kickoff ya ocurrido (FT, AET, PEN, EXTRA).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportTraining}
            disabled={bets.length === 0 && trainingExport.length === 0}
          >
            <Download className="h-4 w-4" aria-hidden />
            Exportar datos de entrenamiento (JSON)
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSyncScores}
            disabled={updating}
            aria-busy={updating}
          >
            {updating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {updating ? "Sincronizando…" : "Sincronizar marcadores"}
          </Button>
          {bets.length > 0 && (
            <Button variant="danger" size="sm" onClick={handleClear}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {overduePendingCount > 0 && (
        <Card role="status" className="border-sky-400/40 bg-sky-950/30">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-sky-100">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Tienes {overduePendingCount} boletos pendientes de ayer. Haz clic
              en Sincronizar para actualizar marcadores.
            </span>
          </CardContent>
        </Card>
      )}
      {updateMsg && (
        <Card role="status" className="border-emerald-400/40 bg-emerald-950/30">
          <CardContent className="p-4 text-sm text-emerald-100">
            {updateMsg}
          </CardContent>
        </Card>
      )}
      {updateError && (
        <Card role="alert" className="border-rose-400/50 bg-rose-950/40">
          <CardContent className="p-4 text-sm text-rose-100">
            {updateError}
          </CardContent>
        </Card>
      )}
      {calibrateMsg && !updateError && (
        <Card className="border-sky-500/30 bg-sky-950/20">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-sky-100">
            <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
            <span>{calibrateMsg}</span>
          </CardContent>
        </Card>
      )}

      {bets.length === 0 ? (
        <Card className="border-dashed border-slate-700">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <p className="max-w-lg text-sm leading-relaxed text-slate-300">
              Aún no hay tickets en la base de datos. Genera una combinada y pulsa
              &apos;Registrar Apuesta&apos; para alimentar el motor de
              analytics.
            </p>
            <Link href="/builder" className={buttonVariants()}>
              Ir al Generador
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <StatsOverview summary={summary} />

          {pendingBets.length > 0 && (
            <Card className="border-sky-500/30 bg-sky-950/15">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Boletos en juego / pendientes</CardTitle>
                  <Badge variant="info" className="gap-1">
                    <Clock className="h-3 w-3 text-sky-400" />
                    {pendingBets.length} en curso
                  </Badge>
                </div>
                <CardDescription>
                  Combinadas cuyo resultado aún no está liquidado. No entran en
                  Win Rate %, ROI ni precisión del algoritmo. Al abrir esta
                  página se consultan marcadores de partidos con kickoff
                  vencido (FT, AET, PEN, EXTRA).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingBets.map((bet) => {
                  const hits = countLegHits(bet.legs);
                  return (
                    <div
                      key={bet.id}
                      className="flex flex-col gap-1 rounded-lg border border-sky-500/20 bg-slate-950/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="info" className="gap-1">
                            <Clock className="h-3 w-3 text-sky-400" />
                            En juego
                          </Badge>
                          <Badge variant={bet.mode === "Segura" ? "success" : "warning"}>
                            {bet.mode} · {bet.timeframe}
                          </Badge>
                          <span className="text-xs text-slate-300">{bet.date}</span>
                        </div>
                        <p className="text-sm text-slate-200">
                          {bet.legs.length} legs · {formatOdds(bet.totalOdds)}x · 1U
                          <LegHitsInline hits={hits} className="ml-2" />
                        </p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* 1. By competition */}
          <Card>
            <CardHeader>
              <CardTitle>Rendimiento por competición</CardTitle>
              <CardDescription>
                Identifica ligas predecibles vs. alta varianza — Total · Won ·
                Lost · Win Rate · Net ROI
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {leagueRows.length === 0 ? (
                <p className="text-sm text-slate-200">
                  Sin legs evaluadas todavía. Actualiza resultados tras el FT.
                </p>
              ) : (
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-600 text-xs font-medium text-slate-300">
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
              <CardTitle>Acierto por fecha y mercado</CardTitle>
              <CardDescription>
                Doble oportunidad · Más de 1.5 goles · Apuesta sin empate · etc.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {byDateMarket.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-300">
                    Vista agregada por mercado (sin desglose diario aún — se
                    llena al resolver picks en la base de datos).
                  </p>
                  <MarketBars items={marketBreakdown} />
                </div>
              ) : (
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-600 text-xs font-medium text-slate-300">
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
                        <td className="py-2.5 pr-3 font-mono text-xs text-slate-300">
                          {row.date}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-100">
                          {marketGroupLabel(row.market, row.marketLabel)}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-300">
                          {row.total}
                        </td>
                        <td className="py-2.5 pr-3 text-xs">
                          <span className="text-emerald-400">{row.won}</span>
                          <span className="text-slate-400"> / </span>
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
              <CardTitle>Insight del modelo</CardTitle>
              <CardDescription>
                Vectores de features listos para reentrenar pesos Poisson / ML:
                League · Market · Model Prob · Odds · Outcome
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-300">
                {trainingExport.length ||
                  bets.reduce((n, b) => n + b.legs.length, 0)}{" "}
                filas de entrenamiento disponibles en la base de datos.
              </p>
              <Button variant="default" size="sm" onClick={handleExportTraining}>
                <Download className="h-4 w-4" aria-hidden />
                Exportar datos de entrenamiento (JSON)
              </Button>
            </CardContent>
          </Card>

          <Card className="border-amber-500/25 bg-amber-950/10">
            <CardHeader>
              <CardTitle>Motor de autoajuste</CardTitle>
              <CardDescription>
                Recalcula multiplicadores por liga, pesos de mercado y umbrales
                de probabilidad a partir del historial (base de datos / JSON). Los
                nuevos pesos se aplican automáticamente a futuras predicciones.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-sm text-slate-200">
                Ligas &lt;70% WR → mayor penalización · Ligas &gt;88% → umbral de
                cuota más flexible · Mercados con ROI negativo → cutoff más alto.
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={handleCalibrateModel}
                disabled={calibrating}
                aria-busy={calibrating}
              >
                {calibrating ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Settings2 className="h-4 w-4" aria-hidden />
                )}
                {calibrating
                  ? "Recalibrando…"
                  : "Recalibrar modelo con datos históricos"}
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
                <p className="flex h-full items-center justify-center text-sm text-slate-200">
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
                      tick={{ fill: "#cbd5e1", fontSize: 12 }}
                      tickFormatter={(v: string) => v.slice(5)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#cbd5e1", fontSize: 12 }}
                      tickFormatter={(v: number) =>
                        `${v >= 0 ? "" : "−"}${Math.abs(Number(v.toFixed(1)))}U`
                      }
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#172033",
                        border: "1px solid #3d4f66",
                        borderRadius: 12,
                        fontSize: 13,
                        color: "#f8fafc",
                      }}
                      labelStyle={{ color: "#cbd5e1" }}
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
              title="Acierto por estrategia"
              description="Modo Segura vs Modo Diversión (tickets)"
              items={strategyBreakdown}
            />
            <BreakdownCard
              title="Acierto por mercado (agregado)"
              description="Win rate global por familia de mercado"
              items={marketBreakdown}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Historial de apuestas</CardTitle>
              <CardDescription>
                Persistido en Neon · resultado según marcador real
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {bets.map((bet) => (
                <BetRow
                  key={bet.id}
                  bet={bet}
                  removing={removingIds.has(bet.id)}
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
      <p className="text-sm text-slate-200">
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
              <span className="text-xs text-slate-300">
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
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-200"
        aria-label="Acertada"
        title="Acertada"
      >
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "lost") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-200"
        aria-label="Fallida"
        title="Fallida"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "void") {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-100"
        aria-label="Anulada"
        title="Anulada"
      >
        <CircleSlash className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-200"
        aria-label="Pendiente"
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
  const explicit = getExplicitPickLabel(
    leg.market,
    leg.marketLabel,
    home,
    away || "Visitante"
  );

  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-2.5",
        leg.status === "won" && "border-emerald-500/20 bg-emerald-500/5",
        leg.status === "lost" && "border-rose-500/20 bg-rose-500/5",
        leg.status === "void" && "border-amber-500/20 bg-amber-500/5",
        leg.status === "pending" && "border-slate-600 bg-slate-950/50"
      )}
    >
      <LegResultIcon status={leg.status} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium leading-snug text-slate-100">
          {matchName}
        </p>
        <p className="text-sm text-slate-200">
          {formatExplicitBetLine(explicit)}
          <span className="mx-1.5 text-slate-400">·</span>
          <span className="font-mono text-emerald-200">
            @{formatOdds(leg.odds)}
          </span>
        </p>
        <p className="text-xs leading-snug text-sky-200">
          {explicit.bookmakerTab}
        </p>
        <p className="text-xs text-slate-300">
          {statusLine}
          {leg.leagueName ? (
            <span className="text-slate-300"> · {leg.leagueName}</span>
          ) : null}
        </p>
      </div>
    </li>
  );
}

function BetRow({
  bet,
  removing = false,
  onDelete,
}: {
  bet: HistoryBet;
  removing?: boolean;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const hits = countLegHits(bet.legs);
  const hitsVariant = legHitsBadgeVariant(bet.status);

  const statusBadge = ticketStatusBadge(bet.status);

  const unitPnl =
    bet.status === "won"
      ? bet.potentialReturn - bet.stakeCLP
      : bet.status === "lost"
        ? -bet.stakeCLP
        : 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-slate-600 bg-slate-950/50 transition-all duration-200 ease-out motion-reduce:transition-none",
        removing
          ? "max-h-0 -translate-y-1 scale-[0.98] border-transparent opacity-0"
          : "max-h-[2000px] translate-y-0 scale-100 opacity-100"
      )}
    >
      <div className="p-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            <button
              type="button"
              aria-label="Eliminar esta combinada del historial"
              title="Eliminar del historial"
              onClick={onDelete}
              disabled={removing}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
            <Badge
              variant={hitsVariant}
              className="gap-1 font-semibold tracking-tight"
            >
              <Check className="h-3 w-3 text-emerald-400" strokeWidth={2.5} />
              {hits.won} / {hits.total} Acertadas
            </Badge>
            <Badge variant={bet.mode === "Segura" ? "success" : "warning"}>
              {bet.mode} · {bet.timeframe}
            </Badge>
            <span className="text-xs text-slate-300">{bet.date}</span>
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
      </div>

      <div className="border-t border-slate-800/80 px-2 pb-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 py-2.5 text-left text-sm text-slate-200 transition hover:bg-slate-800 hover:text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-expanded={expanded}
          disabled={removing}
        >
          <span className="inline-flex flex-wrap items-center gap-2">
            Desglose de legs
            <LegHitsInline hits={hits} className="text-slate-300" />
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-slate-300 transition-transform motion-reduce:transition-none",
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
