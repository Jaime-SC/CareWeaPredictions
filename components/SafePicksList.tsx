"use client";

import { AiJudgeBadge } from "@/components/ai-judge-badge";
import {
  AiJudgeVetoFilterSwitch,
  useHideAiVetoesPref,
} from "@/components/ai-judge-veto-filter";
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
import { BottomSheet } from "@/components/bottom-sheet";
import { ParlaySlip } from "@/components/ParlaySlip";
import { SingleStakeBadge } from "@/components/stake-badge";
import { calculateSingleStake } from "@/lib/stake-engine";
import {
  debitBankroll,
  refundBankroll,
  useBankrollSettings,
} from "@/lib/bankroll-store";
import { fetchBuilderTickets } from "@/lib/builder-restore";
import {
  addBetFromSinglePick,
  collectRegisteredIndividualPickKeys,
  findExistingSinglePick,
  individualPickKey,
  loadBets,
  remapLocalBetId,
  type HistoryBet,
} from "@/lib/history-tracker";
import { postBetRecord } from "@/lib/bet-record-client";
import { contextBadgeLabels } from "@/lib/context-engine";
import { recalculateParlay } from "@/lib/parlay-recalc";
import type { GeneratedParlay, ParlayLeg, SafePickItem } from "@/lib/types";
import { restrictedCompetitionBadge } from "@/types/leagues";
import {
  formatExplicitBetLine,
  getExplicitPickFromLeg,
} from "@/lib/formatters";
import {
  formatCLP,
  cn,
  formatKickoffTime,
  formatOdds,
  formatPercent,
  formatStakeInput,
  sortByKickoffDesc,
  parseStakeCLP,
} from "@/lib/utils";
import { formatValueBadge } from "@/lib/value-finder";
import {
  countAiVetoes,
  filterByAiJudgeGate,
} from "@/lib/ai-judge-gate";
import { PickLegDetails } from "@/components/pick-leg-details";
import {
  Check,
  Flame,
  Layers,
  Loader2,
  Pin,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function safePickToLeg(p: SafePickItem): ParlayLeg {
  return {
    matchId: p.matchId,
    matchLabel: p.matchLabel,
    leagueName: p.leagueName,
    kickoff: p.kickoff,
    market: p.market,
    marketLabel: p.marketLabel,
    odds: p.odds,
    modelProbability: p.modelProbability,
    edge: p.edge,
    contextFlags: p.contextFlags,
    contextNotes: p.contextNotes,
    referee: p.referee,
    venue: p.venue,
    knockoutContext: p.knockoutContext,
    aiJudge: p.aiJudge,
  };
}

function buildSafeCombinada(picks: SafePickItem[]): GeneratedParlay {
  return recalculateParlay(picks.map(safePickToLeg), {
    stake: 1,
    strategyMode: "daily-safe",
    strategyLabel: "Combinada picks seguros",
    riskTier: "safe",
  });
}

interface SafePicksListProps {
  picks: SafePickItem[];
  date: string;
  loading?: boolean;
  fromCache?: boolean;
  onRefresh?: () => void;
  /** Free-plan per-minute lockout (mm:ss). Disables refresh while set. */
  cooldownLabel?: string | null;
}

export function SafePicksList({
  picks,
  date,
  loading = false,
  fromCache = false,
  onRefresh,
  cooldownLabel = null,
}: SafePicksListProps) {
  const [registeredKeys, setRegisteredKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [registeredStakes, setRegisteredStakes] = useState<
    Record<string, number>
  >({});
  const [dbTickets, setDbTickets] = useState<HistoryBet[] | null>(null);
  const [stakeInput, setStakeInput] = useState("");
  const [registerMsg, setRegisterMsg] = useState<string | null>(null);
  const [registeringKey, setRegisteringKey] = useState<string | null>(null);
  const [combinadaOpen, setCombinadaOpen] = useState(false);
  const [combinadaParlay, setCombinadaParlay] = useState<GeneratedParlay | null>(
    null
  );
  const [combinadaKey, setCombinadaKey] = useState(0);
  const stakeCLP = parseStakeCLP(stakeInput);
  const settings = useBankrollSettings();
  const exceedsBankroll =
    stakeCLP != null && stakeCLP > settings.totalBankroll;
  const lastAutoStake = useRef("");
  const [hideAiVetoes, setHideAiVetoes] = useHideAiVetoesPref();

  const visiblePicks = useMemo(
    () => filterByAiJudgeGate(picks, hideAiVetoes),
    [picks, hideAiVetoes]
  );
  const vetoCount = useMemo(() => countAiVetoes(picks), [picks]);

  const ordered = useMemo(
    () =>
      sortByKickoffDesc(
        visiblePicks,
        (p) => p.kickoff,
        (p) => p.leagueName
      ),
    [visiblePicks]
  );

  function pickKey(p: SafePickItem) {
    return individualPickKey(p.matchId, p.market);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tickets = await fetchBuilderTickets();
      if (!cancelled) setDbTickets(tickets);
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    const localBets = loadBets();
    const sourceBets = dbTickets ? [...localBets, ...dbTickets] : localBets;
    const keys = collectRegisteredIndividualPickKeys(picks, sourceBets);
    const stakes: Record<string, number> = {};
    const visible = new Set(picks.map(pickKey));

    for (const pick of picks) {
      const key = pickKey(pick);
      if (pick.registered) keys.add(key);
      if (!keys.has(key)) continue;
      const existing = findExistingSinglePick(pick, sourceBets);
      const stake = existing?.stakeCLP ?? pick.stakeCLP;
      if (typeof stake === "number" && stake > 0) stakes[key] = stake;
    }

    // Keep session-registered picks that still appear after regenerate
    setRegisteredKeys((prev) => {
      const next = new Set(keys);
      for (const key of prev) {
        if (visible.has(key)) next.add(key);
      }
      return next;
    });
    setRegisteredStakes((prev) => {
      const next = { ...stakes };
      for (const [key, stake] of Object.entries(prev)) {
        if (visible.has(key) && next[key] == null) next[key] = stake;
      }
      return next;
    });
  }, [picks, date, dbTickets]);

  const suggestedStake = useMemo(() => {
    const pick = visiblePicks.find(
      (item) => item.odds > 1 && item.modelProbability > 0
    );
    if (!pick) return null;
    const rec = calculateSingleStake(
      settings.totalBankroll,
      pick.modelProbability,
      pick.odds,
      { ...settings, pickCount: visiblePicks.length }
    );
    return rec.amountCLP > 0 ? rec.amountCLP : null;
  }, [visiblePicks, settings]);

  useEffect(() => {
    if (suggestedStake == null) return;
    const formatted = formatStakeInput(String(suggestedStake));
    if (stakeInput === "" || stakeInput === lastAutoStake.current) {
      lastAutoStake.current = formatted;
      setStakeInput(formatted);
    }
  }, [suggestedStake, stakeInput]);

  function openCombinada() {
    if (visiblePicks.length < 2) return;
    setCombinadaParlay(buildSafeCombinada(visiblePicks));
    setCombinadaKey((k) => k + 1);
    setCombinadaOpen(true);
  }

  const closeCombinada = useCallback(() => {
    setCombinadaOpen(false);
  }, []);

  async function handleRegister(pick: SafePickItem) {
    const key = pickKey(pick);
    const alreadyLocal = findExistingSinglePick(pick, loadBets());
    let local = alreadyLocal ?? null;

    if (!local) {
      if (stakeCLP == null) return;
      if (stakeCLP > settings.totalBankroll) return;
      const debit = debitBankroll(stakeCLP);
      if (!debit.ok) return;
      local = addBetFromSinglePick(pick, stakeCLP, date);
      if (!local) {
        refundBankroll(stakeCLP);
        return;
      }
    }

    setRegisteringKey(key);
    setRegisterMsg(null);
    setRegisteredKeys((prev) => new Set(prev).add(key));
    setRegisteredStakes((prev) => ({
      ...prev,
      [key]: local.stakeCLP,
    }));
    try {
      const data = await postBetRecord({
        date,
        strategyMode: "daily-safe",
        mode: "Segura",
        stakeCLP: local.stakeCLP,
        totalOdds: pick.odds,
        payoutCLP: local.stakeCLP * pick.odds,
        legs: [
          {
            matchId: pick.matchId,
            matchLabel: pick.matchLabel,
            leagueName: pick.leagueName,
            kickoff: pick.kickoff,
            market: pick.market,
            marketLabel: pick.marketLabel,
            odds: pick.odds,
            modelProbability: pick.modelProbability,
          },
        ],
      });
      if (!data.success) {
        setRegisterMsg(
          data.error
            ? `${data.error} Quedó en el historial local; reintenta para guardarlo en Neon.`
            : "Guardada localmente; falló la base de datos. Reintenta para sincronizar."
        );
        return;
      }

      if (typeof data.ticketId === "string") {
        remapLocalBetId(local.id, data.ticketId);
      }
      setDbTickets((prev) => {
        if (!prev) return prev;
        if (prev.some((t) => t.id === (data.ticketId ?? local.id))) return prev;
        return [local, ...prev];
      });
      setRegisterMsg(
        data.duplicate
          ? "Pick ya registrado en la base de datos."
          : "Pick guardado en Neon."
      );
    } catch {
      setRegisterMsg(
        "Guardada localmente; sin conexión a Neon. Reintenta para sincronizar."
      );
    } finally {
      setRegisteringKey(null);
    }
  }

  const hasUnregistered = visiblePicks.some(
    (pick) => !registeredKeys.has(pickKey(pick))
  );
  const canBuildCombinada = visiblePicks.length >= 2;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
              <Target className="h-5 w-5 text-[#30d158]" aria-hidden />
              Picks seguros individuales
            </h2>
            <CardDescription>
              {date} · modelo ≥ 85% · {visiblePicks.length} selección
              {visiblePicks.length === 1 ? "" : "es"}
              {hideAiVetoes && vetoCount > 0
                ? ` · ${vetoCount} veto${vetoCount === 1 ? "" : "s"} oculto${vetoCount === 1 ? "" : "s"}`
                : ""}
            </CardDescription>
            {fromCache && (
              <p role="status" className="mt-2 text-sm text-[#64d2ff]">
                Lista recuperada desde Neon para esta fecha.
              </p>
            )}
            {registerMsg && (
              <p role="status" className="mt-2 text-sm text-[#ffd60a]">
                {registerMsg}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canBuildCombinada && (
              <Button
                variant="default"
                size="sm"
                onClick={openCombinada}
                aria-label="Generar combinada con todos los picks seguros"
              >
                <Layers className="h-4 w-4" aria-hidden />
                Generar combinada
              </Button>
            )}
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={loading || Boolean(cooldownLabel)}
                aria-busy={loading}
                aria-label={
                  loading
                    ? "Actualizando picks"
                    : cooldownLabel
                      ? `Espera ${cooldownLabel} para actualizar`
                      : "Actualizar picks"
                }
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                {loading
                  ? "Actualizando…"
                  : cooldownLabel
                    ? `Listo en ${cooldownLabel}`
                    : "Actualizar"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {picks.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-neutral-400">
            No hay picks con probabilidad modelo ≥ 85% para esta fecha.
          </p>
        ) : visiblePicks.length === 0 ? (
          <div className="space-y-4">
            <AiJudgeVetoFilterSwitch
              hideVetoes={hideAiVetoes}
              onChange={setHideAiVetoes}
              vetoCount={vetoCount}
            />
            <p className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-neutral-400">
              Todos los picks de esta fecha están vetados por IA Judge. Desactiva
              el filtro para verlos.
            </p>
          </div>
        ) : (
          <>
            <AiJudgeVetoFilterSwitch
              hideVetoes={hideAiVetoes}
              onChange={setHideAiVetoes}
              vetoCount={vetoCount}
            />
            {hasUnregistered && (
            <div className="space-y-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
              <Label htmlFor="safe-stake-clp" className="!normal-case !tracking-normal !text-sm !font-medium !text-white">
                Monto a apostar por pick ($ CLP)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">
                  $
                </span>
                <Input
                  id="safe-stake-clp"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Ej: 5.000"
                  value={stakeInput}
                  onChange={(event) =>
                    setStakeInput(formatStakeInput(event.target.value))
                  }
                  className="pl-7"
                  aria-describedby="safe-stake-help"
                />
              </div>
              <p id="safe-stake-help" className="text-sm text-neutral-400">
                {stakeCLP != null
                  ? exceedsBankroll
                    ? `El monto supera la banca disponible (${formatCLP(settings.totalBankroll)}).`
                    : `Cada pick nuevo se registrará con ${formatCLP(stakeCLP)} y se descuenta de la banca. El badge de cada card muestra el Kelly 25% sugerido para esa cuota.`
                  : "Escribe el monto en pesos chilenos para habilitar el registro."}
              </p>
            </div>
            )}
          <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
            <ul className="space-y-4">
              {ordered.map((pick) => {
                const key = pickKey(pick);
                return (
                  <SafePickCard
                    key={key}
                    pick={pick}
                    registered={registeredKeys.has(key)}
                    savedStake={registeredStakes[key] ?? pick.stakeCLP}
                    categoryBadge={restrictedCompetitionBadge(
                      undefined,
                      pick.leagueName
                    )}
                    visiblePickCount={visiblePicks.length}
                    registering={registeringKey === key}
                    canRegister={
                      Boolean(findExistingSinglePick(pick)) ||
                      (stakeCLP != null && !exceedsBankroll)
                    }
                    onRegister={() => handleRegister(pick)}
                  />
                );
              })}
            </ul>
          </div>
          </>
        )}
      </CardContent>

      <BottomSheet
        open={combinadaOpen && combinadaParlay != null}
        onClose={closeCombinada}
        title="Combinada de picks seguros"
        desktopClassName="md:!w-[min(36rem,calc(100vw-2rem))]"
      >
        {combinadaParlay ? (
          <ParlaySlip
            key={combinadaKey}
            parlay={combinadaParlay}
            historyDate={date}
            embedded
          />
        ) : null}
      </BottomSheet>
    </Card>
  );
}

function SafePickCard({
  pick,
  registered,
  savedStake,
  categoryBadge,
  visiblePickCount,
  registering,
  canRegister,
  onRegister,
}: {
  pick: SafePickItem;
  registered: boolean;
  savedStake?: number;
  categoryBadge: string | null;
  visiblePickCount: number;
  registering: boolean;
  canRegister: boolean;
  onRegister: () => void;
}) {
  const explicit = getExplicitPickFromLeg(pick);
  const valueBadge = formatValueBadge(pick.edge);
  const contextLabels = contextBadgeLabels(pick.contextFlags).slice(0, 3);
  const aiApproved = pick.aiJudge?.approved !== false;

  return (
    <li className="lift overflow-hidden rounded-3xl bg-white/[0.04] ring-1 ring-white/10">
      <div className="border-b border-white/8 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="rounded-full bg-white/8 px-2.5 py-0.5 text-[11px] font-medium text-neutral-300 ring-1 ring-white/10">
            {pick.leagueName || "Otros"}
          </span>
          {categoryBadge ? (
            <Badge
              variant="info"
              className="max-w-[14rem] truncate font-normal"
              title={categoryBadge}
            >
              {categoryBadge}
            </Badge>
          ) : null}
          <span className="text-xs tabular-nums text-neutral-500">
            {formatKickoffTime(pick.kickoff)} CL
          </span>
          {valueBadge ? (
            <Badge variant="warning" className="ml-auto gap-1">
              <Flame className="h-3 w-3" aria-hidden />
              {valueBadge}
            </Badge>
          ) : null}
        </div>
        <h3 className="mt-2.5 text-lg font-bold leading-snug tracking-tight text-white sm:text-xl">
          {pick.matchLabel}
        </h3>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-[#30d158]/12 px-2.5 py-0.5 text-[11px] font-medium text-[#30d158] ring-1 ring-[#30d158]/25">
            {formatPercent(pick.modelProbability)} modelo
          </span>
          <span className="rounded-full bg-[#0a84ff]/12 px-2.5 py-0.5 text-[11px] font-medium text-[#64d2ff] ring-1 ring-[#0a84ff]/25">
            Edge {formatPercent(pick.edge)}
          </span>
          {contextLabels.map((label) => (
            <span
              key={label}
              className="rounded-full bg-white/6 px-2.5 py-0.5 text-[11px] font-normal text-neutral-400 ring-1 ring-white/10"
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div className="rounded-2xl border border-[#0a84ff]/25 bg-gradient-to-br from-[#0a84ff]/14 via-[#0a84ff]/6 to-transparent p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64d2ff]/75">
                Tu apuesta
              </p>
              <p className="mt-1 text-sm font-semibold leading-snug text-white">
                {formatExplicitBetLine(explicit)}
              </p>
            </div>
            <p className="shrink-0 font-mono text-2xl font-bold leading-none text-white">
              @{formatOdds(pick.odds)}
            </p>
          </div>
          <SingleStakeBadge
            modelProbability={pick.modelProbability}
            odds={pick.odds}
            pickCount={visiblePickCount}
            className="mt-3"
          />
        </div>

        {registered && typeof savedStake === "number" && savedStake > 0 ? (
          <div className="rounded-xl bg-[#30d158]/10 px-3.5 py-2.5 text-sm text-[#30d158] ring-1 ring-[#30d158]/20">
            <span className="font-medium">Apostado {formatCLP(savedStake)}</span>
            <span className="mx-1.5 text-[#30d158]/50">·</span>
            <span>retorno potencial {formatCLP(savedStake * pick.odds)}</span>
          </div>
        ) : null}

        {pick.aiJudge ? (
          <div
            className={cn(
              "rounded-2xl border-l-[3px] px-3.5 py-3",
              aiApproved
                ? "border-[#30d158] bg-[#30d158]/8"
                : "border-[#ff453a] bg-[#ff453a]/8"
            )}
          >
            <AiJudgeBadge verdict={pick.aiJudge} />
          </div>
        ) : null}

        <PickLegDetails explicit={explicit} />

        <div className="flex flex-col gap-2 border-t border-white/8 pt-3 sm:flex-row sm:items-center sm:justify-end">
          <Button
            size="sm"
            variant={registered ? "secondary" : "default"}
            disabled={registered || registering || !canRegister}
            onClick={onRegister}
            className="w-full sm:w-auto sm:min-w-[12rem]"
          >
            {registered ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden /> Registrado
              </>
            ) : registering ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Guardando…
              </>
            ) : (
              <>
                <Pin className="h-3.5 w-3.5" aria-hidden />
                Registrar pick
              </>
            )}
          </Button>
          {registered ? (
            <Link
              href="/stats"
              className="inline-flex min-h-10 items-center justify-center text-center text-sm text-[#0a84ff] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff] sm:px-3"
            >
              Ver en Estadísticas
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}
