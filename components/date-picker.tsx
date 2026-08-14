"use client";

import { WEEKLY_CARTELERA_LABEL } from "@/config/builder-modes";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { chileDateOffset, chileDateString, cn } from "@/lib/utils";
import { CalendarDays } from "lucide-react";
import { useMemo } from "react";

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

  if (weeklyMode) {
    return (
      <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-emerald-950/40 to-teal-950/30">
        <CardHeader className="pb-2 text-center sm:text-left">
          <CardTitle className="flex items-center justify-center gap-2 text-base sm:justify-start">
            <CalendarDays className="h-4 w-4 text-emerald-300" />
            Ventana de fixtures
          </CardTitle>
          <CardDescription>
            El modo Asimetría ignora el selector diario y barre la semana
            completa
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-4 text-center">
            <Badge variant="success" className="gap-1.5 text-xs">
              <CalendarDays className="h-3.5 w-3.5 text-emerald-400" />
              {WEEKLY_CARTELERA_LABEL}
            </Badge>
            {weekFromYmd && weekToYmd ? (
              <p className="text-sm font-medium text-emerald-100">
                {weekFromYmd} → {weekToYmd}
              </p>
            ) : null}
            <p className="text-xs text-emerald-200/80">
              Lunes 00:00 – Domingo 23:59 (hora Chile)
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
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
              onClick={() => onChange(tab.date)}
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
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) onChange(v);
              }}
              className="mt-1 h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            />
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
