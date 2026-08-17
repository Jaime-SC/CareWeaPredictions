"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { contextBadgeLabels } from "@/lib/context-engine";
import type { MatchPrediction } from "@/lib/types";
import { formatKickoff, formatOdds, formatPercent } from "@/lib/utils";
import { ChevronDown, ChevronUp, MapPin, Plus, TrendingUp, User } from "lucide-react";
import { useState } from "react";

interface MatchCardProps {
  prediction: MatchPrediction;
  onAddPick?: (prediction: MatchPrediction) => void;
}

export function MatchCard({ prediction, onAddPick }: MatchCardProps) {
  const { match, expectedGoals, bestSafePick, markets } = prediction;
  const [detailOpen, setDetailOpen] = useState(false);
  const topMarkets = [...markets]
    .sort((a, b) => b.modelProbability - a.modelProbability)
    .slice(0, 3);
  const badges = contextBadgeLabels(prediction.contextFlags).slice(0, 5);

  return (
    <Card className="transition hover:border-slate-500">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-300">{match.leagueName}</p>
            <CardTitle className="mt-1 text-lg">
              {match.home.name}{" "}
              <span className="font-normal text-slate-300">vs</span>{" "}
              {match.away.name}
            </CardTitle>
            <p className="mt-1 text-xs text-slate-300">
              {formatKickoff(match.kickoff)}
            </p>
            {badges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {badges.map((label) => (
                  <Badge
                    key={label}
                    variant="info"
                    className="max-w-[14rem] truncate font-normal"
                    title={label}
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            )}
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

        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-950/80 p-3 text-sm">
          <div>
            <p className="text-xs text-slate-300">xG Local</p>
            <p className="font-semibold text-emerald-200">
              {expectedGoals.home.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-300">xG Visitante</p>
            <p className="font-semibold text-sky-200">
              {expectedGoals.away.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {topMarkets.map((m) => (
            <div
              key={m.market}
              className="flex items-center justify-between rounded-md border border-slate-600 px-3 py-2 text-sm"
            >
              <div>
                <p className="text-slate-100">{m.label}</p>
                <p className="text-xs text-slate-300">
                  Edge {formatPercent(m.edge)} · Impl.{" "}
                  {formatPercent(m.impliedProbability)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono font-semibold text-slate-50">
                  @{formatOdds(m.odds)}
                </p>
                <p className="text-xs text-emerald-200">
                  Modelo {formatPercent(m.modelProbability)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          aria-expanded={detailOpen}
          className="flex min-h-11 w-full items-center justify-between rounded-md border border-slate-600 px-3 py-2 text-left text-sm text-slate-200 transition hover:border-slate-500 hover:text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span>Detalle del partido</span>
          {detailOpen ? (
            <ChevronUp className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden />
          )}
        </button>

        {detailOpen && (
          <div className="space-y-2 rounded-md border border-slate-600 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200">
            <p className="flex items-start gap-2">
              <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
              <span>
                <span className="text-slate-300">Árbitro: </span>
                {match.referee?.trim() || "No informado"}
              </span>
            </p>
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
              <span>
                <span className="text-slate-300">Estadio: </span>
                {match.venue?.trim() || "No informado"}
              </span>
            </p>
            {(match.home.injuries?.length || match.away.injuries?.length) ? (
              <div className="space-y-1 border-t border-slate-600 pt-2">
                <p className="text-slate-300">Bajas conocidas</p>
                {(match.home.injuries ?? []).slice(0, 3).map((inj) => (
                  <p key={`h-${inj.player}`}>
                    {match.home.shortName}: {inj.player}
                    {inj.role !== "unknown" ? ` (${inj.role})` : ""}
                  </p>
                ))}
                {(match.away.injuries ?? []).slice(0, 3).map((inj) => (
                  <p key={`a-${inj.player}`}>
                    {match.away.shortName}: {inj.player}
                    {inj.role !== "unknown" ? ` (${inj.role})` : ""}
                  </p>
                ))}
              </div>
            ) : null}
            {prediction.contextNotes && prediction.contextNotes.length > 0 && (
              <ul className="list-inside list-disc space-y-0.5 border-t border-slate-600 pt-2 text-slate-200">
                {prediction.contextNotes.slice(0, 6).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}

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
    <div
      role="group"
      className="flex min-w-0 items-center gap-1.5"
      aria-label={`Forma de ${label}: ${form
        .map((r) => (r === "W" ? "victoria" : r === "D" ? "empate" : "derrota"))
        .join(", ")}`}
    >
      <span className="max-w-[7rem] truncate text-slate-300" title={label}>
        {label}
      </span>
      {form.map((r, i) => (
        <span
          key={`${label}-${i}`}
          title={r === "W" ? "Victoria" : r === "D" ? "Empate" : "Derrota"}
          className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
            r === "W"
              ? "bg-emerald-500/25 text-emerald-100"
              : r === "D"
                ? "bg-slate-600 text-slate-100"
                : "bg-rose-500/25 text-rose-100"
          }`}
          aria-hidden
        >
          {r}
        </span>
      ))}
    </div>
  );
}
