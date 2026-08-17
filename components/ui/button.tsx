import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost" | "danger";
  size?: "default" | "sm" | "lg" | "icon";
}

const variants = {
  default:
    "bg-emerald-400 text-emerald-950 hover:bg-emerald-300 shadow-lg shadow-emerald-500/20",
  secondary: "bg-slate-700 text-slate-50 hover:bg-slate-600",
  outline:
    "border border-slate-500 bg-transparent text-slate-100 hover:bg-slate-800",
  ghost: "bg-transparent text-slate-200 hover:bg-slate-800 hover:text-slate-50",
  danger: "bg-rose-600 text-white hover:bg-rose-500",
};

const sizes = {
  default: "min-h-11 px-4 py-2 text-sm",
  sm: "min-h-9 px-3 text-sm",
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
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50",
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
