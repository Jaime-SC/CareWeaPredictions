"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { HistorySummary } from "@/lib/history-tracker";
import { formatSignedCLP } from "@/lib/history-tracker";
import { formatCLP, formatPercent } from "@/lib/utils";
import {
  Activity,
  Crosshair,
  Percent,
  PiggyBank,
  Target,
  Ticket,
} from "lucide-react";

interface StatsOverviewProps {
  summary: HistorySummary;
}

export function StatsOverview({ summary }: StatsOverviewProps) {
  const profitPositive = summary.netProfit >= 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric
        icon={<PiggyBank className="h-4 w-4 text-emerald-400" />}
        label="Net Profit real"
        value={formatSignedCLP(summary.netProfit)}
        hint={`Stake total ${formatCLP(summary.totalStaked)} · incl. pendientes`}
        valueClass={profitPositive ? "text-emerald-300" : "text-rose-300"}
      />
      <Metric
        icon={<Percent className="h-4 w-4 text-sky-400" />}
        label="Hit Rate"
        value={formatPercent(summary.winRate)}
        hint={`${summary.won} ganadas · ${summary.lost} perdidas`}
      />
      <Metric
        icon={<Crosshair className="h-4 w-4 text-amber-400" />}
        label="Acierto por leg"
        value={formatPercent(summary.legAccuracy)}
        hint={`${summary.legsWon}/${summary.legsEvaluated} predicciones correctas`}
      />
      <Metric
        icon={<Ticket className="h-4 w-4 text-violet-300" />}
        label="Tickets registrados"
        value={String(summary.totalBets)}
        hint={
          summary.pending > 0
            ? `${summary.pending} pendientes de resultado`
            : `${summary.completed} resueltos`
        }
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
        icon={<PiggyBank className="h-4 w-4 text-amber-400" />}
        label="Fuente"
        value="API-Football"
        hint="Solo datos en vivo"
      />
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
