"use client";

import { Button } from "@/components/ui/button";
import {
  formatExplicitBetLine,
  formatMarketGuideLines,
  getExplicitPickFromLeg,
} from "@/lib/formatters";
import type { GeneratedParlay, ParlayLeg } from "@/lib/types";
import { formatValueBadge } from "@/lib/value-finder";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * Plain-text slip for WhatsApp / Telegram / quick bookmaker search.
 */
export function formatSlipExportText(parlay: GeneratedParlay): string {
  const n = parlay.legs.length;
  const lines: string[] = [
    `CareWeaPredictions — Accumulator (${n} Legs)`,
    `Multiplicador Total: ${parlay.totalOdds.toFixed(2)}x | Prob. Conjunta: ${(parlay.jointProbability * 100).toFixed(1)}%`,
    "────────────────────────",
  ];

  parlay.legs.forEach((leg, i) => {
    lines.push(...formatSlipLegLines(i + 1, leg));
  });

  lines.push("────────────────────────");
  if (parlay.strategyLabel) {
    lines.push(`Estrategia: ${parlay.strategyLabel}`);
  }
  lines.push("CareWeaPredictions · 1U referencia · No es consejo financiero");

  return lines.join("\n");
}

export function formatSlipLegLine(index: number, leg: ParlayLeg): string {
  return formatSlipLegLines(index, leg).join("\n");
}

export function formatSlipLegLines(index: number, leg: ParlayLeg): string[] {
  const valueBadge = formatValueBadge(leg.edge ?? 0);
  const explicit = getExplicitPickFromLeg(leg);
  const betLine = valueBadge
    ? `${formatExplicitBetLine(explicit)} ${valueBadge}`
    : formatExplicitBetLine(explicit);

  return [
    `${index}. ${leg.matchLabel}`,
    `   Apuesta: ${betLine} (@${leg.odds.toFixed(2)})`,
    `   Condición: ${explicit.condition}`,
    ...formatMarketGuideLines(explicit),
  ];
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

interface SlipExporterProps {
  parlay: GeneratedParlay;
  /** Optional precomputed text (e.g. from API). Falls back to formatSlipExportText. */
  text?: string;
  className?: string;
  variant?: "default" | "secondary" | "outline";
  size?: "default" | "sm" | "lg";
  label?: string;
}

export function SlipExporter({
  parlay,
  text,
  className,
  variant = "secondary",
  size = "default",
  label = "Copiar Boleto",
}: SlipExporterProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (parlay.legs.length === 0) return;
    const payload = text ?? formatSlipExportText(parlay);
    const ok = await copyToClipboard(payload);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Button
      type="button"
      className={cn("flex-1", className)}
      variant={variant}
      size={size}
      disabled={parlay.legs.length === 0}
      onClick={handleCopy}
      aria-live="polite"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4" aria-hidden /> Copiado
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" aria-hidden /> {label}
        </>
      )}
    </Button>
  );
}
