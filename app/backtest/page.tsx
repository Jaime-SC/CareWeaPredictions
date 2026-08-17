"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import type { BacktestResult } from "@/lib/backtest";
import { cn, formatOdds, formatPercent } from "@/lib/utils";
import {
  FlaskConical,
  Loader2,
  Play,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

type ApiPayload = BacktestResult & {
  success: boolean;
  winRatePct?: number;
  error?: string;
};

const WINDOWS = [30, 60, 90] as const;

const TICKET_STATUS_LABEL: Record<
  "WON" | "LOST" | "VOID" | "INCOMPLETE",
  string
> = {
  WON: "Ganada",
  LOST: "Perdida",
  VOID: "Anulada",
  INCOMPLETE: "Incompleta",
};

export default function BacktestPage() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiPayload | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/backtest?days=${days}`);
      const data = (await res.json()) as ApiPayload;
      if (!res.ok || !data.success) {
        setError(data.error ?? "No se pudo ejecutar el backtest.");
        setResult(null);
        return;
      }
      setResult(data);
    } catch {
      setError("Error de red al ejecutar el backtest.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  const roiPositive = (result?.roiPct ?? 0) >= 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-50">
          <FlaskConical className="h-6 w-6 text-emerald-300" aria-hidden />
          Backtesting histórico
        </h1>
        <p className="mt-2 text-base leading-relaxed text-slate-200">
          Simula el algoritmo activo (piso 80%, 15 legs) sobre fixtures
          finalizados en la base de datos.
        </p>
      </header>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold tracking-tight text-slate-50">
            Ventana de simulación
          </h2>
          <CardDescription>
            Elige 30–90 días y ejecuta el replay sin llamar a la API live.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div
            className="flex gap-1 rounded-xl border border-slate-600 p-1"
            role="radiogroup"
            aria-label="Ventana en días"
            onKeyDown={(event) => {
              const index = WINDOWS.indexOf(days);
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                setDays(WINDOWS[(index + 1) % WINDOWS.length]);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                setDays(
                  WINDOWS[(index - 1 + WINDOWS.length) % WINDOWS.length]
                );
              }
            }}
          >
            {WINDOWS.map((w) => {
              const checked = days === w;
              return (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => setDays(w)}
                  className={cn(
                    "min-h-11 min-w-11 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                    checked
                      ? "bg-emerald-500/20 text-emerald-100"
                      : "text-slate-200 hover:text-slate-50"
                  )}
                >
                  {w} días
                </button>
              );
            })}
          </div>
          <Button onClick={run} disabled={loading} aria-busy={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
            )}
            {loading ? "Ejecutando…" : "Ejecutar backtest"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card role="alert" className="border-rose-400/50 bg-rose-950/40">
          <CardContent className="p-4 text-sm text-rose-100">{error}</CardContent>
        </Card>
      )}

      {result && (
        <>
          <section aria-label="Resultados del backtest" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Tickets simulados"
              value={String(result.totalSimulatedTickets)}
              hint={`${result.fixturesAvailable} fixtures · ${result.daysWithPool} días con pool`}
            />
            <Metric
              label="Win rate simulado"
              value={formatPercent(result.winRate)}
              hint={`${result.won} ganadas / ${result.lost} perdidas`}
            />
            <Metric
              label="ROI total (U)"
              value={`${result.totalRoiUnits >= 0 ? "+" : ""}${result.totalRoiUnits.toFixed(2)}U`}
              hint={`${result.roiPct >= 0 ? "+" : ""}${result.roiPct.toFixed(1)}%`}
              valueClass={roiPositive ? "text-emerald-200" : "text-rose-200"}
              icon={
                roiPositive ? (
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-200" aria-hidden />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 text-rose-200" aria-hidden />
                )
              }
            />
            <Metric
              label="Cuotas media G/P"
              value={`${formatOdds(result.avgWinningOdds)} / ${formatOdds(result.avgLosingOdds)}`}
              hint="Promedio de cuotas: tickets ganadores vs perdedores"
            />
          </section>

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold tracking-tight text-slate-50">
                Tickets por día
              </h2>
              <CardDescription>
                {result.fromDate} → {result.toDate}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.tickets.length === 0 ? (
                <p className="text-sm text-slate-200">
                  No hay suficientes fixtures finalizados en la base de datos para esta
                  ventana. Registra apuestas o liquida resultados primero.
                </p>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-[var(--background-elevated)] text-xs font-medium text-slate-300">
                      <tr>
                        <th className="py-2 pr-2">Fecha</th>
                        <th className="py-2 pr-2">Legs</th>
                        <th className="py-2 pr-2">Odds</th>
                        <th className="py-2 pr-2">Prob.</th>
                        <th className="py-2 pr-2">Estado</th>
                        <th className="py-2">PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.tickets.map((t) => (
                        <tr
                          key={`${t.date}-${t.totalOdds}`}
                          className="border-t border-slate-600/80"
                        >
                          <td className="py-2 pr-2 tabular-nums text-slate-200">
                            {t.date}
                          </td>
                          <td className="py-2 pr-2 tabular-nums">{t.legs}</td>
                          <td className="py-2 pr-2 tabular-nums text-emerald-200">
                            {formatOdds(t.totalOdds)}x
                          </td>
                          <td className="py-2 pr-2 tabular-nums text-slate-300">
                            {formatPercent(t.jointProbability, 2)}
                          </td>
                          <td className="py-2 pr-2">
                            <StatusBadge status={t.status} />
                          </td>
                          <td
                            className={cn(
                              "py-2 tabular-nums",
                              t.pnlUnits > 0
                                ? "text-emerald-200"
                                : t.pnlUnits < 0
                                  ? "text-rose-200"
                                  : "text-slate-300"
                            )}
                          >
                            {t.pnlUnits >= 0 ? "+" : ""}
                            {t.pnlUnits.toFixed(2)}U
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "WON" | "LOST" | "VOID" | "INCOMPLETE";
}) {
  const variant =
    status === "WON"
      ? "success"
      : status === "LOST"
        ? "danger"
        : status === "VOID"
          ? "warning"
          : "default";
  return <Badge variant={variant}>{TICKET_STATUS_LABEL[status]}</Badge>;
}

function Metric({
  label,
  value,
  hint,
  valueClass,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
  icon?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-slate-300">{label}</p>
        <p
          className={cn(
            "mt-1 flex items-center gap-1.5 text-xl font-semibold tabular-nums text-slate-50",
            valueClass
          )}
        >
          {icon}
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-slate-300">{hint}</p>}
      </CardContent>
    </Card>
  );
}
