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
import {
  addBetFromParlay,
  findExistingParlay,
  loadBets,
  saveBets,
  type HistoryBet,
} from "@/lib/history-tracker";
import { contextBadgeLabels } from "@/lib/context-engine";
import { recalculateParlay } from "@/lib/parlay-recalc";
import type { GeneratedParlay, ParlayLeg } from "@/lib/types";
import {
  chileDateString,
  cn,
  formatKickoffDayLabel,
  formatOdds,
  formatPercent,
  groupByKey,
  UNIT_STAKE,
} from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  Flame,
  Lightbulb,
  Loader2,
  MapPin,
  Pin,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatSlipExportText,
  SlipExporter,
} from "@/components/slip-exporter";
import {
  formatExplicitBetLine,
  getExplicitPickFromLeg,
} from "@/lib/formatters";
import { formatValueBadge } from "@/lib/value-finder";

const EXIT_MS = 220;

function legKey(leg: ParlayLeg): string {
  return `${leg.matchId}::${leg.market}`;
}

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
  const [registered, setRegistered] = useState(false);
  const [registerMsg, setRegisterMsg] = useState<string | null>(null);
  const [activeLegs, setActiveLegs] = useState<ParlayLeg[]>(parlay.legs);
  const [exitingKeys, setExitingKeys] = useState<Set<string>>(new Set());
  const [dbTickets, setDbTickets] = useState<HistoryBet[] | null>(null);
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Sync when a new ticket is generated / restored from cache
  useEffect(() => {
    for (const timer of exitTimers.current.values()) clearTimeout(timer);
    exitTimers.current.clear();
    setExitingKeys(new Set());
    setActiveLegs(parlay.legs);
    setRegisterMsg(null);
  }, [parlay]);

  useEffect(() => {
    return () => {
      for (const timer of exitTimers.current.values()) clearTimeout(timer);
      exitTimers.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stats/summary", { cache: "no-store" });
        const data = (await res.json()) as {
          success?: boolean;
          tickets?: HistoryBet[];
        };
        if (!res.ok || !data.success || cancelled) return;
        setDbTickets(data.tickets ?? []);
      } catch {
        if (!cancelled) setDbTickets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyDate]);

  // Exclude legs mid-exit so odds / payout / joint prob update instantly
  const keptLegs = useMemo(
    () => activeLegs.filter((leg) => !exitingKeys.has(legKey(leg))),
    [activeLegs, exitingKeys]
  );

  const activeParlay = useMemo(
    () => recalculateParlay(keptLegs, parlay),
    [keptLegs, parlay]
  );

  useEffect(() => {
    const localHit = findExistingParlay(activeParlay, loadBets());
    const dbHit = dbTickets
      ? findExistingParlay(activeParlay, dbTickets)
      : undefined;
    const hit = Boolean(localHit || dbHit);
    setRegistered(hit);
    if (hit) {
      setRegisterMsg((prev) => prev ?? "Esta combinada ya está en tu historial.");
    } else {
      setRegisterMsg(null);
    }
  }, [activeParlay, dbTickets]);

  const isEdited = keptLegs.length !== parlay.legs.length;
  const originalCount = parlay.legs.length;

  const groupedLegs = useMemo(() => {
    const groups = groupByKey(activeLegs, (leg) => leg.leagueName);
    return groups.map((group) => ({
      ...group,
      items: [...group.items].sort(
        (a, b) =>
          new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
      ),
    }));
  }, [activeLegs]);

  const riskVariant =
    activeParlay.riskLevel === "low"
      ? "success"
      : activeParlay.riskLevel === "medium"
        ? "info"
        : activeParlay.riskLevel === "high"
          ? "warning"
          : "danger";

  function handleRemoveLeg(leg: ParlayLeg) {
    const key = legKey(leg);
    if (exitingKeys.has(key)) return;

    setExitingKeys((prev) => new Set(prev).add(key));

    const existing = exitTimers.current.get(key);
    if (existing) clearTimeout(existing);

    setRegisterMsg(null);

    const timer = setTimeout(() => {
      setActiveLegs((prev) => prev.filter((l) => legKey(l) !== key));
      setExitingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      exitTimers.current.delete(key);
    }, EXIT_MS);

    exitTimers.current.set(key, timer);
  }

  function handleRestore() {
    for (const timer of exitTimers.current.values()) clearTimeout(timer);
    exitTimers.current.clear();
    setExitingKeys(new Set());
    setActiveLegs(parlay.legs);
    setRegisterMsg(null);
  }

  async function handleRegister() {
    if (activeParlay.legs.length === 0) return;

    const date = historyDate ?? chileDateString();
    const already =
      findExistingParlay(activeParlay, loadBets()) ||
      (dbTickets ? findExistingParlay(activeParlay, dbTickets) : undefined);
    if (already) {
      setRegistered(true);
      setRegisterMsg("Ticket ya registrado en el historial.");
      return;
    }

    // Keep localStorage for result-checker UX; primary persistence is SQLite
    const local = addBetFromParlay(activeParlay, date);

    try {
      const res = await fetch("/api/bets/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          strategyMode: activeParlay.strategyMode ?? "daily-fun",
          stakeCLP: UNIT_STAKE,
          totalOdds: activeParlay.totalOdds,
          payoutCLP: UNIT_STAKE * activeParlay.totalOdds,
          legs: activeParlay.legs.map((l) => ({
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
              {activeParlay.legs.length} selecciones
              {isEdited ? ` de ${originalCount}` : ""} ·{" "}
              {groupedLegs.length} competición
              {groupedLegs.length === 1 ? "" : "es"}
            </CardDescription>
            {activeParlay.strategyLabel && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge
                  variant={
                    activeParlay.riskTier === "fun" ? "warning" : "success"
                  }
                >
                  {activeParlay.strategyLabel}
                </Badge>
              </div>
            )}
            {activeParlay.legs.length > 0 && (
              <p className="mt-2 inline-flex items-center rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200">
                {activeParlay.legs.length} partidos seleccionados para la
                apuesta real
              </p>
            )}
            {activeParlay.successProbabilityLabel && (
              <p className="mt-2 text-sm font-medium text-emerald-300/90">
                {activeParlay.successProbabilityLabel}
              </p>
            )}
            {activeParlay.fillNotice && (
              <p className="mt-2 text-xs text-amber-200/90">
                {activeParlay.fillNotice}
              </p>
            )}
          </div>
          <Badge variant={riskVariant}>
            {activeParlay.riskLevel.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeLegs.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed border-slate-700 p-6 text-center">
            <p className="text-sm text-slate-500">
              No quedan selecciones. Restablece el ticket o regenera la
              combinada.
            </p>
            {originalCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleRestore}>
                <RotateCcw className="h-3.5 w-3.5" />
                Restablecer Ticket
              </Button>
            )}
          </div>
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
                    const key = legKey(leg);
                    return (
                      <LegRow
                        key={key}
                        leg={leg}
                        index={legNumber}
                        exiting={exitingKeys.has(key)}
                        onRemove={() => handleRemoveLeg(leg)}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-950/70 p-4 transition-all duration-200 sm:grid-cols-3">
          <Stat
            label="Cuota total / Multiplicador"
            value={`${formatOdds(activeParlay.totalOdds)}x`}
            highlight
          />
          <Stat
            label="Probabilidad estimada"
            value={formatPercent(activeParlay.jointProbability, 2)}
          />
          <Stat
            label="Cantidad de legs"
            value={`${activeParlay.legs.length} partidos`}
          />
        </div>

        {activeParlay.legs.length > 0 && (
          <p className="text-xs leading-relaxed text-slate-400">
            {activeParlay.riskLabel}
            {" · "}
            Edge medio {formatPercent(activeParlay.averageEdge)}
            {activeParlay.hitTarget
              ? " · Objetivo ~20x–35x alcanzado"
              : " · Cerca del objetivo"}
            {isEdited
              ? ` · Editado (−${originalCount - activeParlay.legs.length})`
              : ""}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <SlipExporter
            parlay={activeParlay}
            text={
              !isEdited && clipboardText
                ? clipboardText
                : formatSlipExportText(activeParlay)
            }
            label="Copiar Boleto"
          />
          {isEdited && (
            <Button
              className="flex-1"
              variant="outline"
              onClick={handleRestore}
            >
              <RotateCcw className="h-4 w-4" />
              Restablecer Ticket
            </Button>
          )}
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
                ? "Volver a generar para hoy"
                : "Regenerar Otra Combinada"}
            </Button>
          )}
        </div>

        {activeParlay.legs.length > 0 && (
          <div className="space-y-2">
            <Button
              className="w-full"
              variant={registered ? "secondary" : "default"}
              disabled={registered}
              onClick={handleRegister}
            >
              {registered ? (
                <>
                  <Check className="h-4 w-4" /> Registrada en
                  historial
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4" />
                  Registrar Apuesta en Historial
                </>
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

function LegRow({
  leg,
  index,
  exiting,
  onRemove,
}: {
  leg: ParlayLeg;
  index: number;
  exiting: boolean;
  onRemove: () => void;
}) {
  const valueBadge = formatValueBadge(leg.edge ?? 0);
  const explicit = getExplicitPickFromLeg(leg);

  return (
    <li
      className={cn(
        "flex items-start gap-2 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5 transition-all duration-200 ease-out",
        exiting
          ? "max-h-0 -translate-x-2 scale-[0.98] border-transparent py-0 opacity-0"
          : "max-h-[280px] translate-x-0 scale-100 opacity-100"
      )}
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-800 text-[10px] font-bold text-slate-400">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-slate-100">
          {leg.matchLabel}
        </p>
        <p className="text-xs text-slate-200">
          Apuesta: {formatExplicitBetLine(explicit)}
          {valueBadge ? (
            <span className="ml-1 inline-flex items-center gap-0.5 text-amber-300">
              <Flame className="h-3 w-3 text-amber-400" />
              {valueBadge}
            </span>
          ) : null}
        </p>
        <p className="text-[11px] leading-snug text-slate-500" title={explicit.condition}>
          Condición: {explicit.condition}
        </p>
        <p className="text-[11px] leading-snug text-sky-300/90">
          {explicit.bookmakerTab}
        </p>
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-300/90">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
          <span>{explicit.warningNote}</span>
        </p>
        {explicit.cupEquivalent ? (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-emerald-300/80">
            <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
            <span>{explicit.cupEquivalent}</span>
          </p>
        ) : null}
        <p className="text-[11px] text-slate-500">
          {formatKickoffDayLabel(leg.kickoff)} CL · modelo{" "}
          {formatPercent(leg.modelProbability)}
        </p>
        {contextBadgeLabels(leg.contextFlags).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {contextBadgeLabels(leg.contextFlags)
              .slice(0, 3)
              .map((label) => (
                <Badge
                  key={label}
                  variant="info"
                  className="px-1.5 py-0 text-[10px] font-normal"
                >
                  {label}
                </Badge>
              ))}
          </div>
        )}
        {(leg.referee || leg.venue) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-slate-600">
            {leg.venue ? (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5 text-sky-500" />
                {leg.venue}
              </span>
            ) : null}
            {leg.venue && leg.referee ? (
              <span className="text-slate-700">·</span>
            ) : null}
            {leg.referee ? <span>Árb. {leg.referee}</span> : null}
          </p>
        )}
      </div>
      <span className="font-mono text-sm font-semibold text-emerald-300">
        @{formatOdds(leg.odds)}
      </span>
      <button
        type="button"
        aria-label={`Quitar ${leg.matchLabel}`}
        title="Quitar de la apuesta"
        onClick={onRemove}
        disabled={exiting}
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
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
        className={`mt-0.5 font-semibold tabular-nums transition-colors duration-200 ${
          highlight ? "text-lg text-emerald-300" : "text-slate-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
