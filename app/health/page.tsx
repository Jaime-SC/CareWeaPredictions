"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import type { BiasBucket } from "@/lib/algorithm-health";
import { cn, formatPercent } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type HealthPayload = {
  success: boolean;
  evaluatedLegs?: number;
  overallWinRate?: number;
  overallAvgModelProb?: number;
  overallCalibrationGap?: number;
  byMarket?: BiasBucket[];
  byLeague?: BiasBucket[];
  generatedAt?: string;
  error?: string;
};

export default function HealthPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HealthPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/health");
      const json = (await res.json()) as HealthPayload;
      if (!res.ok || !json.success) {
        setError(json.error ?? "No se pudo cargar el reporte.");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("Error de red al consultar salud del algoritmo.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const gap = data?.overallCalibrationGap ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-50">
            <Activity className="h-6 w-6 text-sky-300" aria-hidden />
            Salud del algoritmo
          </h1>
          <p className="mt-2 text-base leading-relaxed text-slate-200">
            Sesgo y calibración por mercado y liga (modelo vs resultado real).
          </p>
        </header>
        <Button
          variant="outline"
          onClick={load}
          disabled={loading}
          aria-busy={loading}
          aria-label={loading ? "Actualizando reporte" : "Actualizar reporte"}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          {loading ? "Actualizando…" : "Actualizar"}
        </Button>
      </div>

      {error && (
        <Card role="alert" className="border-rose-400/50 bg-rose-950/40">
          <CardContent className="p-4 text-sm text-rose-100">{error}</CardContent>
        </Card>
      )}

      {loading && !data && (
        <p role="status" aria-live="polite" className="text-sm text-slate-300">
          Cargando reporte de calibración…
        </p>
      )}

      {data?.success && (
        <>
          <section aria-label="Resumen de calibración" className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Legs evaluadas"
              value={String(data.evaluatedLegs ?? 0)}
            />
            <Metric
              label="Win rate empírico"
              value={formatPercent(data.overallWinRate ?? 0)}
              hint={`Modelo medio ${formatPercent(data.overallAvgModelProb ?? 0)}`}
            />
            <Metric
              label="Gap de calibración"
              value={`${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(1)} pp`}
              hint={
                gap >= 0.08
                  ? "Modelo sobre-confiado"
                  : gap <= -0.08
                    ? "Modelo sub-confiado"
                    : "Dentro de banda sana"
              }
              valueClass={
                Math.abs(gap) >= 0.08 ? "text-amber-100" : "text-emerald-200"
              }
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <BiasTable title="Por mercado" rows={data.byMarket ?? []} />
            <BiasTable title="Por liga" rows={data.byLeague ?? []} />
          </div>

          {data.generatedAt && (
            <p className="text-sm text-slate-300">
              Generado {new Date(data.generatedAt).toLocaleString("es-CL")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function BiasTable({ title, rows }: { title: string; rows: BiasBucket[] }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold tracking-tight text-slate-50">
          {title}
        </h2>
        <CardDescription>
          Win rate vs probabilidad media del modelo
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-200">
            Sin legs liquidadas todavía.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{title}</caption>
              <thead className="sticky top-0 bg-[var(--background-elevated)] text-xs font-medium text-slate-300">
                <tr>
                  <th className="py-2 pr-2">Grupo</th>
                  <th className="py-2 pr-2">n</th>
                  <th className="py-2 pr-2">WR</th>
                  <th className="py-2 pr-2">Edge</th>
                  <th className="py-2">Salud</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-slate-600/80">
                    <td className="max-w-[10rem] truncate py-2 pr-2 text-slate-100">
                      {row.label}
                    </td>
                    <td className="py-2 pr-2 tabular-nums text-slate-300">
                      {row.won + row.lost}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {formatPercent(row.winRate)}
                    </td>
                    <td
                      className={cn(
                        "py-2 pr-2 tabular-nums",
                        row.avgEdge >= 0.05
                          ? "text-emerald-200"
                          : "text-slate-300"
                      )}
                    >
                      {row.avgEdge >= 0 ? "+" : ""}
                      {(row.avgEdge * 100).toFixed(1)}%
                    </td>
                    <td className="py-2">
                      <HealthBadge health={row.health} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HealthBadge({ health }: { health: BiasBucket["health"] }) {
  if (health === "healthy") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> OK
      </Badge>
    );
  }
  if (health === "overconfident") {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Sobre
      </Badge>
    );
  }
  if (health === "underconfident") {
    return (
      <Badge variant="info" className="gap-1">
        <ShieldAlert className="h-3 w-3" aria-hidden /> Sub
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="gap-1">
      Muestra baja
    </Badge>
  );
}

function Metric({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-slate-300">{label}</p>
        <p
          className={cn(
            "mt-1 text-xl font-semibold tabular-nums text-slate-50",
            valueClass
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-slate-300">{hint}</p>}
      </CardContent>
    </Card>
  );
}
