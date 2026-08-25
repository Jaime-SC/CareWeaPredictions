"use client";

import { Badge } from "@/components/ui/badge";
import type { AIVerdict } from "@/lib/types";
import { formatPercent } from "@/lib/utils";
import { AlertTriangle, Check } from "lucide-react";

/** Always-visible AI Judge badge + summary (persists with the pick). */
export function AiJudgeBadge({ verdict }: { verdict: AIVerdict }) {
  const approved = verdict.approved;
  return (
    <div className="min-w-0 space-y-1">
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
      <p className="text-xs font-medium text-[#64d2ff]">
        {approved ? "Aprobado" : "Vetado"}
        {verdict.confidenceScore > 0
          ? ` · ${formatPercent(verdict.confidenceScore, 0)}`
          : ""}
      </p>
      {verdict.summary ? (
        <p className="text-xs leading-snug text-neutral-300">{verdict.summary}</p>
      ) : null}
      {verdict.vetoReason ? (
        <p className="text-xs leading-snug text-[#ff453a]">{verdict.vetoReason}</p>
      ) : null}
    </div>
  );
}
