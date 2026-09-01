"use client";

import { Badge } from "@/components/ui/badge";
import { humanizeAiJudgeProse } from "@/lib/ai-judge-text";
import type { AIVerdict } from "@/lib/types";
import { formatPercent } from "@/lib/utils";
import { AlertTriangle, Check } from "lucide-react";

/** Always-visible AI Judge badge + summary (persists with the pick). */
export function AiJudgeBadge({ verdict }: { verdict: AIVerdict }) {
  const approved = verdict.approved;
  const summary = verdict.summary
    ? humanizeAiJudgeProse(verdict.summary)
    : null;
  const vetoReason = verdict.vetoReason
    ? humanizeAiJudgeProse(verdict.vetoReason)
    : null;
  return (
    <div className="min-w-0 space-y-1">
      <Badge
        variant={approved ? "success" : "danger"}
        className="gap-1"
        title={summary ?? undefined}
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
      {summary ? (
        <p className="text-xs leading-snug text-neutral-300">{summary}</p>
      ) : null}
      {vetoReason ? (
        <p className="text-xs leading-snug text-[#ff453a]">{vetoReason}</p>
      ) : null}
    </div>
  );
}
