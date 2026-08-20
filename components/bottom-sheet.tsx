"use client";

import { useEffect, useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

/** Native CSS bottom sheet (mobile). On md+ renders as an elevated panel. */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  className,
  desktopClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  /** Extra classes when shown as desktop popover/panel */
  desktopClassName?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Cerrar"
        className="sheet-backdrop"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("sheet-panel", className, desktopClassName)}
      >
        <div className="flex flex-col items-center px-4 pt-2">
          <div
            className="mb-2 h-1 w-9 rounded-full bg-white/25 md:hidden"
            aria-hidden
          />
          <div className="flex w-full items-center justify-between gap-3 pb-3">
            <h2 id={titleId} className="text-base font-semibold text-white">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar panel"
              className="pressable touch-target inline-flex items-center justify-center rounded-full text-neutral-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
        <div className="px-4 pb-2">{children}</div>
      </div>
    </>
  );
}
