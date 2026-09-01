import type { ExplicitPickLabel } from "@/lib/formatters";
import { AlertTriangle, Lightbulb } from "lucide-react";

export function PickLegDetails({ explicit }: { explicit: ExplicitPickLabel }) {
  return (
    <div className="divide-y divide-white/8 overflow-hidden rounded-2xl bg-black/20 ring-1 ring-white/8">
      <div className="px-3.5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Cómo gana
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-300">
          {explicit.condition}
        </p>
      </div>
      <div className="px-3.5 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          En la casa de apuestas
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-[#64d2ff]">
          {explicit.bookmakerTab}
        </p>
      </div>
      <div className="flex gap-2.5 px-3.5 py-3">
        <AlertTriangle
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ffd60a]"
          aria-hidden
        />
        <p className="text-xs leading-relaxed text-[#ffd60a]/90">
          {explicit.warningNote}
        </p>
      </div>
      {explicit.cupEquivalent ? (
        <div className="flex gap-2.5 px-3.5 py-3">
          <Lightbulb
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#30d158]"
            aria-hidden
          />
          <p className="text-xs leading-relaxed text-[#30d158]">
            {explicit.cupEquivalent}
          </p>
        </div>
      ) : null}
    </div>
  );
}
