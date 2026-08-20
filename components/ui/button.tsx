import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost" | "danger";
  size?: "default" | "sm" | "lg" | "icon";
}

const variants = {
  default:
    "bg-[#0a84ff] text-white hover:bg-[#409cff] shadow-lg shadow-black/30",
  secondary: "bg-white/10 text-white hover:bg-white/15",
  outline:
    "border border-white/15 bg-transparent text-neutral-100 hover:bg-white/5",
  ghost: "bg-transparent text-neutral-300 hover:bg-white/[0.08] hover:text-white",
  danger: "bg-[#ff453a] text-white hover:bg-[#ff6961]",
};

const sizes = {
  default: "min-h-11 min-w-11 px-4 py-2 text-sm",
  sm: "min-h-11 px-3 text-sm",
  lg: "min-h-12 px-6 text-base",
  icon: "h-11 w-11",
};

export function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
} = {}) {
  return cn(
    "pressable inline-flex items-center justify-center gap-2 rounded-full font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff] focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-50",
    variants[variant ?? "default"],
    sizes[size ?? "default"],
    className
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={buttonVariants({ variant, size, className })}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
