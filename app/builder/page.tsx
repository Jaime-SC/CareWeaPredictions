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
  CardTitle,
} from "@/components/ui/card";
import {
  API_CONNECTION_ERROR_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
} from "@/lib/api-messages";
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
  type SafePickItem,
  cleanupExpiredParlays,
  loadStoredParlay,
  loadStoredSafePicks,
  saveParlay,
  saveSafePicks,
} from "@/lib/parlay-storage";
import type { GeneratedParlay, StrategyMode } from "@/lib/types";
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
  const monopolyWeekKey = week.fromYmd;

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

  const preset = getStrategyPreset(strategyMode);
  const isSafe = isSafeStrategy(strategyMode);
  const isFun = isFunStrategy(strategyMode);
  const isMonopoly = isMonopolyStrategy(strategyMode);

  useEffect(() => {
    cleanupExpiredParlays(todayCl);
  }, [todayCl]);

  // Restore cache when mode or date changes
  useEffect(() => {
    setError(null);
    setEmptyMessage(null);

    if (isSafe) {
      const cached = loadStoredSafePicks(selectedDate);
      if (cached && cached.picks.length > 0) {
        setSafePicks(cached.picks);
        setParlay(emptyParlayFor("daily-safe"));
        setClipboard("");
        setGenerated(true);
        setFromCache(true);
        return;
      }
      setSafePicks([]);
      setGenerated(false);
      setFromCache(false);
      return;
    }

    const cacheDate = isMonopoly ? monopolyWeekKey : selectedDate;
    const cached = loadStoredParlay(strategyMode, cacheDate);
    if (cached) {
      setParlay(cached.parlay);
      setClipboard(cached.clipboard);
      setSafePicks([]);
      setGenerated(true);
      setFromCache(true);
      return;
    }
    setParlay(emptyParlayFor(strategyMode));
    setClipboard("");
    setSafePicks([]);
    setGenerated(false);
    setFromCache(false);
  }, [strategyMode, selectedDate, isSafe, isMonopoly, monopolyWeekKey]);

  const loadSafePicks = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = opts?.force === true;
      if (!force) {
        const cached = loadStoredSafePicks(selectedDate);
        if (cached && cached.picks.length > 0) {
          setSafePicks(cached.picks);
          setGenerated(true);
          setFromCache(true);
          setError(null);
          setEmptyMessage(null);
          return;
        }
      }

      setLoading(true);
      setError(null);
      setEmptyMessage(null);
      setFromCache(false);

      try {
        const res = await fetch(
          `/api/predict?date=${encodeURIComponent(selectedDate)}&safeOnly=true&minProb=0.85&strategyMode=daily-safe`
        );
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setSafePicks([]);
          setGenerated(true);
          const code = data?.code as string | undefined;
          if (code === "EMPTY") {
            setEmptyMessage(
              typeof data.error === "string"
                ? data.error
                : EMPTY_MATCHES_MESSAGE
            );
          } else {
            setError(
              typeof data.error === "string"
                ? data.error
                : API_CONNECTION_ERROR_MESSAGE
            );
          }
          return;
        }

        const picks = (data.safePicks ?? []) as SafePickItem[];
        setSafePicks(picks);
        setGenerated(true);
        if (picks.length === 0) {
          setEmptyMessage(
            "No hay picks seguros (≥85%) para la fecha seleccionada."
          );
        } else {
          saveSafePicks(picks, selectedDate);
        }
      } catch {
        setSafePicks([]);
        setGenerated(true);
        setError(API_CONNECTION_ERROR_MESSAGE);
      } finally {
        setLoading(false);
      }
    },
    [selectedDate]
  );

  const generateFun = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = opts?.force === true;

      if (!force) {
        const cached = loadStoredParlay("daily-fun", selectedDate);
        if (cached) {
          setParlay(cached.parlay);
          setClipboard(cached.clipboard);
          setGenerated(true);
          setError(null);
          setEmptyMessage(null);
          setFromCache(true);
          return;
        }
      }

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

        if (!res.ok) {
          setParlay(emptyParlayFor("daily-fun"));
          setClipboard("");
          setGenerated(true);
          const code = data?.code as string | undefined;
          if (code === "EMPTY") {
            setEmptyMessage(
              typeof data.error === "string"
                ? data.error
                : EMPTY_MATCHES_MESSAGE
            );
          } else {
            setError(
              typeof data.error === "string"
                ? data.error
                : API_CONNECTION_ERROR_MESSAGE
            );
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

        if (next.legs?.length) {
          saveParlay("daily-fun", next, nextClipboard, selectedDate);
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
    [selectedDate]
  );

  const generateMonopoly = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = opts?.force === true;

      if (!force) {
        const cached = loadStoredParlay("monopoly-asymmetry", monopolyWeekKey);
        if (cached) {
          setParlay(cached.parlay);
          setClipboard(cached.clipboard);
          setGenerated(true);
          setError(null);
          setEmptyMessage(null);
          setFromCache(true);
          return;
        }
      }

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
          }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setParlay(emptyParlayFor("monopoly-asymmetry"));
          setClipboard("");
          setGenerated(true);
          const code = data?.code as string | undefined;
          if (code === "EMPTY") {
            setEmptyMessage(
              typeof data.error === "string"
                ? data.error
                : INSUFFICIENT_MATCHES_MESSAGE
            );
          } else {
            setError(
              typeof data.error === "string"
                ? data.error
                : API_CONNECTION_ERROR_MESSAGE
            );
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

        if (next.legs?.length) {
          saveParlay("monopoly-asymmetry", next, nextClipboard, monopolyWeekKey);
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
    [monopolyWeekKey]
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

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.14),_transparent_50%),radial-gradient(ellipse_at_bottom_right,_rgba(14,165,233,0.08),_transparent_40%)]" />

      <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="text-center">
          <Badge variant="success" className="mb-4 gap-1.5">
            {isMonopoly ? (
              <>
                <CalendarDays className="h-3.5 w-3.5 text-emerald-400" />
                Generador · {WEEKLY_CARTELERA_LABEL}
              </>
            ) : (
              <>Generador · {selectedDate} · hora Chile</>
            )}
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
            Generar Selecciones
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
            {isMonopoly
              ? "Asimetría barre sola la semana en curso (lunes a domingo) y arma una combinada dinámica con todos los gigantes que pasen anti-rotación."
              : "Elige fecha y modo. Segura = picks individuales ≥85%. Lotería = combinada 15 legs."}
          </p>
        </div>

        <BuilderDatePicker
          selectedDate={selectedDate}
          onChange={setSelectedDate}
          weeklyMode={isMonopoly}
          weekFromYmd={week.fromYmd}
          weekToYmd={week.toYmd}
        />

        <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-center text-sm text-emerald-200/90">
          {STRATEGY_LABELS[strategyMode]} ·{" "}
          {isSafe
            ? "Picks individuales · referencia 1U · sin acumulador"
            : isMonopoly
              ? `Cartelera lun–dom · ${BUILDER_MODES.MONOPOLY_ASYMMETRY.recommendedStake} · anti-rotación`
              : `Objetivo ~${preset.targetMultiplier}x (${projected}) · ${preset.minLegs} legs · 1U`}
        </div>

        <Card className="border-slate-700/80 bg-slate-900/70 shadow-xl shadow-emerald-950/20">
          <CardHeader className="text-center">
            <CardTitle className="text-xl sm:text-2xl">
              Elige tu estrategia
            </CardTitle>
            <CardDescription className="text-base">
              {isMonopoly
                ? "Asimetría ignora la fecha diaria y escanea lunes a domingo"
                : "Picks y lotería se filtran por la fecha de arriba"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            <ModeSelector value={strategyMode} onChange={setStrategyMode} />

            {showGenerateCard && (
              <div className="flex flex-col items-center gap-3 pt-2">
                <Button
                  size="lg"
                  className="h-14 w-full max-w-md text-base font-semibold sm:text-lg"
                  onClick={() => runPrimaryAction()}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                  {isSafe
                    ? `Buscar Picks Seguros (${selectedDate})`
                    : isMonopoly
                      ? "Generar cartelera semanal"
                      : `Generar Combinada (~${preset.targetMultiplier}x)`}
                </Button>
                <p className="max-w-md text-center text-xs text-slate-500">
                  {isSafe
                    ? "Lista de apuestas individuales: Doble oportunidad, DNB y Over 1.5 con prob. modelo ≥ 85%."
                    : isMonopoly
                      ? "Escaneo lunes a domingo: todos los monopolios domésticos ≥82% que pasen anti-rotación. Sin tope de legs."
                      : "Modo Seguro / Alta Probabilidad: piso 80% por leg · cuotas 1.18–1.28 · objetivo ~20x–35x · métricas en unidades (1U)."}
                </p>
              </div>
            )}

            {generated && fromCache && (isSafe ? safePicks.length > 0 : parlay.legs.length > 0) && (
              <p className="text-center text-xs text-sky-300/90">
                Datos recuperados para{" "}
                {isMonopoly
                  ? `${week.fromYmd} → ${week.toYmd}`
                  : selectedDate}{" "}
                · modo {STRATEGY_LABELS[strategyMode]}.
              </p>
            )}
          </CardContent>
        </Card>

        {error && (
          <Card className="border-rose-500/40 bg-rose-950/20">
            <CardContent className="p-4 text-center text-sm text-rose-300">
              {error}
            </CardContent>
          </Card>
        )}

        {emptyMessage && !error && (
          <Card className="border-sky-500/20">
            <CardContent className="p-6 text-center text-sm text-slate-300">
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
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Reintentar
              </Button>
            </div>
          )}
      </div>
    </div>
  );
}
