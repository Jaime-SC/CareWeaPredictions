"use client";

import { ParlaySlip } from "@/components/ParlaySlip";
import { SafePicksList } from "@/components/SafePicksList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  API_CONNECTION_ERROR_MESSAGE,
  EMPTY_MATCHES_MESSAGE,
} from "@/lib/api-messages";
import {
  STRATEGY_LABELS,
  getStrategyPreset,
  isFunStrategy,
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
import {
  chileDateOffset,
  chileDateString,
  cn,
  formatCLP,
} from "@/lib/utils";
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
  const tomorrowCl = chileDateOffset(1, todayCl);
  const maxDate = chileDateOffset(7, todayCl);

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

  const dateTabs = useMemo(
    () => [
      { id: "hoy", label: "Hoy", date: todayCl },
      { id: "manana", label: "Mañana", date: tomorrowCl },
    ],
    [todayCl, tomorrowCl]
  );

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

    const cached = loadStoredParlay("daily-fun", selectedDate);
    if (cached) {
      setParlay(cached.parlay);
      setClipboard(cached.clipboard);
      setSafePicks([]);
      setGenerated(true);
      setFromCache(true);
      return;
    }
    setParlay(emptyParlayFor("daily-fun"));
    setClipboard("");
    setSafePicks([]);
    setGenerated(false);
    setFromCache(false);
  }, [strategyMode, selectedDate, isSafe]);

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

  const runPrimaryAction = useCallback(
    (opts?: { force?: boolean }) => {
      if (isSafe) return loadSafePicks(opts);
      return generateFun(opts);
    },
    [isSafe, loadSafePicks, generateFun]
  );

  const projected = formatCLP(preset.stake * preset.targetMultiplier);
  const showGenerateCard =
    !generated || (!!error && (isSafe ? safePicks.length === 0 : !parlay.legs.length));

  const isCustomDate =
    selectedDate !== todayCl && selectedDate !== tomorrowCl;

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.14),_transparent_50%),radial-gradient(ellipse_at_bottom_right,_rgba(14,165,233,0.08),_transparent_40%)]" />

      <div className="relative mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="text-center">
          <Badge variant="success" className="mb-4">
            Generador · {selectedDate} · hora Chile
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
            Generar Selecciones
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
            Elige fecha y modo. Segura = picks individuales ≥85%. Diversión =
            combinada alta cuota del día seleccionado.
          </p>
        </div>

        <Card className="border-slate-700/80 bg-slate-900/70">
          <CardHeader className="pb-2 text-center sm:text-left">
            <CardTitle className="flex items-center justify-center gap-2 text-base sm:justify-start">
              <CalendarDays className="h-4 w-4 text-emerald-400" />
              Fecha de fixtures
            </CardTitle>
            <CardDescription>
              Las predicciones se consultan solo para el día elegido
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label="Atajos de fecha"
            >
              {dateTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedDate === tab.date}
                  onClick={() => setSelectedDate(tab.date)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                    selectedDate === tab.date
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-600"
                  )}
                >
                  {tab.label}
                  <span className="mt-0.5 block text-[10px] font-normal text-slate-500">
                    {tab.date}
                  </span>
                </button>
              ))}
              <label
                className={cn(
                  "flex cursor-pointer flex-col justify-center rounded-xl border px-3 py-2 transition sm:col-span-1",
                  isCustomDate
                    ? "border-sky-500/50 bg-sky-500/10"
                    : "border-slate-700 bg-slate-950/40 hover:border-slate-600"
                )}
              >
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  Otra fecha
                </span>
                <Input
                  type="date"
                  min={todayCl}
                  max={maxDate}
                  value={selectedDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setSelectedDate(v);
                  }}
                  className="mt-1 h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                />
              </label>
            </div>
          </CardContent>
        </Card>

        <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-4 py-3 text-center text-sm text-emerald-200/90">
          {STRATEGY_LABELS[strategyMode]} ·{" "}
          {isSafe
            ? `Picks individuales · stake sugerido ${formatCLP(preset.stake)}`
            : `Stake ${formatCLP(preset.stake)} → objetivo ~${preset.targetMultiplier}x (≈ ${projected})`}
        </div>

        <Card className="border-slate-700/80 bg-slate-900/70 shadow-xl shadow-emerald-950/20">
          <CardHeader className="text-center">
            <CardTitle className="text-xl sm:text-2xl">
              Elige tu estrategia
            </CardTitle>
            <CardDescription className="text-base">
              Sin modo semanal — todo filtrado por la fecha de arriba
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              role="radiogroup"
              aria-label="Estrategias"
            >
              <StrategyOption
                active={strategyMode === "daily-safe"}
                title={getStrategyPreset("daily-safe").title}
                subtitle={getStrategyPreset("daily-safe").subtitle}
                onClick={() => setStrategyMode("daily-safe")}
                recommended
              />
              <StrategyOption
                active={strategyMode === "daily-fun"}
                title={getStrategyPreset("daily-fun").title}
                subtitle={getStrategyPreset("daily-fun").subtitle}
                onClick={() => setStrategyMode("daily-fun")}
                fun
              />
            </div>

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
                    : `Generar Combinada (${formatCLP(preset.stake)})`}
                </Button>
                <p className="max-w-md text-center text-xs text-slate-500">
                  {isSafe
                    ? "Lista de apuestas individuales: Doble oportunidad, DNB y Over 1.5 con prob. modelo ≥ 85%."
                    : "Modo alta varianza: muchas legs hacia ~200x con stake $200 CLP en la fecha elegida."}
                </p>
              </div>
            )}

            {generated && fromCache && (isSafe ? safePicks.length > 0 : parlay.legs.length > 0) && (
              <p className="text-center text-xs text-sky-300/90">
                Datos recuperados para {selectedDate} · modo{" "}
                {STRATEGY_LABELS[strategyMode]}.
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
            stakeCLP={preset.stake}
            onRefresh={() => loadSafePicks({ force: true })}
          />
        )}

        {generated && !error && isFun && parlay.legs.length > 0 && (
          <ParlaySlip
            parlay={parlay}
            clipboardText={clipboard || undefined}
            regenerating={loading}
            fromCache={fromCache}
            historyDate={selectedDate}
            onRegenerate={() => generateFun({ force: true })}
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

function StrategyOption({
  active,
  title,
  subtitle,
  onClick,
  recommended,
  fun,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
  recommended?: boolean;
  fun?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "rounded-xl border px-3 py-3 text-left transition",
        active
          ? fun
            ? "border-amber-500/50 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.25)]"
            : "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
          : "border-slate-700 bg-slate-950/40 hover:border-slate-600"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug text-slate-100">
          {title}
        </p>
        {recommended && (
          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
            Sugerido
          </span>
        )}
        {fun && !recommended && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            Lotería
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{subtitle}</p>
    </button>
  );
}
