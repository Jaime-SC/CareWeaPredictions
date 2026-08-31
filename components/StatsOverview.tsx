"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatSignedCLP, type HistorySummary } from "@/lib/history-tracker";
import { formatCLP, formatPercent } from "@/lib/utils";
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
        <CardContent className="p-5">
          <p className="label-caps">Resultados liquidados</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-white">
            <span className="text-[#30d158]">{summary.won} ganadas</span>
            <span className="text-neutral-600"> · </span>
            <span className="text-[#ff453a]">{summary.lost} perdidas</span>
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <StrategySplit
              icon={<Shield className="h-3.5 w-3.5 text-[#30d158]" />}
              label="Apuestas seguras"
              won={summary.safeWon}
              lost={summary.safeLost}
            />
            <StrategySplit
              icon={<Sparkles className="h-3.5 w-3.5 text-[#ffd60a]" />}
              label="Combinadas lotería"
              won={summary.lotteryWon}
              lost={summary.lotteryLost}
            />
          </div>
          {summary.pending > 0 ? (
            <p className="mt-3 text-xs text-neutral-500">
              {summary.pending} en juego (no cuentan)
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Metric
        icon={<Percent className="h-4 w-4 text-[#64d2ff]" />}
        label="Tasa de acierto (Win Rate)"
        value={formatPercent(summary.winRate)}
        hint={
          settled > 0
            ? "Solo boletos liquidados"
            : "Sin boletos liquidados aún"
        }
        details={
          settled > 0 ? (
            <p className="text-xs tabular-nums leading-snug">
              <span className="font-medium text-[#30d158]">
                {summary.won} ganadas
              </span>
              <span className="text-neutral-600"> · </span>
              <span className="font-medium text-[#ff453a]">
                {summary.lost} perdidas
              </span>
            </p>
          ) : undefined
        }
      />
      <Metric
        icon={<TrendingUp className="h-4 w-4 text-[#30d158]" />}
        label="ROI % / Rendimiento"
        value={`${summary.roi >= 0 ? "+" : ""}${summary.roi.toFixed(1)}%`}
        hint="Ganancia neta / stake liquidado · pendientes excluidos"
        valueClass={roiPositive ? "text-[#30d158]" : "text-[#ff453a]"}
        details={
          settled > 0 ? (
            <div className="space-y-1 text-xs tabular-nums leading-snug">
              <p className="text-neutral-400">
                Inversión{" "}
                <span className="font-medium text-white">
                  {formatCLP(summary.totalStaked)}
                </span>
              </p>
              <p>
                <span className="font-medium text-[#30d158]">
                  {formatSignedCLP(summary.totalWonProfit)} ganancia
                </span>
                <span className="text-neutral-600"> · </span>
                <span className="font-medium text-[#ff453a]">
                  {formatSignedCLP(-summary.totalLost)} pérdida
                </span>
              </p>
            </div>
          ) : undefined
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
        icon={<Target className="h-4 w-4 text-[#30d158]" />}
        label="Safe picks"
        value={String(safePickCount)}
        hint={`${matchCount} partidos live`}
      />
      <Metric
        icon={<Activity className="h-4 w-4 text-[#64d2ff]" />}
        label="Edge medio"
        value={formatPercent(avgEdge)}
        hint="Modelo − implícita"
      />
      <Metric
        icon={<Ticket className="h-4 w-4 text-[#ffd60a]" />}
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
    <div className="rounded-2xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/8">
      <p className="flex items-center gap-1.5 text-xs text-neutral-400">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm font-medium tabular-nums">
        <span className="text-[#30d158]">{won} ganadas</span>
        <span className="text-neutral-600"> · </span>
        <span className="text-[#ff453a]">{lost} perdidas</span>
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
  details,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
  details?: ReactNode;
}) {
  return (
    <Card className="lift">
      <CardContent className="flex items-start gap-3 p-5">
        <div
          className="rounded-xl bg-white/8 p-2.5 ring-1 ring-white/10"
          aria-hidden
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="label-caps">{label}</p>
          <p
            className={`mt-0.5 truncate text-2xl font-bold tracking-tight ${valueClass ?? "text-white"}`}
          >
            {value}
          </p>
          {details ? <div className="mt-1.5">{details}</div> : null}
          <p className="mt-1 text-xs text-neutral-500">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}
