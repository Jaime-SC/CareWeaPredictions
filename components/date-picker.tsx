"use client";

import { WEEKLY_CARTELERA_LABEL } from "@/config/builder-modes";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { chileDateOffset, chileDateString, cn } from "@/lib/utils";
import { CalendarDays } from "lucide-react";
import { type KeyboardEvent, useMemo } from "react";

interface BuilderDatePickerProps {
  selectedDate: string;
  onChange: (ymd: string) => void;
  weeklyMode?: boolean;
  weekFromYmd?: string;
  weekToYmd?: string;
}

export function BuilderDatePicker({
  selectedDate,
  onChange,
  weeklyMode = false,
  weekFromYmd,
  weekToYmd,
}: BuilderDatePickerProps) {
  const todayCl = chileDateString();
  const tomorrowCl = chileDateOffset(1, todayCl);
  const maxDate = chileDateOffset(7, todayCl);

  const dateTabs = useMemo(
    () => [
      { id: "hoy", label: "Hoy", date: todayCl },
      { id: "manana", label: "Mañana", date: tomorrowCl },
    ],
    [todayCl, tomorrowCl]
  );

  const isCustomDate =
    selectedDate !== todayCl && selectedDate !== tomorrowCl;

  const onShortcutKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const dates = dateTabs.map((tab) => tab.date);
    const index = dates.indexOf(selectedDate);
    if (index < 0) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(dates[(index + 1) % dates.length]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(dates[(index - 1 + dates.length) % dates.length]);
    }
  };

  if (weeklyMode) {
    return (
      <Card className="border-emerald-400/40">
        <CardHeader className="pb-2 text-center sm:text-left">
          <h2 className="flex items-center justify-center gap-2 text-base font-semibold tracking-tight text-slate-50 sm:justify-start">
            <CalendarDays className="h-4 w-4 text-emerald-200" aria-hidden />
            Ventana de fixtures
          </h2>
          <CardDescription>
            El modo Asimetría ignora el selector diario y barre la semana
            completa
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-4 text-center">
            <Badge variant="success" className="gap-1.5 text-xs">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {WEEKLY_CARTELERA_LABEL}
            </Badge>
            {weekFromYmd && weekToYmd ? (
              <p className="text-sm font-medium text-emerald-100">
                {weekFromYmd} → {weekToYmd}
              </p>
            ) : null}
            <p className="text-sm text-emerald-100">
              Lunes 00:00 – Domingo 23:59 (hora Chile)
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 text-center sm:text-left">
        <h2 className="flex items-center justify-center gap-2 text-base font-semibold tracking-tight text-slate-50 sm:justify-start">
          <CalendarDays className="h-4 w-4 text-emerald-300" aria-hidden />
          Fecha de fixtures
        </h2>
        <CardDescription>
          Las predicciones se consultan solo para el día elegido
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Atajos de fecha"
          onKeyDown={onShortcutKeyDown}
        >
          {dateTabs.map((tab) => {
            const checked = selectedDate === tab.date;
            return (
              <button
                key={tab.id}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => onChange(tab.date)}
                className={cn(
                  "min-h-11 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                  checked
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                    : "border-slate-600 bg-slate-950/60 text-slate-100 hover:border-slate-500"
                )}
              >
                {tab.label}
                <span className="mt-0.5 block text-xs font-normal text-slate-300">
                  {tab.date}
                </span>
              </button>
            );
          })}
          <label
            htmlFor="builder-custom-date"
            className={cn(
              "flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border px-3 py-2 transition-colors sm:col-span-1",
              isCustomDate
                ? "border-sky-400 bg-sky-500/20"
                : "border-slate-600 bg-slate-950/60 hover:border-slate-500"
            )}
          >
            <span className="text-xs text-slate-300">Otra fecha</span>
            <Input
              id="builder-custom-date"
              type="date"
              min={todayCl}
              max={maxDate}
              value={selectedDate}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) onChange(v);
              }}
              className="mt-1 min-h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-offset-0"
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
