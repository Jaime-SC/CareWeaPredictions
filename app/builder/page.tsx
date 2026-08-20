"use client";

import { ParlaySlip } from "@/components/ParlaySlip";
import { SafePicksList } from "@/components/SafePicksList";
import { BuilderDatePicker } from "@/components/date-picker";
import { ModeSelector } from "@/components/mode-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  API_CONNECTION_ERROR_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
} from "@/lib/api-messages";
import {
  API_RATE_LIMIT_COOLDOWN_MS,
  remainingCooldownMs,
  useApiRateLimitCooldown,
} from "@/lib/api-rate-limit-cooldown";
import {
  BUILDER_MODES,
  INSUFFICIENT_MATCHES_MESSAGE,
  WEEKLY_CARTELERA_LABEL,
} from "@/config/builder-modes";
import {
  STRATEGY_LABELS,
  getStrategyPreset,
  isFunStrategy,
  isMonopolyStrategy,
  isSafeStrategy,
} from "@/lib/parlay-defaults";
import {
  fetchBuilderTickets,
  purgeLegacyBuilderLocalStorage,
  selectParlayTicket,
  selectSafeTickets,
  ticketToParlay,
  ticketsToSafePicks,
} from "@/lib/builder-restore";
import type { GeneratedParlay, SafePickItem, StrategyMode } from "@/lib/types";
import { chileDateString, getWeeklyDateRange } from "@/lib/utils";
import { CalendarDays, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_MODE: StrategyMode = "daily-safe";

function emptyParlayFor(mode: StrategyMode): GeneratedParlay {
  const preset = getStrategyPreset(mode);
  return {
    legs: [],
    totalOdds: 1,
    stake: preset.stake,
    potentialPayout: preset.stake,
    jointProbability: 0,
    riskLevel: "extreme",
    riskLabel: "Pulsa el botón para generar tu combinada automática",
    averageEdge: 0,
    hitTarget: false,
    strategyMode: mode,
    strategyLabel: STRATEGY_LABELS[mode],
    riskTier: preset.riskTier,
  };
}

export default function BuilderPage() {
  const todayCl = chileDateString();
  const week = useMemo(() => getWeeklyDateRange(), [todayCl]);

  const [strategyMode, setStrategyMode] =
    useState<StrategyMode>(DEFAULT_MODE);
  const [selectedDate, setSelectedDate] = useState(todayCl);
  const [parlay, setParlay] = useState<GeneratedParlay>(() =>
    emptyParlayFor(DEFAULT_MODE)
  );
  const [safePicks, setSafePicks] = useState<SafePickItem[]>([]);
  const [clipboard, setClipboard] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [ignoreRotationFilter, setIgnoreRotationFilter] = useState(false);
  const {
    isCoolingDown,
    label: cooldownLabel,
    arm: armRateCooldown,
    armFromResponse: armRateLimitFromResponse,
  } = useApiRateLimitCooldown();

  const preset = getStrategyPreset(strategyMode);
  const isSafe = isSafeStrategy(strategyMode);
  const isFun = isFunStrategy(strategyMode);
  const isMonopoly = isMonopolyStrategy(strategyMode);

  useEffect(() => {
    purgeLegacyBuilderLocalStorage();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setEmptyMessage(null);
    setFromCache(false);
    setGenerated(false);
    setClipboard("");
    setSafePicks([]);
    setParlay(emptyParlayFor(isSafe ? "daily-safe" : strategyMode));

    if (isSafe) {
      (async () => {
        const tickets = await fetchBuilderTickets();
        if (cancelled) return;
        const picks = ticketsToSafePicks(
          selectSafeTickets(tickets, selectedDate)
        );
        if (picks.length === 0) return;
        setSafePicks(picks);
        setGenerated(true);
        setFromCache(true);
      })();
      return () => {
        cancelled = true;
      };
    }

    const date = isMonopoly ? todayCl : selectedDate;
    (async () => {
      const tickets = await fetchBuilderTickets();
      if (cancelled) return;
      const ticket = selectParlayTicket(tickets, strategyMode, date);
      if (!ticket) return;
      setParlay(ticketToParlay(ticket));
      setClipboard("");
      setGenerated(true);
      setFromCache(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [strategyMode, selectedDate, isSafe, isMonopoly, todayCl]);

  const loadSafePicks = useCallback(
    async (opts?: { force?: boolean }) => {
      if (remainingCooldownMs() > 0) return;
      const force = opts?.force === true;

      setLoading(true);
      setError(null);
      setEmptyMessage(null);
      setFromCache(false);

      try {
        const refresh = force ? "&refresh=1" : "";
        const res = await fetch(
          `/api/predict?date=${encodeURIComponent(selectedDate)}&safeOnly=true&minProb=0.85&strategyMode=daily-safe${refresh}`
        );
        const data = await res.json().catch(() => ({}));
        const errMsg =
          typeof data.error === "string" ? data.error : undefined;

        if (!res.ok) {
          setSafePicks([]);
          setGenerated(true);
          const code = data?.code as string | undefined;
          if (armRateLimitFromResponse(res.status, errMsg)) {
            setError(
              errMsg ??
                `Plan Free (10/min). Espera ${Math.ceil(API_RATE_LIMIT_COOLDOWN_MS / 1000)}s y vuelve a intentar.`
            );
          } else if (code === "EMPTY") {
            setEmptyMessage(errMsg ?? EMPTY_MATCHES_MESSAGE);
          } else {
            setError(errMsg ?? API_CONNECTION_ERROR_MESSAGE);
          }
          return;
        }

        const picks = (data.safePicks ?? []) as SafePickItem[];
        setSafePicks(picks);
        setGenerated(true);
        if (!data.cached) {
          armRateCooldown(API_RATE_LIMIT_COOLDOWN_MS);
        }
        if (picks.length === 0) {
          setEmptyMessage(
            "No hay picks seguros (≥85%) para la fecha seleccionada."
          );
        }
      } catch {
        setSafePicks([]);
        setGenerated(true);
        setError(API_CONNECTION_ERROR_MESSAGE);
      } finally {
        setLoading(false);
      }
    },
    [selectedDate, armRateCooldown, armRateLimitFromResponse]
  );

  const generateFun = useCallback(
    async (_opts?: { force?: boolean }) => {
      if (remainingCooldownMs() > 0) return;
      setLoading(true);
      setError(null);
      setEmptyMessage(null);
      setFromCache(false);

      try {
        const res = await fetch("/api/parlay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyMode: "daily-fun",
            date: selectedDate,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const errMsg =
          typeof data.error === "string" ? data.error : undefined;

        if (!res.ok) {
          setParlay(emptyParlayFor("daily-fun"));
          setClipboard("");
          setGenerated(true);
          const code = data?.code as string | undefined;
          if (armRateLimitFromResponse(res.status, errMsg)) {
            setError(
              errMsg ??
                `Plan Free (10/min). Espera ${Math.ceil(API_RATE_LIMIT_COOLDOWN_MS / 1000)}s y vuelve a intentar.`
            );
          } else if (code === "EMPTY") {
            setEmptyMessage(errMsg ?? EMPTY_MATCHES_MESSAGE);
          } else {
            setError(errMsg ?? API_CONNECTION_ERROR_MESSAGE);
          }
          return;
        }

        const next = (data.parlay ??
          emptyParlayFor("daily-fun")) as GeneratedParlay;
        const nextClipboard =
          typeof data.clipboard === "string" ? data.clipboard : "";
        setParlay(next);
        setClipboard(nextClipboard);
        setGenerated(true);
        armRateCooldown(API_RATE_LIMIT_COOLDOWN_MS);

        if (next.legs?.length) {
          setFromCache(false);
        } else {
          setEmptyMessage(EMPTY_MATCHES_MESSAGE);
        }
      } catch {
        setGenerated(true);
        setParlay(emptyParlayFor("daily-fun"));
        setError(API_CONNECTION_ERROR_MESSAGE);
      } finally {
        setLoading(false);
      }
    },
    [selectedDate, armRateCooldown, armRateLimitFromResponse]
  );

  const generateMonopoly = useCallback(
    async (_opts?: { force?: boolean }) => {
      if (remainingCooldownMs() > 0) return;
      setLoading(true);
      setError(null);
      setEmptyMessage(null);
      setFromCache(false);

      try {
        const res = await fetch("/api/parlay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyMode: "MONOPOLY_ASYMMETRY",
            ignoreRotationFilter,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const errMsg =
          typeof data.error === "string" ? data.error : undefined;

        if (!res.ok) {
          setParlay(emptyParlayFor("monopoly-asymmetry"));
          setClipboard("");
          setGenerated(true);
          const code = data?.code as string | undefined;
          if (armRateLimitFromResponse(res.status, errMsg)) {
            setError(
              errMsg ??
                `Plan Free (10/min). Espera ${Math.ceil(API_RATE_LIMIT_COOLDOWN_MS / 1000)}s y vuelve a intentar.`
            );
          } else if (code === "EMPTY") {
            setEmptyMessage(errMsg ?? INSUFFICIENT_MATCHES_MESSAGE);
          } else {
            setError(errMsg ?? API_CONNECTION_ERROR_MESSAGE);
          }
          return;
        }

        const next = (data.parlay ??
          emptyParlayFor("monopoly-asymmetry")) as GeneratedParlay;
        const nextClipboard =
          typeof data.clipboard === "string" ? data.clipboard : "";
        setParlay(next);
        setClipboard(nextClipboard);
        setGenerated(true);
        armRateCooldown(API_RATE_LIMIT_COOLDOWN_MS);

        if (next.legs?.length) {
          setFromCache(false);
        } else {
          setEmptyMessage(
            typeof data.error === "string"
              ? data.error
              : INSUFFICIENT_MATCHES_MESSAGE
          );
        }
      } catch {
        setGenerated(true);
        setParlay(emptyParlayFor("monopoly-asymmetry"));
        setError(API_CONNECTION_ERROR_MESSAGE);
      } finally {
        setLoading(false);
      }
    },
    [ignoreRotationFilter, armRateCooldown, armRateLimitFromResponse]
  );

  const runPrimaryAction = useCallback(
    (opts?: { force?: boolean }) => {
      if (isSafe) return loadSafePicks(opts);
      if (isMonopoly) return generateMonopoly(opts);
      return generateFun(opts);
    },
    [isSafe, isMonopoly, loadSafePicks, generateFun, generateMonopoly]
  );

  const projected = `~${preset.targetMultiplier}x`;
  const showGenerateCard =
    !generated || (!!error && (isSafe ? safePicks.length === 0 : !parlay.legs.length));

  const helperId = "builder-action-help";
  const primaryLabel = isSafe
    ? `Buscar picks seguros (${selectedDate})`
    : isMonopoly
      ? "Generar cartelera semanal"
      : `Generar combinada (~${preset.targetMultiplier}x)`;

  return (
      <div className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(10,132,255,0.14),_transparent_50%),radial-gradient(ellipse_at_bottom_right,_rgba(48,209,88,0.08),_transparent_40%)]"
      />

      <div className="relative mx-auto flex max-w-5xl flex-col gap-5 px-3 py-6 sm:gap-6 sm:px-6 sm:py-10">
        <header className="text-center">
          <Badge variant="success" className="mb-4 gap-1.5">
            {isMonopoly ? (
              <>
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                Generador · {WEEKLY_CARTELERA_LABEL}
              </>
            ) : (
              <>Generador · {selectedDate} · hora Chile</>
            )}
          </Badge>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-4xl">
            Generar selecciones
          </h1>
          <p
            className={
              isMonopoly
                ? "mx-auto mt-3 max-w-3xl text-pretty text-base leading-relaxed text-neutral-400"
                : "mx-auto mt-3 text-base leading-relaxed text-neutral-400 max-sm:text-pretty sm:whitespace-nowrap"
            }
          >
            {isMonopoly
              ? "Asimetría barre la semana en curso (lunes a domingo) y arma una combinada con los gigantes que pasen anti-rotación."
              : "Elige fecha y modo. Segura: picks individuales ≥85%. Lotería: combinada de 15 legs."}
          </p>
        </header>

        <BuilderDatePicker
          selectedDate={selectedDate}
          onChange={setSelectedDate}
          weeklyMode={isMonopoly}
          weekFromYmd={week.fromYmd}
          weekToYmd={week.toYmd}
        />

        <p
          role="status"
          className="rounded-2xl bg-[#30d158]/12 px-4 py-3 text-center text-sm text-[#30d158] ring-1 ring-[#30d158]/25"
        >
          {STRATEGY_LABELS[strategyMode]} ·{" "}
          {isSafe
            ? "Picks individuales · referencia 1U · sin acumulador"
            : isMonopoly
              ? `Cartelera lun–dom · ${BUILDER_MODES.MONOPOLY_ASYMMETRY.recommendedStake} · anti-rotación`
              : `Objetivo ~${preset.targetMultiplier}x (${projected}) · ${preset.minLegs} legs · 1U`}
        </p>

        <Card>
          <CardHeader className="text-center">
            <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Elige tu estrategia
            </h2>
            <CardDescription className="text-base">
              {isMonopoly
                ? "Asimetría ignora la fecha diaria y escanea lunes a domingo"
                : "Picks y lotería se filtran por la fecha de arriba"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            <ModeSelector
              value={strategyMode}
              onChange={setStrategyMode}
              ignoreRotationFilter={ignoreRotationFilter}
              onIgnoreRotationFilterChange={setIgnoreRotationFilter}
            />

            {showGenerateCard && (
              <div className="flex flex-col items-center gap-3 pt-2">
                <Button
                  size="lg"
                  className="min-h-14 w-full max-w-md text-base font-semibold sm:text-lg"
                  onClick={() => runPrimaryAction()}
                  disabled={loading || isCoolingDown}
                  aria-busy={loading}
                  aria-describedby={helperId}
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="h-5 w-5" aria-hidden />
                  )}
                  {loading
                    ? "Generando…"
                    : isCoolingDown && cooldownLabel
                      ? `Listo en ${cooldownLabel}`
                      : primaryLabel}
                </Button>
                <p
                  id={helperId}
                  className="max-w-md text-center text-sm leading-relaxed text-neutral-400"
                >
                  {isCoolingDown
                    ? "Plan Free: máximo 10 peticiones/minuto. El contador indica cuándo puedes volver a generar."
                    : isSafe
                      ? "Lista de apuestas individuales: doble oportunidad, DNB y Over 1.5 con probabilidad modelo ≥ 85%."
                      : isMonopoly
                        ? "Escaneo lunes a domingo: monopolios domésticos ≥82% que pasen anti-rotación. Sin tope de legs."
                        : "Piso 80% por leg · cuotas 1.18–1.28 · objetivo ~20x–35x · métricas en unidades (1U)."}
                </p>
              </div>
            )}

            {generated && fromCache && (isSafe ? safePicks.length > 0 : parlay.legs.length > 0) && (
              <p role="status" className="text-center text-sm text-[#64d2ff]">
                {isSafe ? "Picks recuperados" : "Combinada recuperada"} desde Neon para{" "}
                {isMonopoly
                  ? `${week.fromYmd} → ${week.toYmd}`
                  : selectedDate}{" "}
                · modo {STRATEGY_LABELS[strategyMode]}.
              </p>
            )}
          </CardContent>
        </Card>

        {error && (
          <Card role="alert" className="bg-[#ff453a]/10 ring-[#ff453a]/30">
            <CardContent className="p-4 text-center text-sm text-[#ff453a]">
              {error}
            </CardContent>
          </Card>
        )}

        {emptyMessage && !error && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-neutral-400">
              {emptyMessage}
            </CardContent>
          </Card>
        )}

        {generated && !error && isSafe && safePicks.length > 0 && (
          <SafePicksList
            key={selectedDate}
            picks={safePicks}
            date={selectedDate}
            loading={loading}
            fromCache={fromCache}
            cooldownLabel={cooldownLabel}
            onRefresh={() => loadSafePicks({ force: true })}
          />
        )}

        {generated && !error && (isFun || isMonopoly) && parlay.legs.length > 0 && (
          <ParlaySlip
            parlay={parlay}
            clipboardText={clipboard || undefined}
            regenerating={loading}
            fromCache={fromCache}
            historyDate={isMonopoly ? todayCl : selectedDate}
            cooldownLabel={cooldownLabel}
            onRegenerate={() =>
              isMonopoly
                ? generateMonopoly({ force: true })
                : generateFun({ force: true })
            }
          />
        )}

        {generated &&
          (error ||
            emptyMessage ||
            (isSafe ? safePicks.length === 0 : parlay.legs.length === 0)) && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => runPrimaryAction({ force: true })}
                disabled={loading || isCoolingDown}
                aria-busy={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden />
                )}
                {loading
                  ? "Reintentando…"
                  : isCoolingDown && cooldownLabel
                    ? `Listo en ${cooldownLabel}`
                    : "Reintentar"}
              </Button>
            </div>
          )}
      </div>
    </div>
  );
}
