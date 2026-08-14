"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { HistorySummary } from "@/lib/history-tracker";
import { formatPercent } from "@/lib/utils";
import {
  Activity,
  Percent,
  Shield,
  Sparkles,
  Target,
  Ticket,
  TrendingUp,
} from "lucide-react";

interface StatsOverviewProps {
  summary: HistorySummary;
}

export function StatsOverview({ summary }: StatsOverviewProps) {
  const roiPositive = summary.roi >= 0;
  const settled = summary.completed;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="sm:col-span-2">
        <CardContent className="p-4">
          <p className="text-xs text-slate-500">Resultados liquidados</p>
          <p className="mt-0.5 text-xl font-semibold text-slate-50">
            <span className="text-emerald-300">{summary.won} ganadas</span>
            <span className="text-slate-600"> · </span>
            <span className="text-rose-300">{summary.lost} perdidas</span>
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <StrategySplit
              icon={<Shield className="h-3.5 w-3.5 text-emerald-400" />}
              label="Apuestas seguras"
              won={summary.safeWon}
              lost={summary.safeLost}
            />
            <StrategySplit
              icon={<Sparkles className="h-3.5 w-3.5 text-amber-400" />}
              label="Combinadas lotería"
              won={summary.lotteryWon}
              lost={summary.lotteryLost}
            />
          </div>
          {summary.pending > 0 ? (
            <p className="mt-2 text-[11px] text-slate-500">
              {summary.pending} en juego (no cuentan)
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Metric
        icon={<Percent className="h-4 w-4 text-sky-400" />}
        label="Tasa de acierto (Win Rate)"
        value={formatPercent(summary.winRate)}
        hint={
          settled > 0
            ? "Solo boletos liquidados"
            : "Sin boletos liquidados aún"
        }
      />
      <Metric
        icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
        label="ROI % / Rendimiento"
        value={`${summary.roi >= 0 ? "+" : ""}${summary.roi.toFixed(1)}%`}
        hint="1U por ticket liquidado · pendientes excluidos"
        valueClass={roiPositive ? "text-emerald-300" : "text-rose-300"}
      />
    </div>
  );
}

/** Compact live-data strip for the Dashboard (safe picks). */
export function LivePicksOverview({
  safePickCount,
  matchCount,
  avgEdge,
}: {
  safePickCount: number;
  matchCount: number;
  avgEdge: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric
        icon={<Target className="h-4 w-4 text-emerald-400" />}
        label="Safe picks"
        value={String(safePickCount)}
        hint={`${matchCount} partidos live`}
      />
      <Metric
        icon={<Activity className="h-4 w-4 text-sky-400" />}
        label="Edge medio"
        value={formatPercent(avgEdge)}
        hint="Modelo − implícita"
      />
      <Metric
        icon={<Ticket className="h-4 w-4 text-amber-400" />}
        label="Fuente"
        value="API-Football"
        hint="Solo datos en vivo"
      />
    </div>
  );
}

function StrategySplit({
  icon,
  label,
  won,
  lost,
}: {
  icon: ReactNode;
  label: string;
  won: number;
  lost: number;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm font-medium tabular-nums">
        <span className="text-emerald-400">{won} ganadas</span>
        <span className="text-slate-600"> · </span>
        <span className="text-rose-400">{lost} perdidas</span>
      </p>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
  valueClass,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="rounded-lg bg-slate-800/80 p-2">{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <p
            className={`truncate text-xl font-semibold ${valueClass ?? "text-slate-50"}`}
          >
            {value}
          </p>
          <p className="text-[11px] text-slate-500">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}
