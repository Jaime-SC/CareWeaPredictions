"use client";

import { Badge } from "@/components/ui/badge";
import type { AIVerdict } from "@/lib/types";
import { formatPercent } from "@/lib/utils";
import { AlertTriangle, Check } from "lucide-react";

export function AiJudgeBadge({ verdict }: { verdict: AIVerdict }) {
  const approved = verdict.approved;
  return (
    <div className="min-w-0">
      <Badge
        variant={approved ? "success" : "danger"}
        className="gap-1"
        title={verdict.summary}
      >
        {approved ? (
          <Check className="h-3 w-3" aria-hidden />
        ) : (
          <AlertTriangle className="h-3 w-3" aria-hidden />
        )}
        IA Audited
      </Badge>
      <details className="mt-1 text-xs text-neutral-400">
        <summary className="cursor-pointer select-none text-[#64d2ff] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]">
          {approved ? "Aprobado" : "Vetado"}
          {verdict.confidenceScore > 0
            ? ` · ${formatPercent(verdict.confidenceScore, 0)}`
            : ""}
        </summary>
        <p className="mt-1 leading-snug text-neutral-300">{verdict.summary}</p>
        {verdict.vetoReason ? (
          <p className="mt-0.5 leading-snug text-[#ff453a]">
            {verdict.vetoReason}
          </p>
        ) : null}
      </details>
    </div>
  );
}
