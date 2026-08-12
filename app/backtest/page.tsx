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
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-50">
          <FlaskConical className="h-6 w-6 text-emerald-400" />
          Backtesting histórico
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Simula el algoritmo activo (piso 80%, 15 legs) sobre fixtures
          finalizados en SQLite.
        </p>
      </div>

      <Card className="border-slate-800 bg-slate-900/60">
        <CardHeader>
          <CardTitle className="text-base">Ventana de simulación</CardTitle>
          <CardDescription>
            Elige 30–90 días y ejecuta el replay sin llamar a la API live.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-slate-800 p-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setDays(w)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition",
                  days === w
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                {w}d
              </button>
            ))}
          </div>
          <Button onClick={run} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Ejecutar backtest
          </Button>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Tickets simulados"
              value={String(result.totalSimulatedTickets)}
              hint={`${result.fixturesAvailable} fixtures · ${result.daysWithPool} días con pool`}
            />
            <Metric
              label="Win Rate simulado"
              value={formatPercent(result.winRate)}
              hint={`${result.won}G / ${result.lost}P`}
            />
            <Metric
              label="ROI total (U)"
              value={`${result.totalRoiUnits >= 0 ? "+" : ""}${result.totalRoiUnits.toFixed(2)}U`}
              hint={`${result.roiPct >= 0 ? "+" : ""}${result.roiPct.toFixed(1)}%`}
              valueClass={roiPositive ? "text-emerald-300" : "text-rose-300"}
              icon={
                roiPositive ? (
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
                )
              }
            />
            <Metric
              label="Cuotas media G/P"
              value={`${formatOdds(result.avgWinningOdds)} / ${formatOdds(result.avgLosingOdds)}`}
              hint="Promedio odds tickets ganadores vs perdedores"
            />
          </div>

          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="text-base">Tickets por día</CardTitle>
              <CardDescription>
                {result.fromDate} → {result.toDate}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.tickets.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No hay suficientes fixtures finalizados en SQLite para esta
                  ventana. Registra apuestas o liquida resultados primero.
                </p>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-950 text-[11px] uppercase tracking-wide text-slate-500">
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
                          className="border-t border-slate-800/80"
                        >
                          <td className="py-2 pr-2 tabular-nums text-slate-300">
                            {t.date}
                          </td>
                          <td className="py-2 pr-2 tabular-nums">{t.legs}</td>
                          <td className="py-2 pr-2 tabular-nums text-emerald-300/90">
                            {formatOdds(t.totalOdds)}x
                          </td>
                          <td className="py-2 pr-2 tabular-nums text-slate-400">
                            {formatPercent(t.jointProbability, 2)}
                          </td>
                          <td className="py-2 pr-2">
                            <StatusBadge status={t.status} />
                          </td>
                          <td
                            className={cn(
                              "py-2 tabular-nums",
                              t.pnlUnits > 0
                                ? "text-emerald-300"
                                : t.pnlUnits < 0
                                  ? "text-rose-300"
                                  : "text-slate-500"
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
  return <Badge variant={variant}>{status}</Badge>;
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
    <Card className="border-slate-800 bg-slate-900/60">
      <CardContent className="pt-4">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p
          className={cn(
            "mt-1 flex items-center gap-1.5 text-xl font-semibold tabular-nums text-slate-100",
            valueClass
          )}
        >
          {icon}
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}
