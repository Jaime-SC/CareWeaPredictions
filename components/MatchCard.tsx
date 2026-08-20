"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BottomSheet } from "@/components/bottom-sheet";
import { SingleStakeBadge } from "@/components/stake-badge";
import { contextBadgeLabels } from "@/lib/context-engine";
import type { MatchPrediction } from "@/lib/types";
import { formatKickoff, formatOdds, formatPercent } from "@/lib/utils";
import { ChevronRight, MapPin, Plus, User } from "lucide-react";
import { useCallback, useState } from "react";

interface MatchCardProps {
  prediction: MatchPrediction;
  onAddPick?: (prediction: MatchPrediction) => void;
  /** Total safe picks in the current list — shrinks recommended stake when high. */
  pickCount?: number;
}

export function MatchCard({
  prediction,
  onAddPick,
  pickCount = 1,
}: MatchCardProps) {
  const { match, expectedGoals, bestSafePick, markets } = prediction;
  const [detailOpen, setDetailOpen] = useState(false);
  const closeDetail = useCallback(() => setDetailOpen(false), []);
  const topMarkets = [...markets]
    .sort((a, b) => b.modelProbability - a.modelProbability)
    .slice(0, 3);
  const badges = contextBadgeLabels(prediction.contextFlags).slice(0, 5);
  const valueEdge = bestSafePick
    ? Math.round(bestSafePick.edge * 100)
    : null;

  return (
    <Card className="lift cv-auto overflow-hidden">
      <CardContent className="space-y-4 p-4 sm:space-y-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="max-w-full truncate rounded-full bg-white/8 px-2.5 py-0.5 text-[11px] font-medium text-neutral-300 ring-1 ring-white/10">
            {match.leagueName}
          </span>
          <span className="text-xs tabular-nums text-neutral-500">
            {formatKickoff(match.kickoff)}
          </span>
          {bestSafePick && (
            <Badge variant="success" className="ml-auto">
              Safe Pick
            </Badge>
          )}
          {valueEdge != null && valueEdge > 0 && (
            <Badge variant="info">Value +{valueEdge}%</Badge>
          )}
        </div>

        <div>
          <h3 className="break-words text-lg font-bold leading-snug tracking-tight text-white sm:text-2xl">
            {match.home.name}
            <span className="mx-1.5 text-sm font-medium text-neutral-500 sm:mx-2 sm:text-base">
              vs
            </span>
            {match.away.name}
          </h3>
          {badges.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {badges.map((label) => (
                <Badge
                  key={label}
                  variant="default"
                  className="max-w-[14rem] truncate font-normal"
                  title={label}
                >
                  {label}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {(match.home.form.length > 0 || match.away.form.length > 0) && (
          <div className="flex flex-wrap gap-4 text-xs">
            <FormRow label={match.home.name} form={match.home.form} />
            <FormRow label={match.away.name} form={match.away.form} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/8 sm:p-4">
          <div>
            <p className="label-caps">xG Local</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-[#30d158] sm:text-2xl">
              {expectedGoals.home.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="label-caps">xG Visitante</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-[#64d2ff] sm:text-2xl">
              {expectedGoals.away.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {topMarkets.map((m) => (
            <div
              key={m.market}
              className="flex items-center justify-between gap-2 rounded-2xl bg-white/[0.03] px-3 py-3 text-sm ring-1 ring-white/8 sm:px-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-100">{m.label}</p>
                <p className="text-xs text-neutral-500">
                  Edge {formatPercent(m.edge)} · Impl.{" "}
                  {formatPercent(m.impliedProbability)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-base font-semibold text-white">
                  @{formatOdds(m.odds)}
                </p>
                <p className="text-xs text-[#30d158]">
                  Modelo {formatPercent(m.modelProbability)}
                </p>
              </div>
            </div>
          ))}

          {bestSafePick && (
            <div className="rounded-2xl border border-[#0a84ff]/20 bg-[#0a84ff]/10 px-3 py-3 sm:px-4">
              <p className="label-caps text-[#64d2ff]">Mercado recomendado</p>
              <p className="mt-1 break-words text-sm font-semibold text-[#64d2ff]">
                {bestSafePick.label}{" "}
                <span className="font-mono">@{formatOdds(bestSafePick.odds)}</span>
              </p>
              <SingleStakeBadge
                modelProbability={bestSafePick.modelProbability}
                odds={bestSafePick.odds}
                pickCount={pickCount}
                className="mt-2 border-0 bg-transparent p-0 text-[#64d2ff] ring-0"
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          aria-haspopup="dialog"
          className="pressable flex min-h-11 w-full select-none items-center justify-between rounded-2xl bg-white/[0.03] px-4 py-2.5 text-left text-sm text-neutral-300 ring-1 ring-white/8 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
        >
          <span>Detalle del partido</span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>

        <BottomSheet
          open={detailOpen}
          onClose={closeDetail}
          title="Detalle del partido"
        >
          <div className="space-y-3 text-sm text-neutral-300">
            <p className="text-base font-semibold text-white">
              {match.home.name} vs {match.away.name}
            </p>
            <p className="flex items-start gap-2">
              <User
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500"
                aria-hidden
              />
              <span>
                <span className="text-neutral-500">Árbitro: </span>
                {match.referee?.trim() || "No informado"}
              </span>
            </p>
            <p className="flex items-start gap-2">
              <MapPin
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500"
                aria-hidden
              />
              <span>
                <span className="text-neutral-500">Estadio: </span>
                {match.venue?.trim() || "No informado"}
              </span>
            </p>
            {(match.home.injuries?.length || match.away.injuries?.length) ? (
              <div className="space-y-1 border-t border-white/8 pt-2">
                <p className="text-neutral-500">Bajas conocidas</p>
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
              <ul className="list-inside list-disc space-y-0.5 border-t border-white/8 pt-2">
                {prediction.contextNotes.slice(0, 6).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        </BottomSheet>

        {bestSafePick && onAddPick && (
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => onAddPick(prediction)}
          >
            <Plus className="h-4 w-4" />
            Añadir {bestSafePick.label}
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
      <span className="max-w-[7rem] truncate text-neutral-500" title={label}>
        {label}
      </span>
      {form.map((r, i) => (
        <span
          key={`${label}-${i}`}
          title={r === "W" ? "Victoria" : r === "D" ? "Empate" : "Derrota"}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold ${
            r === "W"
              ? "bg-[#30d158]/20 text-[#30d158]"
              : r === "D"
                ? "bg-white/10 text-neutral-300"
                : "bg-[#ff453a]/20 text-[#ff453a]"
          }`}
          aria-hidden
        >
          {r}
        </span>
      ))}
    </div>
  );
}
