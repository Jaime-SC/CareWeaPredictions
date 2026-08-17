import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

const variants = {
  default: "bg-slate-700 text-slate-100 border-slate-500",
  success: "bg-emerald-500/20 text-emerald-200 border-emerald-400/45",
  warning: "bg-amber-500/20 text-amber-100 border-amber-400/45",
  danger: "bg-rose-500/20 text-rose-100 border-rose-400/45",
  info: "bg-sky-500/20 text-sky-100 border-sky-400/45",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
