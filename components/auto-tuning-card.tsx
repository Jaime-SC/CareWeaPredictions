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
import type { TrainingFeatureRow } from "@/lib/bet-types";
import { CHILE_TIMEZONE } from "@/lib/utils";
import { Loader2, Settings2 } from "lucide-react";
import { useState } from "react";

export type CalibrationSnapshot = {
  calibratedAt: string | null;
  sampleSize: number;
  leaguesAdjusted: number;
  marketsAdjusted: number;
  message: string;
};

export function parseCalibrationSnapshot(data: unknown): CalibrationSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.success === false) return null;
  return {
    calibratedAt: typeof d.calibratedAt === "string" ? d.calibratedAt : null,
    sampleSize: Number(d.sampleSize) || 0,
    leaguesAdjusted: Number(d.leaguesAdjusted) || 0,
    marketsAdjusted: Number(d.marketsAdjusted) || 0,
    message:
      typeof d.message === "string" ? d.message : "Autocalibración activa.",
  };
}

function formatChileDateTime(iso: string | null): string {
  if (!iso) return "Aún no hay una calibración registrada";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "Aún no hay una calibración registrada";
  }
  return parsed.toLocaleString("es-CL", {
    timeZone: CHILE_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

interface AutoTuningCardProps {
  snapshot: CalibrationSnapshot | null;
  trainingExport?: TrainingFeatureRow[];
  onError?: (message: string | null) => void;
  onMessage?: (message: string | null) => void;
  onCalibrated?: (snapshot: CalibrationSnapshot) => void;
}

export function AutoTuningCard({
  snapshot,
  trainingExport = [],
  onError,
  onMessage,
  onCalibrated,
}: AutoTuningCardProps) {
  const [calibrating, setCalibrating] = useState(false);

  async function handleForceRecalibrate() {
    setCalibrating(true);
    onError?.(null);
    onMessage?.(null);
    try {
      const res = await fetch("/api/model/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureVectors: trainingExport.length ? trainingExport : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        onError?.(
          typeof data.error === "string"
            ? data.error
            : "No se pudo recalibrar el modelo."
        );
        return;
      }
      const next = parseCalibrationSnapshot(data);
      const message =
        next?.message ??
        `Parámetros actualizados: ${data.leaguesAdjusted ?? 0} ligas ajustadas, umbral de goles ajustado a ${Math.round((data.over15MinProbability ?? 0.78) * 100)}%`;
      onMessage?.(message);
      if (next) onCalibrated?.(next);
    } catch {
      onError?.("Error de red al recalibrar el modelo.");
    } finally {
      setCalibrating(false);
    }
  }

  const hasRun = Boolean(snapshot?.calibratedAt) && (snapshot?.sampleSize ?? 0) > 0;

  return (
    <Card className="border-amber-500/25 bg-amber-950/10">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>Motor de autoajuste</CardTitle>
          <Badge variant="success">Autocalibración Activa (En Segundo Plano)</Badge>
        </div>
        <CardDescription>
          Recalcula multiplicadores por liga, pesos de mercado y umbrales de
          probabilidad cada vez que se liquidan picks. El botón manual fuerza un
          recálculo inmediato.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl space-y-1 text-sm text-slate-200">
          <p>
            Última calibración:{" "}
            <span className="text-slate-50">
              {formatChileDateTime(snapshot?.calibratedAt ?? null)}
            </span>
          </p>
          <p>
            Muestra analizada:{" "}
            <span className="text-slate-50">
              {snapshot?.sampleSize ?? 0} pick
              {(snapshot?.sampleSize ?? 0) === 1 ? "" : "s"}
            </span>
            {hasRun ? (
              <span className="text-slate-400">
                {" "}
                · {snapshot?.leaguesAdjusted ?? 0} ligas ·{" "}
                {snapshot?.marketsAdjusted ?? 0} mercados
              </span>
            ) : null}
          </p>
          <p className="text-slate-300">
            N&lt;5 neutro · 5–14 amortiguado (α=0.5) · ≥15 completo · EMA 0.25
            para evitar saltos.
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={handleForceRecalibrate}
          disabled={calibrating}
          aria-busy={calibrating}
        >
          {calibrating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Settings2 className="h-4 w-4" aria-hidden />
          )}
          {calibrating ? "Recalibrando…" : "Recalibrar Ahora"}
        </Button>
      </CardContent>
    </Card>
  );
}
