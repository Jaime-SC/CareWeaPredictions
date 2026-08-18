"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { ParlayStakeBadge, useParlayStakeRecommendation } from "@/components/stake-badge";
import { DEFAULT_BANKROLL_SETTINGS } from "@/lib/bankroll-store";
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
  formatCLP,
  formatKickoffDayLabel,
  formatOdds,
  formatPercent,
  formatStakeInput,
  groupByKey,
  parseStakeCLP,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const RISK_LABELS: Record<GeneratedParlay["riskLevel"], string> = {
  low: "Riesgo bajo",
  medium: "Riesgo medio",
  high: "Riesgo alto",
  extreme: "Riesgo extremo",
};

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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
  const [stakeInput, setStakeInput] = useState("");
  const [activeLegs, setActiveLegs] = useState<ParlayLeg[]>(parlay.legs);
  const [exitingKeys, setExitingKeys] = useState<Set<string>>(new Set());
  const [dbTickets, setDbTickets] = useState<HistoryBet[] | null>(null);
  const lastAutoStake = useRef("");
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Sync when a new ticket is generated / restored from cache
  useEffect(() => {
    for (const timer of exitTimers.current.values()) clearTimeout(timer);
    exitTimers.current.clear();
    setExitingKeys(new Set());
    setActiveLegs(parlay.legs);
    if (fromCache) {
      setRegistered(true);
      setRegisterMsg("Esta combinada ya está en tu historial.");
      if (parlay.stake >= DEFAULT_BANKROLL_SETTINGS.minBookmakerStake) {
        const formatted = formatStakeInput(String(Math.round(parlay.stake)));
        lastAutoStake.current = formatted;
        setStakeInput(formatted);
      } else {
        lastAutoStake.current = "";
        setStakeInput("");
      }
    } else {
      setRegistered(false);
      setRegisterMsg(null);
      lastAutoStake.current = "";
      setStakeInput("");
    }
  }, [parlay, fromCache]);

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

  const stakeCLP = parseStakeCLP(stakeInput);
  const potentialReturn = stakeCLP != null ? stakeCLP * activeParlay.totalOdds : null;
  const suggested = useParlayStakeRecommendation(
    activeParlay.totalOdds,
    activeParlay.jointProbability
  );

  useEffect(() => {
    if (registered || suggested.amountCLP <= 0) return;
    const formatted = formatStakeInput(String(suggested.amountCLP));
    if (stakeInput === "" || stakeInput === lastAutoStake.current) {
      lastAutoStake.current = formatted;
      setStakeInput(formatted);
    }
  }, [registered, suggested.amountCLP, stakeInput]);

  const persistToNeon = useCallback(async () => {
    if (activeParlay.legs.length === 0) return;
    const stake = parseStakeCLP(stakeInput);
    if (stake == null) {
      setRegisterMsg("Indica el monto a apostar en CLP.");
      return;
    }

    const date = historyDate ?? chileDateString();
    const already =
      findExistingParlay(activeParlay, loadBets()) ||
      (dbTickets ? findExistingParlay(activeParlay, dbTickets) : undefined);
    if (already) {
      setRegistered(true);
      setRegisterMsg("Ticket ya registrado en el historial.");
      return;
    }

    const local = addBetFromParlay(activeParlay, date, stake);

    try {
      const res = await fetch("/api/bets/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          strategyMode: activeParlay.strategyMode ?? "daily-fun",
          stakeCLP: stake,
          totalOdds: activeParlay.totalOdds,
          payoutCLP: stake * activeParlay.totalOdds,
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
              ? "Guardada localmente; falló la base de datos."
              : "No se pudo registrar la apuesta."
        );
        return;
      }
      setRegistered(true);
      setRegisterMsg(
        data.duplicate
          ? "Ticket ya registrado en la base de datos."
          : "Apuesta guardada en Neon."
      );

      if (local && typeof data.ticketId === "string") {
        const bets = loadBets().map((b) =>
          b.id === local.id ? { ...b, id: data.ticketId as string } : b
        );
        saveBets(bets);
      }
    } catch {
      setRegisterMsg(
        local
          ? "Guardada localmente; sin conexión a Neon."
          : "No se pudo registrar la apuesta."
      );
    }
  }, [activeParlay, dbTickets, historyDate, stakeInput]);

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

    if (prefersReducedMotion()) {
      setActiveLegs((prev) => prev.filter((l) => legKey(l) !== key));
      setRegisterMsg(null);
      return;
    }

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

  let legNumber = 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-50">
              Tu combinada
            </h2>
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
              <p className="mt-2 inline-flex items-center rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-sm font-medium text-emerald-100">
                {activeParlay.legs.length} partidos seleccionados para la
                apuesta real
              </p>
            )}
            {activeParlay.successProbabilityLabel && (
              <p className="mt-2 text-sm font-medium text-emerald-100">
                {activeParlay.successProbabilityLabel}
              </p>
            )}
            {activeParlay.fillNotice && (
              <p className="mt-2 text-sm text-amber-100">
                {activeParlay.fillNotice}
              </p>
            )}
          </div>
          <Badge variant={riskVariant}>
            {RISK_LABELS[activeParlay.riskLevel]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeLegs.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed border-slate-600 p-6 text-center">
            <p className="text-sm text-slate-200">
              No quedan selecciones. Restablece el ticket o regenera la
              combinada.
            </p>
            {originalCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleRestore}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Restablecer Ticket
              </Button>
            )}
          </div>
        ) : (
          <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
            {groupedLegs.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-md border border-slate-600 bg-[var(--background-elevated)] px-2.5 py-1.5">
                  <p className="text-sm font-semibold text-slate-100">
                    {group.key}
                  </p>
                  <span className="text-xs text-slate-300">
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

        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-600 bg-slate-950/70 p-4 sm:grid-cols-3">
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
          <ParlayStakeBadge
            totalOdds={activeParlay.totalOdds}
            combinedProbability={activeParlay.jointProbability}
          />
        )}

        {activeParlay.legs.length > 0 && (
          <p className="text-sm leading-relaxed text-slate-300">
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
              <RotateCcw className="h-4 w-4" aria-hidden />
              Restablecer Ticket
            </Button>
          )}
          {onRegenerate && (
            <Button
              className="flex-1"
              variant="outline"
              disabled={regenerating}
              aria-busy={regenerating}
              onClick={onRegenerate}
            >
              {regenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              {regenerating
                ? "Generando…"
                : fromCache
                  ? "Volver a generar para hoy"
                  : "Regenerar otra combinada"}
            </Button>
          )}
        </div>

        {activeParlay.legs.length > 0 && (
          <div className="space-y-3">
            <div className="space-y-2 rounded-xl border border-slate-600 bg-slate-950/70 p-4">
              <Label htmlFor="parlay-stake-clp" className="text-sm text-slate-100">
                Monto a apostar ($ CLP)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">
                  $
                </span>
                <Input
                  id="parlay-stake-clp"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Ej: 10.000"
                  disabled={registered}
                  value={stakeInput}
                  onChange={(event) => {
                    setStakeInput(formatStakeInput(event.target.value));
                    if (registerMsg && !registered) setRegisterMsg(null);
                  }}
                  className="pl-7"
                  aria-describedby="parlay-stake-help"
                />
              </div>
              <p id="parlay-stake-help" className="text-sm text-slate-300">
                {stakeCLP != null && potentialReturn != null
                  ? `Apuesta ${formatCLP(stakeCLP)} · retorno potencial ${formatCLP(potentialReturn)}`
                  : "Escribe el monto en pesos chilenos para habilitar el registro."}
              </p>
            </div>
            <Button
              className="w-full"
              variant={registered ? "secondary" : "default"}
              disabled={registered || stakeCLP == null}
              onClick={() => void persistToNeon()}
            >
              {registered ? (
                <>
                  <Check className="h-4 w-4" aria-hidden /> Registrada en
                  historial
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4" aria-hidden />
                  Registrar apuesta en historial
                </>
              )}
            </Button>
            {registerMsg && (
              <p role="status" className="text-center text-sm text-slate-300">
                {registerMsg}{" "}
                {registered && (
                  <Link
                    href="/stats"
                    className="text-emerald-200 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
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
  const rotationWarning =
    leg.warning === "NEARBY_INTERNATIONAL_MATCH_PRESENT" ||
    Boolean(leg.contextFlags?.includes("NEARBY_INTERNATIONAL_MATCH_PRESENT"));
  const otherFlags = (leg.contextFlags ?? []).filter(
    (flag) => flag !== "NEARBY_INTERNATIONAL_MATCH_PRESENT"
  );

  return (
    <li
      className={cn(
        "flex items-start gap-2 overflow-hidden rounded-lg border border-slate-600 bg-slate-950/50 px-3 py-2.5 transition-all duration-200 ease-out motion-reduce:transition-none",
        exiting
          ? "max-h-0 -translate-x-2 scale-[0.98] border-transparent py-0 opacity-0 motion-reduce:transition-none"
          : "max-h-[280px] translate-x-0 scale-100 opacity-100"
      )}
    >
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-700 text-xs font-bold text-slate-100">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-slate-50">
          {leg.matchLabel}
        </p>
        <p className="text-sm text-slate-100">
          Apuesta: {formatExplicitBetLine(explicit)}
          {valueBadge ? (
            <span className="ml-1 inline-flex items-center gap-0.5 text-amber-100">
              <Flame className="h-3 w-3" aria-hidden />
              {valueBadge}
            </span>
          ) : null}
        </p>
        <p className="text-xs leading-snug text-slate-300" title={explicit.condition}>
          Condición: {explicit.condition}
        </p>
        <p className="text-xs leading-snug text-sky-200">
          {explicit.bookmakerTab}
        </p>
        <p className="flex items-start gap-1.5 text-xs leading-snug text-amber-100">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{explicit.warningNote}</span>
        </p>
        {explicit.cupEquivalent ? (
          <p className="flex items-start gap-1.5 text-xs leading-snug text-emerald-100">
            <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>{explicit.cupEquivalent}</span>
          </p>
        ) : null}
        <p className="text-xs text-slate-300">
          {formatKickoffDayLabel(leg.kickoff)} CL · modelo{" "}
          {formatPercent(leg.modelProbability)}
        </p>
        {rotationWarning && (
          <div className="mt-1">
            <Badge variant="warning" className="px-1.5 py-0 text-[10px] font-semibold">
              ⚠️ RIESGO DE ROTACIÓN (Filtro Desactivado)
            </Badge>
          </div>
        )}
        {contextBadgeLabels(otherFlags).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {contextBadgeLabels(otherFlags)
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
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-300">
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
      <span className="font-mono text-sm font-semibold text-emerald-200">
        @{formatOdds(leg.odds)}
      </span>
      <button
        type="button"
        aria-label={`Quitar ${leg.matchLabel}`}
        title="Quitar de la apuesta"
        onClick={onRemove}
        disabled={exiting}
        className="mt-0.5 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
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
      <p className="text-xs text-slate-300">
        {label}
      </p>
      <p
        className={`mt-0.5 font-semibold tabular-nums ${
          highlight ? "text-lg text-emerald-200" : "text-slate-50"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
