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
import {
  type BetStatus,
  type BreakdownItem,
  type HistoryBet,
  type HistoryBetLeg,
  type LegStatus,
  clearHistory,
  computeBankrollSeries,
  computeLeagueBreakdown,
  computeMarketBreakdown,
  computeStrategyBreakdown,
  computeSummary,
  countLegHits,
  formatSignedCLP,
  loadBets,
  purgeFakeHistory,
  updateBetStatus,
} from "@/lib/history-tracker";
import { formatLegMatchStatus, updatePendingBets } from "@/lib/result-checker";
import { cn, formatCLP, formatOdds, formatPercent } from "@/lib/utils";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  Loader2,
  RefreshCw,
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

export default function StatsPage() {
  const [bets, setBets] = useState<HistoryBet[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    purgeFakeHistory();
    setBets(loadBets());
    setHydrated(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-check pending fixtures once on mount (real API only)
  useEffect(() => {
    if (!hydrated) return;
    const pending = loadBets().some(
      (b) => b.status === "pending" || b.legs.some((l) => l.status === "pending")
    );
    if (!pending) return;

    let cancelled = false;
    (async () => {
      setUpdating(true);
      const result = await updatePendingBets();
      if (cancelled) return;
      setBets(result.bets);
      setUpdating(false);
      if (result.ok && result.updatedTickets > 0) {
        setUpdateMsg(
          `Auto-check: ${result.updatedTickets} ticket(s) actualizado(s) con API-Football.`
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once after hydrate
  }, [hydrated]);

  const summary = useMemo(() => computeSummary(bets), [bets]);
  const series = useMemo(() => computeBankrollSeries(bets), [bets]);
  const marketBreakdown = useMemo(
    () => computeMarketBreakdown(bets),
    [bets]
  );
  const strategyBreakdown = useMemo(
    () => computeStrategyBreakdown(bets),
    [bets]
  );
  const leagueBreakdown = useMemo(
    () => computeLeagueBreakdown(bets),
    [bets]
  );

  async function handleUpdateFromApi() {
    setUpdating(true);
    setUpdateMsg(null);
    setUpdateError(null);
    const result = await updatePendingBets();
    setBets(result.bets);
    setUpdating(false);

    if (!result.ok) {
      setUpdateError(result.error ?? "Error al actualizar.");
      return;
    }

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

  function handleStatus(id: string, status: BetStatus) {
    updateBetStatus(id, status);
    refresh();
  }

  function handleClear() {
    if (
      !window.confirm(
        "¿Limpiar todo el historial real? Esta acción no se puede deshacer."
      )
    ) {
      return;
    }
    clearHistory();
    setBets([]);
    setUpdateMsg(null);
    setUpdateError(null);
  }

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center text-sm text-slate-500">
        Cargando historial…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="info">Estadísticas</Badge>
            <Badge variant="success">Solo resultados API-Football</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50">
            Rendimiento verificado
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Net Profit, hit rate y acierto por mercado calculados únicamente
            con scores oficiales. Sin simulaciones ni backtests ficticios.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
            🔄 Actualizar Resultados de la API
          </Button>
          {bets.length > 0 && (
            <Button variant="danger" size="sm" onClick={handleClear}>
              <Trash2 className="h-4 w-4" />
              Limpiar historial
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

      {bets.length === 0 ? (
        <Card className="border-dashed border-slate-700">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <p className="max-w-lg text-sm leading-relaxed text-slate-300">
              Aún no has registrado apuestas reales. Genera una combinada y
              presiona &apos;Registrar Apuesta&apos; para hacer seguimiento
              automático con resultados oficiales.
            </p>
            <Link href="/builder">
              <Button>Ir al Generador</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <StatsOverview summary={summary} />

          <Card>
            <CardHeader>
              <CardTitle>Crecimiento de bankroll</CardTitle>
              <CardDescription>
                Beneficio acumulado en CLP (solo tickets resueltos por API o
                override)
              </CardDescription>
            </CardHeader>
            <CardContent className="h-72 pt-2 sm:h-80">
              {series.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-slate-500">
                  Sin tickets resueltos aún. Actualiza resultados cuando
                  terminen los partidos.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={series}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="bankrollFill"
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
                        `${v >= 0 ? "" : "-"}$${Math.abs(Math.round(v / 1000))}k`
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
                        formatSignedCLP(Number(value ?? 0)),
                        "Bankroll",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="bankroll"
                      stroke="#34d399"
                      strokeWidth={2}
                      fill="url(#bankrollFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownCard
              title="Acierto por Mercado"
              description="Win rate por tipo de mercado (legs evaluadas con score oficial)"
              items={marketBreakdown}
            />
            <BreakdownCard
              title="Acierto por Estrategia"
              description="Comparación Modo Segura vs Modo Diversión (tickets)"
              items={strategyBreakdown}
            />
          </div>

          <BreakdownCard
            title="Acierto por Liga"
            description="Legs correctas por competición"
            items={leagueBreakdown}
          />

          <Card>
            <CardHeader>
              <CardTitle>Historial de apuestas</CardTitle>
              <CardDescription>
                Estado automático vía API-Football · override manual disponible
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {bets.map((bet) => (
                <BetRow
                  key={bet.id}
                  bet={bet}
                  onStatus={(status) => handleStatus(bet.id, status)}
                />
              ))}
            </CardContent>
          </Card>
        </>
      )}
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
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">
            Sin legs evaluadas todavía. Actualiza resultados tras el FT.
          </p>
        ) : (
          items.map((item) => (
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
          ))
        )}
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
    leg.awayTeam ||
    leg.matchLabel.split(/\s+vs\.?\s+/i)[1] ||
    "";
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
  onStatus,
}: {
  bet: HistoryBet;
  onStatus: (status: BetStatus) => void;
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

  const pnl =
    bet.status === "won"
      ? bet.potentialReturn - bet.stakeCLP
      : bet.status === "lost"
        ? -bet.stakeCLP
        : 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
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
            {bet.legs.length} legs · @{formatOdds(bet.totalOdds)} · Stake{" "}
            {formatCLP(bet.stakeCLP)} → {formatCLP(bet.potentialReturn)}
          </p>
          {(bet.status === "won" || bet.status === "lost") && (
            <p
              className={`text-xs font-medium ${
                pnl >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              P&L {formatSignedCLP(pnl)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={bet.status === "won" ? "default" : "outline"}
            onClick={() => onStatus("won")}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ganada
          </Button>
          <Button
            size="sm"
            variant={bet.status === "lost" ? "danger" : "outline"}
            onClick={() => onStatus("lost")}
          >
            <XCircle className="h-3.5 w-3.5" />
            Perdida
          </Button>
          <Button
            size="sm"
            variant={bet.status === "void" ? "secondary" : "ghost"}
            onClick={() => onStatus("void")}
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
