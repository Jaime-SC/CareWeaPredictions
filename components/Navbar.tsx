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
    <header className="liquid-glass sticky top-0 z-40">
      <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-3 px-4 py-1.5 sm:px-6">
        <Link
          href="/"
          aria-label="CareWeaPredictions, ir al inicio"
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400 text-emerald-950"
          >
            <FlaskConical className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-50">
              CareWeaPredictions
            </p>
            <p className="hidden text-xs text-slate-300 sm:block">
              Sports Analytics · Poisson · Accumulators
            </p>
          </div>
        </Link>

        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <ApiQuotaBadge className="hidden md:inline-flex" />
          <nav aria-label="Principal">
            <ul className="flex items-center gap-1">
              {links.map(({ href, label, icon: Icon }) => {
                const active =
                  pathname === href || pathname.startsWith(href + "/");
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-label={label}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                        active
                          ? "bg-white/10 text-emerald-200"
                          : "text-slate-200 hover:bg-white/10 hover:text-slate-50"
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      <span className="hidden sm:inline">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-2 md:hidden">
        <ApiQuotaBadge className="w-full justify-center" />
      </div>
    </header>
  );
}
