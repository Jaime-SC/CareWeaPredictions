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
import { BottomSheet } from "@/components/bottom-sheet";
import { ParlaySlip } from "@/components/ParlaySlip";
import { SingleStakeBadge } from "@/components/stake-badge";
import { calculateSingleStake } from "@/lib/stake-engine";
import {
  debitBankroll,
  refundBankroll,
  useBankrollSettings,
} from "@/lib/bankroll-store";
import {
  addBetFromSinglePick,
  findExistingSinglePick,
  individualPickKey,
  loadBets,
  remapLocalBetId,
} from "@/lib/history-tracker";
import { postBetRecord } from "@/lib/bet-record-client";
import { contextBadgeLabels } from "@/lib/context-engine";
import { recalculateParlay } from "@/lib/parlay-recalc";
import type { GeneratedParlay, ParlayLeg, SafePickItem } from "@/lib/types";
import {
  formatExplicitBetLine,
  getExplicitPickFromLeg,
} from "@/lib/formatters";
import {
  formatCLP,
  formatKickoffTime,
  formatOdds,
  formatPercent,
  formatStakeInput,
  sortByKickoffDesc,
  parseStakeCLP,
} from "@/lib/utils";
import { formatValueBadge } from "@/lib/value-finder";
import {
  AlertTriangle,
  Check,
  Flame,
  Layers,
  Lightbulb,
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

  const ordered = useMemo(
    () =>
      sortByKickoffDesc(
        picks,
        (p) => p.kickoff,
        (p) => p.leagueName
      ),
    [picks]
  );

  function pickKey(p: SafePickItem) {
    return individualPickKey(p.matchId, p.market);
  }

  useEffect(() => {
    const keys = new Set<string>();
    const stakes: Record<string, number> = {};
    for (const pick of picks) {
      if (!pick.registered) continue;
      const key = pickKey(pick);
      keys.add(key);
      if (typeof pick.stakeCLP === "number" && pick.stakeCLP > 0) {
        stakes[key] = pick.stakeCLP;
      }
    }
    setRegisteredKeys(keys);
    setRegisteredStakes(stakes);
  }, [picks, date]);

  const suggestedStake = useMemo(() => {
    const pick = picks.find((item) => item.odds > 1 && item.modelProbability > 0);
    if (!pick) return null;
    const rec = calculateSingleStake(
      settings.totalBankroll,
      pick.modelProbability,
      pick.odds,
      { ...settings, pickCount: picks.length }
    );
    return rec.amountCLP > 0 ? rec.amountCLP : null;
  }, [picks, settings]);

  useEffect(() => {
    if (suggestedStake == null) return;
    const formatted = formatStakeInput(String(suggestedStake));
    if (stakeInput === "" || stakeInput === lastAutoStake.current) {
      lastAutoStake.current = formatted;
      setStakeInput(formatted);
    }
  }, [suggestedStake, stakeInput]);

  function openCombinada() {
    if (picks.length < 2) return;
    setCombinadaParlay(buildSafeCombinada(picks));
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

      setRegisteredKeys((prev) => new Set(prev).add(key));
      setRegisteredStakes((prev) => ({
        ...prev,
        [key]: local.stakeCLP,
      }));
      if (typeof data.ticketId === "string") {
        remapLocalBetId(local.id, data.ticketId);
      }
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

  const hasUnregistered = picks.some((pick) => !registeredKeys.has(pickKey(pick)));
  const canBuildCombinada = picks.length >= 2;

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
              {date} · modelo ≥ 85% · {picks.length} selección
              {picks.length === 1 ? "" : "es"}
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
        ) : (
          <>
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
            <ul className="space-y-3">
              {ordered.map((pick) => {
                    const key = pickKey(pick);
                    const registered = registeredKeys.has(key);
                    const savedStake = registeredStakes[key] ?? pick.stakeCLP;
                    const valueBadge = formatValueBadge(pick.edge);
                    const explicit = getExplicitPickFromLeg(pick);
                    return (
                      <li
                        key={key}
                        className="lift rounded-3xl bg-white/[0.04] p-4 ring-1 ring-white/10 sm:p-5"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-white/8 px-2.5 py-0.5 text-[11px] font-medium text-neutral-300 ring-1 ring-white/10">
                                {pick.leagueName || "Otros"}
                              </span>
                              <span className="text-xs tabular-nums text-neutral-500">
                                {formatKickoffTime(pick.kickoff)} CL
                              </span>
                              {valueBadge && (
                                <Badge variant="warning" className="gap-1">
                                  <Flame className="h-3 w-3" />
                                  {valueBadge}
                                </Badge>
                              )}
                            </div>
                            <p className="text-lg font-bold tracking-tight text-white">
                              {pick.matchLabel}
                            </p>
                            <div className="rounded-2xl border border-[#0a84ff]/20 bg-[#0a84ff]/10 px-3 py-2.5">
                              <p className="text-sm font-semibold text-[#64d2ff]">
                                {formatExplicitBetLine(explicit)}
                                <span className="mx-1.5 text-[#64d2ff]/50">·</span>
                                <span className="font-mono">
                                  @{formatOdds(pick.odds)}
                                </span>
                              </p>
                              <SingleStakeBadge
                                modelProbability={pick.modelProbability}
                                odds={pick.odds}
                                pickCount={picks.length}
                                className="mt-1.5 border-0 bg-transparent p-0 ring-0"
                              />
                            </div>
                            {registered && typeof savedStake === "number" && savedStake > 0 && (
                              <p className="text-sm text-[#30d158]">
                                Apostado {formatCLP(savedStake)}
                                <span className="mx-1.5 text-neutral-600">·</span>
                                retorno potencial {formatCLP(savedStake * pick.odds)}
                              </p>
                            )}
                            <p
                              className="text-xs leading-snug text-neutral-500"
                              title={explicit.condition}
                            >
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
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              <Badge variant="success">
                                {formatPercent(pick.modelProbability)}{" "}
                                Probabilidad
                              </Badge>
                              <Badge variant="info">
                                Edge {formatPercent(pick.edge)}
                              </Badge>
                              {contextBadgeLabels(pick.contextFlags)
                                .slice(0, 3)
                                .map((label) => (
                                  <Badge
                                    key={label}
                                    variant="default"
                                    className="font-normal"
                                  >
                                    {label}
                                  </Badge>
                                ))}
                            </div>
                          </div>
                          <div className="flex flex-col items-stretch gap-1 sm:items-end">
                            <Button
                              size="sm"
                              variant={registered ? "secondary" : "default"}
                              disabled={
                                registered ||
                                registeringKey === key ||
                                (!findExistingSinglePick(pick) &&
                                  (stakeCLP == null || exceedsBankroll))
                              }
                              onClick={() => handleRegister(pick)}
                            >
                              {registered ? (
                                <>
                                  <Check className="h-3.5 w-3.5" aria-hidden /> Registrado
                                </>
                              ) : registeringKey === key ? (
                                <>
                                  <Loader2
                                    className="h-3.5 w-3.5 animate-spin"
                                    aria-hidden
                                  />
                                  Guardando…
                                </>
                              ) : (
                                <>
                                  <Pin className="h-3.5 w-3.5" aria-hidden />
                                  Registrar pick en historial
                                </>
                              )}
                            </Button>
                            {registered && (
                              <Link
                                href="/stats"
                                className="inline-flex min-h-11 items-center justify-center text-center text-sm text-[#0a84ff] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
                              >
                                Ver en Estadísticas
                              </Link>
                            )}
                          </div>
                        </div>
                      </li>
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
