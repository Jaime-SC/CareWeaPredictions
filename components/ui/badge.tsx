import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

const variants = {
  default: "bg-white/8 text-neutral-200 ring-white/10",
  success: "bg-[#30d158]/15 text-[#30d158] ring-[#30d158]/25",
  warning: "bg-[#ffd60a]/12 text-[#ffd60a] ring-[#ffd60a]/25",
  danger: "bg-[#ff453a]/15 text-[#ff453a] ring-[#ff453a]/25",
  info: "bg-[#0a84ff]/15 text-[#64d2ff] ring-[#0a84ff]/25",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
