"use client";

import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "parleylab.hideAiVetoes.v1";

export function readHideAiVetoesPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHideAiVetoesPref(hide: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, hide ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

export function useHideAiVetoesPref(): [boolean, (hide: boolean) => void] {
  const [hide, setHide] = useState(false);

  useEffect(() => {
    setHide(readHideAiVetoesPref());
  }, []);

  const set = useCallback((next: boolean) => {
    setHide(next);
    writeHideAiVetoesPref(next);
  }, []);

  return [hide, set];
}

export function AiJudgeVetoFilterSwitch({
  hideVetoes,
  onChange,
  vetoCount = 0,
  className,
}: {
  hideVetoes: boolean;
  onChange: (hide: boolean) => void;
  vetoCount?: number;
  className?: string;
}) {
  const switchId = "ai-judge-veto-filter";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl bg-white/[0.04] px-3 py-3 ring-1 ring-white/10",
        className
      )}
    >
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={hideVetoes}
        aria-describedby={`${switchId}-hint`}
        onClick={() => onChange(!hideVetoes)}
        className={cn(
          "pressable mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-0 p-0.5 appearance-none shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff] focus-visible:ring-offset-2 focus-visible:ring-offset-black",
          hideVetoes ? "bg-[#30d158]" : "bg-neutral-600"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            hideVetoes ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
      <div className="min-w-0 flex-1">
        <label
          htmlFor={switchId}
          className="cursor-pointer text-sm font-semibold text-white"
        >
          Ocultar picks vetados por IA
        </label>
        <p id={`${switchId}-hint`} className="mt-1 text-xs leading-relaxed text-neutral-400">
          {hideVetoes
            ? vetoCount > 0
              ? `Ocultando ${vetoCount} veto${vetoCount === 1 ? "" : "s"} de IA Judge.`
              : "Activo: no se muestran picks con badge Vetado."
            : "Muestra todos los picks, incluidos los vetados por IA Judge."}
        </p>
      </div>
    </div>
  );
}
