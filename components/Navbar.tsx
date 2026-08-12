"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ApiQuotaBadge } from "@/components/ApiQuotaBadge";
import { cn } from "@/lib/utils";
import {
  Activity,
  BarChart3,
  FlaskConical,
  History,
  LayoutDashboard,
  Layers,
} from "lucide-react";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/builder", label: "Generador", icon: Layers },
  { href: "/stats", label: "Estadísticas", icon: BarChart3 },
  { href: "/backtest", label: "Backtest", icon: History },
  { href: "/health", label: "Salud", icon: Activity },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-slate-950">
            <FlaskConical className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-bold tracking-tight text-slate-50">
              ParleyLab
            </p>
            <p className="hidden text-[10px] text-slate-500 sm:block">
              Sports Analytics · Poisson · Accumulators
            </p>
          </div>
        </Link>

        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <ApiQuotaBadge className="hidden md:inline-flex" />
          <nav className="flex items-center gap-1">
            {links.map(({ href, label, icon: Icon }) => {
              const active =
                pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                    active
                      ? "bg-slate-800 text-emerald-300"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <div className="border-t border-slate-800/50 px-4 py-1.5 md:hidden">
        <ApiQuotaBadge className="w-full justify-center" />
      </div>
    </header>
  );
}
