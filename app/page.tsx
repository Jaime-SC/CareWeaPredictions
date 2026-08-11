import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  FlaskConical,
  LineChart,
  Shield,
  Zap,
} from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(16,185,129,0.18),_transparent_45%),radial-gradient(ellipse_at_bottom_right,_rgba(56,189,248,0.1),_transparent_40%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:48px_48px]" />

      <section className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6">
        <Badge variant="success" className="mb-6 w-fit">
          <FlaskConical className="mr-1 h-3 w-3" />
          Poisson · Dixon-Coles · Parlays
        </Badge>

        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-50 sm:text-6xl">
          ParleyLab
        </h1>
        <p className="mt-2 text-lg font-medium text-emerald-300/90 sm:text-xl">
          Laboratorio de acumuladores de fútbol
        </p>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
          Scrapea partidos, estima xG con Poisson, filtra cuotas seguras
          (1.15–1.35) y arma parlays de alto multiplicador con stake pequeño.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/builder">
            <Button size="lg">
              Abrir Parlay Studio
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button size="lg" variant="outline">
              Ver Dashboard
            </Button>
          </Link>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          <Feature
            icon={<LineChart className="h-5 w-5 text-sky-400" />}
            title="Modelo estadístico"
            text="xG esperados, 1X2, doble oportunidad y Over/Under con ajuste Dixon-Coles."
          />
          <Feature
            icon={<Shield className="h-5 w-5 text-emerald-400" />}
            title="Safe picks"
            text="Solo mercados con probabilidad modelo ≥ 80% y cuotas de baja varianza."
          />
          <Feature
            icon={<Zap className="h-5 w-5 text-amber-400" />}
            title="Auto-parlay"
            text="Genera acumuladores hacia 50x / 100x / 200x con stake desde $200 CLP."
          />
        </div>
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 backdrop-blur">
      <div className="mb-3">{icon}</div>
      <h3 className="font-semibold text-slate-100">{title}</h3>
      <p className="mt-1 text-sm text-slate-400">{text}</p>
    </div>
  );
}
