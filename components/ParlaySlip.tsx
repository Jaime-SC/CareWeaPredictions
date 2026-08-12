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
import { addBetFromParlay, loadBets, saveBets } from "@/lib/history-tracker";
import type { GeneratedParlay, ParlayLeg } from "@/lib/types";
import {
  chileDateString,
  formatCLP,
  formatKickoffTime,
  formatOdds,
  formatPercent,
  groupByKey,
} from "@/lib/utils";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface ParlaySlipProps {
  parlay: GeneratedParlay;
  clipboardText?: string;
  regenerating?: boolean;
  fromCache?: boolean;
  /** Civil date YYYY-MM-DD for history registration */
  historyDate?: string;
  onRegenerate?: () => void;
}

export function ParlaySlip({
  parlay,
  clipboardText,
  regenerating = false,
  fromCache = false,
  historyDate,
  onRegenerate,
}: ParlaySlipProps) {
  const [copied, setCopied] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [registerMsg, setRegisterMsg] = useState<string | null>(null);

  useEffect(() => {
    setRegistered(false);
    setRegisterMsg(null);
  }, [parlay.strategyMode, parlay.totalOdds, parlay.legs.length, historyDate]);

  const groupedLegs = useMemo(() => {
    const groups = groupByKey(parlay.legs, (leg) => leg.leagueName);
    return groups.map((group) => ({
      ...group,
      items: [...group.items].sort(
        (a, b) =>
          new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
      ),
    }));
  }, [parlay.legs]);

  const riskVariant =
    parlay.riskLevel === "low"
      ? "success"
      : parlay.riskLevel === "medium"
        ? "info"
        : parlay.riskLevel === "high"
          ? "warning"
          : "danger";

  async function handleCopy() {
    const text =
      clipboardText ??
      parlay.legs
        .map(
          (l, i) =>
            `${i + 1}. ${l.matchLabel} — ${l.marketLabel} @ ${l.odds.toFixed(2)} (${(l.modelProbability * 100).toFixed(1)}%)`
        )
        .join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRegister() {
    const date = historyDate ?? chileDateString();
    // Keep localStorage for result-checker UX; primary persistence is SQLite
    const local = addBetFromParlay(parlay, date);

    try {
      const res = await fetch("/api/bets/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          strategyMode: parlay.strategyMode ?? "daily-fun",
          stakeCLP: parlay.stake,
          totalOdds: parlay.totalOdds,
          payoutCLP: parlay.potentialPayout,
          legs: parlay.legs.map((l) => ({
            matchId: l.matchId,
            matchLabel: l.matchLabel,
            leagueName: l.leagueName,
            kickoff: l.kickoff,
            market: l.market,
            marketLabel: l.marketLabel,
            odds: l.odds,
            modelProbability: l.modelProbability,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setRegisterMsg(
          typeof data.error === "string"
            ? data.error
            : local
              ? "Guardada localmente; falló SQLite."
              : "No se pudo registrar la apuesta."
        );
        if (local) setRegistered(true);
        return;
      }
      setRegistered(true);
      setRegisterMsg(
        data.duplicate
          ? "Ticket ya registrado en la base de datos."
          : "Apuesta guardada en SQLite + historial."
      );

      // Align localStorage id with SQLite ticket id for outcome sync
      if (local && typeof data.ticketId === "string") {
        const bets = loadBets().map((b) =>
          b.id === local.id ? { ...b, id: data.ticketId as string } : b
        );
        saveBets(bets);
      }
    } catch {
      if (local) {
        setRegistered(true);
        setRegisterMsg("Guardada localmente; sin conexión a la DB.");
      } else {
        setRegisterMsg("No se pudo registrar la apuesta.");
      }
    }
  }

  let legNumber = 0;

  return (
    <Card className="border-emerald-500/20 bg-gradient-to-b from-slate-900 to-slate-950">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Tu Combinada</CardTitle>
            <CardDescription>
              {parlay.legs.length} selecciones ·{" "}
              {groupedLegs.length} competición
              {groupedLegs.length === 1 ? "" : "es"}
            </CardDescription>
            {parlay.strategyLabel && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge
                  variant={
                    parlay.riskTier === "fun" ? "warning" : "success"
                  }
                >
                  {parlay.strategyLabel}
                </Badge>
                {parlay.riskTier === "fun" && (
                  <Badge variant="warning">
                    Modo Alta Varianza / Cuota Alta ($200 CLP)
                  </Badge>
                )}
              </div>
            )}
            {parlay.successProbabilityLabel && (
              <p className="mt-2 text-sm font-medium text-emerald-300/90">
                {parlay.successProbabilityLabel}
              </p>
            )}
            {parlay.fillNotice && (
              <p className="mt-2 text-xs text-amber-200/90">
                {parlay.fillNotice}
              </p>
            )}
          </div>
          <Badge variant={riskVariant}>{parlay.riskLevel.toUpperCase()}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {parlay.legs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
            Pulsa Generar Combinada para armar tu apuesta automática.
          </p>
        ) : (
          <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
            {groupedLegs.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/95 px-2.5 py-1.5 backdrop-blur">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    {group.key}
                  </h3>
                  <span className="text-[10px] text-slate-500">
                    {group.items.length} pick
                    {group.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.items.map((leg) => {
                    legNumber += 1;
                    return (
                      <LegRow
                        key={`${leg.matchId}-${leg.market}`}
                        leg={leg}
                        index={legNumber}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-950/70 p-4">
          <Stat
            label="Multiplicador"
            value={`${formatOdds(parlay.totalOdds)}x`}
          />
          <Stat label="Stake" value={formatCLP(parlay.stake)} />
          <Stat
            label="Retorno potencial"
            value={formatCLP(parlay.potentialPayout)}
            highlight
          />
          <Stat
            label="Prob. conjunta"
            value={formatPercent(parlay.jointProbability, 2)}
          />
        </div>

        {parlay.legs.length > 0 && (
          <p className="text-xs leading-relaxed text-slate-400">
            {parlay.riskLabel}
            {" · "}
            Edge medio {formatPercent(parlay.averageEdge)}
            {parlay.hitTarget
              ? " · Objetivo ~200x alcanzado"
              : " · Cerca del objetivo"}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="flex-1"
            variant="secondary"
            disabled={parlay.legs.length === 0}
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" /> Copiado
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copiar Resumen
              </>
            )}
          </Button>
          {onRegenerate && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={regenerating}
              onClick={onRegenerate}
            >
              {regenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {fromCache
                ? "🔄 Volver a generar para hoy"
                : "Regenerar Otra Combinada"}
            </Button>
          )}
        </div>

        {parlay.legs.length > 0 && (
          <div className="space-y-2">
            <Button
              className="w-full"
              variant={registered ? "secondary" : "default"}
              disabled={registered}
              onClick={handleRegister}
            >
              {registered ? (
                <>
                  <Check className="h-4 w-4" /> Registrada en historial
                </>
              ) : (
                <>📌 Registrar Apuesta en Historial</>
              )}
            </Button>
            {registerMsg && (
              <p className="text-center text-xs text-slate-400">
                {registerMsg}{" "}
                {registered && (
                  <Link
                    href="/stats"
                    className="text-emerald-400 underline-offset-2 hover:underline"
                  >
                    Ver Estadísticas
                  </Link>
                )}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LegRow({ leg, index }: { leg: ParlayLeg; index: number }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-800 text-[10px] font-bold text-slate-400">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-slate-100">
          {leg.matchLabel}
        </p>
        <p className="text-xs text-slate-400">
          {formatKickoffTime(leg.kickoff)} CL · {leg.marketLabel} · modelo{" "}
          {formatPercent(leg.modelProbability)}
        </p>
      </div>
      <span className="font-mono text-sm font-semibold text-emerald-300">
        @{formatOdds(leg.odds)}
      </span>
    </li>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-0.5 font-semibold ${
          highlight ? "text-lg text-emerald-300" : "text-slate-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
