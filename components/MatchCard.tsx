"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MatchPrediction } from "@/lib/types";
import { formatKickoff, formatOdds, formatPercent } from "@/lib/utils";
import { Plus, TrendingUp } from "lucide-react";

interface MatchCardProps {
  prediction: MatchPrediction;
  onAddPick?: (prediction: MatchPrediction) => void;
}

export function MatchCard({ prediction, onAddPick }: MatchCardProps) {
  const { match, expectedGoals, bestSafePick, markets } = prediction;
  const topMarkets = [...markets]
    .sort((a, b) => b.modelProbability - a.modelProbability)
    .slice(0, 3);

  return (
    <Card className="transition hover:border-slate-700">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">{match.leagueName}</p>
            <CardTitle className="mt-1 text-lg">
              {match.home.name}{" "}
              <span className="text-slate-500 font-normal">vs</span>{" "}
              {match.away.name}
            </CardTitle>
            <p className="mt-1 text-xs text-slate-400">
              {formatKickoff(match.kickoff)}
            </p>
          </div>
          {bestSafePick && (
            <Badge variant="success">Safe Pick</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(match.home.form.length > 0 || match.away.form.length > 0) && (
          <div className="flex gap-4 text-xs">
            <FormRow label={match.home.name} form={match.home.form} />
            <FormRow label={match.away.name} form={match.away.form} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-950/50 p-3 text-sm">
          <div>
            <p className="text-xs text-slate-500">xG Local</p>
            <p className="font-semibold text-emerald-300">
              {expectedGoals.home.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">xG Visitante</p>
            <p className="font-semibold text-sky-300">
              {expectedGoals.away.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {topMarkets.map((m) => (
            <div
              key={m.market}
              className="flex items-center justify-between rounded-md border border-slate-800/80 px-3 py-2 text-sm"
            >
              <div>
                <p className="text-slate-200">{m.label}</p>
                <p className="text-xs text-slate-500">
                  Edge {formatPercent(m.edge)} · Impl.{" "}
                  {formatPercent(m.impliedProbability)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono font-semibold text-slate-50">
                  @{formatOdds(m.odds)}
                </p>
                <p className="text-xs text-emerald-400">
                  {formatPercent(m.modelProbability)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {bestSafePick && onAddPick && (
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => onAddPick(prediction)}
          >
            <Plus className="h-4 w-4" />
            Añadir {bestSafePick.label}
            <TrendingUp className="h-3.5 w-3.5 opacity-70" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function FormRow({
  label,
  form,
}: {
  label: string;
  form: ("W" | "D" | "L")[];
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="max-w-[7rem] truncate text-slate-400" title={label}>
        {label}
      </span>
      {form.map((r, i) => (
        <span
          key={`${label}-${i}`}
          className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
            r === "W"
              ? "bg-emerald-500/20 text-emerald-300"
              : r === "D"
                ? "bg-slate-700 text-slate-300"
                : "bg-rose-500/20 text-rose-300"
          }`}
        >
          {r}
        </span>
      ))}
    </div>
  );
}
