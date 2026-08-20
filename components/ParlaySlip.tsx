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
import {
  DEFAULT_BANKROLL_SETTINGS,
  debitBankroll,
  refundBankroll,
  useBankrollSettings,
} from "@/lib/bankroll-store";
import {
  addBetFromParlay,
  findExistingParlay,
  loadBets,
  remapLocalBetId,
  type HistoryBet,
} from "@/lib/history-tracker";
import { postBetRecord } from "@/lib/bet-record-client";
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
  sortByKickoffDesc,
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
  /** Free-plan per-minute lockout (mm:ss). Disables regenerate while set. */
  cooldownLabel?: string | null;
}

export function ParlaySlip({
  parlay,
  clipboardText,
  regenerating = false,
  fromCache = false,
  historyDate,
  onRegenerate,
  cooldownLabel = null,
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
        const formatted = formatStakeInput(String(parlay.stake));
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

  const bankroll = useBankrollSettings();
  const stakeCLP = parseStakeCLP(stakeInput);
  const potentialReturn = stakeCLP != null ? stakeCLP * activeParlay.totalOdds : null;
  const exceedsBankroll =
    stakeCLP != null && stakeCLP > bankroll.totalBankroll;
  const suggested = useParlayStakeRecommendation(
    activeParlay.totalOdds,
    activeParlay.jointProbability,
    activeParlay.legs.length
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

    const date = historyDate ?? chileDateString();
    const alreadyDb = dbTickets
      ? findExistingParlay(activeParlay, dbTickets)
      : undefined;
    if (alreadyDb) {
      setRegistered(true);
      setRegisterMsg("Ticket ya registrado en la base de datos.");
      return;
    }

    const alreadyLocal = findExistingParlay(activeParlay, loadBets());
    let local = alreadyLocal ?? null;

    if (!local) {
      const stake = parseStakeCLP(stakeInput);
      if (stake == null) {
        setRegisterMsg("Indica el monto a apostar en CLP.");
        return;
      }
      const debit = debitBankroll(stake);
      if (!debit.ok) {
        setRegisterMsg(
          debit.reason === "insufficient"
            ? `Banca insuficiente. Disponible: ${formatCLP(debit.remaining)}.`
            : "Indica el monto a apostar en CLP."
        );
        return;
      }

      local = addBetFromParlay(activeParlay, date, stake);
      if (!local) {
        refundBankroll(stake);
        setRegisterMsg("No se pudo registrar la apuesta.");
        return;
      }
    }

    try {
      const data = await postBetRecord({
        date,
        strategyMode: activeParlay.strategyMode ?? "daily-fun",
        stakeCLP: local.stakeCLP,
        totalOdds: activeParlay.totalOdds,
        payoutCLP: local.stakeCLP * activeParlay.totalOdds,
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
      });
      if (!data.success) {
        setRegistered(false);
        setRegisterMsg(
          data.error
            ? `${data.error} El ticket quedó en el historial local; reintenta para guardarlo en Neon.`
            : "Guardada localmente; falló la base de datos. Reintenta para sincronizar."
        );
        return;
      }
      setRegistered(true);
      setRegisterMsg(
        data.duplicate
          ? "Ticket ya registrado en la base de datos."
          : "Apuesta guardada en Neon."
      );
      if (typeof data.ticketId === "string") {
        remapLocalBetId(local.id, data.ticketId);
      }
    } catch {
      setRegistered(false);
      setRegisterMsg(
        "Guardada localmente; sin conexión a Neon. Reintenta para sincronizar."
      );
    }
  }, [activeParlay, dbTickets, historyDate, stakeInput]);

  const isEdited = keptLegs.length !== parlay.legs.length;
  const originalCount = parlay.legs.length;

  const orderedLegs = useMemo(
    () =>
      sortByKickoffDesc(
        activeLegs,
        (leg) => leg.kickoff,
        (leg) => leg.leagueName
      ),
    [activeLegs]
  );

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
            <h2 className="text-lg font-semibold tracking-tight text-white">
              Tu combinada
            </h2>
            <CardDescription>
              {activeParlay.legs.length} selecciones
              {isEdited ? ` de ${originalCount}` : ""}
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
              <p className="mt-2 inline-flex items-center rounded-full bg-[#30d158]/15 px-2.5 py-1 text-sm font-medium text-[#30d158] ring-1 ring-[#30d158]/25">
                {activeParlay.legs.length} partidos seleccionados para la
                apuesta real
              </p>
            )}
            {activeParlay.successProbabilityLabel && (
              <p className="mt-2 text-sm font-medium text-[#30d158]">
                {activeParlay.successProbabilityLabel}
              </p>
            )}
            {activeParlay.fillNotice && (
              <p className="mt-2 text-sm text-[#ffd60a]">
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
          <div className="space-y-3 rounded-2xl border border-dashed border-white/15 p-6 text-center">
            <p className="text-sm text-neutral-400">
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
          <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            <ul className="space-y-2">
              {orderedLegs.map((leg) => {
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
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 sm:grid-cols-3">
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
            legCount={activeParlay.legs.length}
          />
        )}

        {activeParlay.legs.length > 0 && (
          <p className="text-sm leading-relaxed text-neutral-400">
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
              disabled={regenerating || Boolean(cooldownLabel)}
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
                : cooldownLabel
                  ? `Listo en ${cooldownLabel}`
                  : fromCache
                    ? "Volver a generar para hoy"
                    : "Regenerar otra combinada"}
            </Button>
          )}
        </div>

        {activeParlay.legs.length > 0 && (
          <div className="space-y-3">
            <div className="space-y-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
              <Label htmlFor="parlay-stake-clp" className="!normal-case !tracking-normal !text-sm !font-medium !text-white">
                Monto a apostar ($ CLP)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">
                  $
                </span>
                <Input
                  id="parlay-stake-clp"
                  inputMode="decimal"
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
              <p id="parlay-stake-help" className="text-sm text-neutral-400">
                {stakeCLP != null && potentialReturn != null
                  ? exceedsBankroll
                    ? `El monto supera la banca disponible (${formatCLP(bankroll.totalBankroll)}).`
                    : `Apuesta ${formatCLP(stakeCLP)} · se descuenta de la banca · retorno potencial ${formatCLP(potentialReturn)}`
                  : "Escribe el monto en pesos chilenos para habilitar el registro."}
              </p>
            </div>
            <Button
              className="w-full"
              variant={registered ? "secondary" : "default"}
              disabled={
                registered ||
                (!findExistingParlay(activeParlay, loadBets()) &&
                  (stakeCLP == null || exceedsBankroll))
              }
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
              <p role="status" className="text-center text-sm text-neutral-400">
                {registerMsg}{" "}
                {registered && (
                  <Link
                    href="/stats"
                    className="text-[#0a84ff] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
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
        "lift flex items-start gap-2 overflow-hidden rounded-2xl bg-white/[0.04] px-3 py-3 ring-1 ring-white/10 transition-all duration-200 ease-out motion-reduce:transition-none",
        exiting
          ? "max-h-0 -translate-x-2 scale-[0.98] py-0 opacity-0 ring-transparent motion-reduce:transition-none"
          : "max-h-[280px] translate-x-0 scale-100 opacity-100"
      )}
    >
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-white">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-neutral-500">{leg.leagueName || "Otros"}</p>
        <p className="text-sm font-semibold leading-snug text-white">
          {leg.matchLabel}
        </p>
        <p className="text-sm text-neutral-200">
          Apuesta: {formatExplicitBetLine(explicit)}
          {valueBadge ? (
            <span className="ml-1 inline-flex items-center gap-0.5 text-[#ffd60a]">
              <Flame className="h-3 w-3" aria-hidden />
              {valueBadge}
            </span>
          ) : null}
        </p>
        <p className="text-xs leading-snug text-neutral-500" title={explicit.condition}>
          Condición: {explicit.condition}
        </p>
        <p className="text-xs leading-snug text-[#64d2ff]">
          {explicit.bookmakerTab}
        </p>
        <p className="flex items-start gap-1.5 text-xs leading-snug text-[#ffd60a]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{explicit.warningNote}</span>
        </p>
        {explicit.cupEquivalent ? (
          <p className="flex items-start gap-1.5 text-xs leading-snug text-[#30d158]">
            <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>{explicit.cupEquivalent}</span>
          </p>
        ) : null}
        <p className="text-xs text-neutral-500">
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
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-neutral-500">
            {leg.venue ? (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5 text-[#0a84ff]" />
                {leg.venue}
              </span>
            ) : null}
            {leg.venue && leg.referee ? (
              <span className="text-neutral-700">·</span>
            ) : null}
            {leg.referee ? <span>Árb. {leg.referee}</span> : null}
          </p>
        )}
      </div>
      <span className="font-mono text-sm font-semibold text-[#30d158]">
        @{formatOdds(leg.odds)}
      </span>
      <button
        type="button"
        aria-label={`Quitar ${leg.matchLabel}`}
        title="Quitar de la apuesta"
        onClick={onRemove}
        disabled={exiting}
        className="pressable mt-0.5 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-[#ff453a]/15 hover:text-[#ff453a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff453a] disabled:opacity-40"
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
      <p className="label-caps">{label}</p>
      <p
        className={`mt-1 font-bold tabular-nums tracking-tight ${
          highlight ? "text-2xl text-[#30d158]" : "text-xl text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
