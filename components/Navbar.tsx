"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ApiQuotaBadge } from "@/components/ApiQuotaBadge";
import { BankrollHeader } from "@/components/bankroll-header";
import { cn } from "@/lib/utils";
import {
  Activity,
  BarChart3,
  FlaskConical,
  LayoutDashboard,
  Layers,
  Users,
} from "lucide-react";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/builder", label: "Generador", icon: Layers },
  { href: "/stats", label: "Estadísticas", icon: BarChart3 },
  { href: "/teams", label: "Equipos", icon: Users },
  { href: "/health", label: "Salud", icon: Activity },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header
      className="liquid-glass sticky top-0 z-40 pt-[env(safe-area-inset-top,0px)]"
    >
      <div className="mx-auto flex min-h-12 max-w-7xl items-center justify-between gap-2 px-3 py-1.5 sm:min-h-14 sm:gap-3 sm:px-6 sm:py-2">
        <Link
          href="/"
          aria-label="CareWeaPredictions, ir al inicio"
          className="pressable flex min-h-11 shrink-0 select-none items-center gap-2 rounded-2xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#30d158] text-[#00210b] shadow-lg shadow-black/40"
          >
            <FlaskConical className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-white">
              CareWeaPredictions
            </p>
            <p className="hidden text-[11px] text-neutral-500 md:block">
              Analítica deportiva · Poisson · Acumuladores
            </p>
          </div>
        </Link>

        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <BankrollHeader className="shrink-0" />
          <ApiQuotaBadge className="hidden md:inline-flex" />
          <nav aria-label="Principal" className="hidden md:block">
            <ul className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-1 ring-1 ring-white/10">
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
                        "pressable inline-flex min-h-11 min-w-11 select-none items-center justify-center gap-1.5 rounded-full px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a84ff]",
                        active
                          ? "bg-white/12 text-white shadow-sm shadow-black/30"
                          : "text-neutral-400 hover:bg-white/[0.06] hover:text-white"
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      <span className="hidden lg:inline">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/5 px-3 py-2 md:hidden">
        <ApiQuotaBadge className="w-full justify-center" />
      </div>
    </header>
  );
}
