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
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-50">
            <Activity className="h-6 w-6 text-sky-400" />
            Salud del algoritmo
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Sesgo y calibración por mercado y liga (modelo vs resultado real).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Actualizar
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      {data?.success && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Legs evaluadas"
              value={String(data.evaluatedLegs ?? 0)}
            />
            <Metric
              label="Win Rate empírico"
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
                Math.abs(gap) >= 0.08 ? "text-amber-300" : "text-emerald-300"
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <BiasTable title="Por mercado" rows={data.byMarket ?? []} />
            <BiasTable title="Por liga" rows={data.byLeague ?? []} />
          </div>

          {data.generatedAt && (
            <p className="text-xs text-slate-600">
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
    <Card className="border-slate-800 bg-slate-900/60">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          Win rate vs probabilidad media del modelo
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">
            Sin legs liquidadas todavía.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-950 text-[11px] uppercase tracking-wide text-slate-500">
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
                  <tr
                    key={row.key}
                    className="border-t border-slate-800/80"
                  >
                    <td className="max-w-[10rem] truncate py-2 pr-2 text-slate-200">
                      {row.label}
                    </td>
                    <td className="py-2 pr-2 tabular-nums text-slate-400">
                      {row.won + row.lost}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {formatPercent(row.winRate)}
                    </td>
                    <td
                      className={cn(
                        "py-2 pr-2 tabular-nums",
                        row.avgEdge >= 0.05
                          ? "text-emerald-300"
                          : "text-slate-400"
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
        <CheckCircle2 className="h-3 w-3" /> OK
      </Badge>
    );
  }
  if (health === "overconfident") {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Sobre
      </Badge>
    );
  }
  if (health === "underconfident") {
    return (
      <Badge variant="info" className="gap-1">
        <ShieldAlert className="h-3 w-3" /> Sub
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
    <Card className="border-slate-800 bg-slate-900/60">
      <CardContent className="pt-4">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p
          className={cn(
            "mt-1 text-xl font-semibold tabular-nums text-slate-100",
            valueClass
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </CardContent>
    </Card>
  );
}
