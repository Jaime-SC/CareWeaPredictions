import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(16,185,129,0.16),_transparent_45%),radial-gradient(ellipse_at_bottom_right,_rgba(56,189,248,0.1),_transparent_40%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(148,163,184,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.1)_1px,transparent_1px)] [background-size:48px_48px]"
      />

      <section
        aria-labelledby="home-heading"
        className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6"
      >
        <Badge variant="success" className="mb-6 w-fit">
          <FlaskConical className="mr-1 h-3 w-3" aria-hidden />
          Poisson · Dixon-Coles · Parlays
        </Badge>

        <h1
          id="home-heading"
          className="max-w-3xl text-4xl font-bold tracking-tight text-slate-50 sm:text-6xl"
        >
          CareWeaPredictions
        </h1>
        <p className="mt-2 text-lg font-medium text-emerald-200 sm:text-xl">
          Laboratorio de acumuladores de fútbol
        </p>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-200 sm:text-lg">
          Scrapea partidos, estima xG con Poisson, filtra cuotas seguras
          (1.15–1.35) y arma parlays de alto multiplicador con métricas en
          unidades.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/builder" className={buttonVariants({ size: "lg" })}>
            Abrir Parlay Studio
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href="/dashboard"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            Ver Dashboard
          </Link>
        </div>

        <ul className="mt-14 grid list-none gap-4 p-0 sm:grid-cols-3">
          <Feature
            icon={<LineChart className="h-5 w-5 text-sky-300" />}
            title="Modelo estadístico"
            text="xG esperados, 1X2, doble oportunidad y Over/Under con ajuste Dixon-Coles."
          />
          <Feature
            icon={<Shield className="h-5 w-5 text-emerald-300" />}
            title="Safe picks"
            text="Solo mercados con probabilidad modelo ≥ 80% y cuotas de baja varianza."
          />
          <Feature
            icon={<Zap className="h-5 w-5 text-amber-200" />}
            title="Auto-parlay"
            text="Genera acumuladores de 15 legs (~20x–35x) con piso 80% por selección y foco en multiplicador / win rate."
          />
        </ul>
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
    <li>
      <Card className="h-full">
        <CardContent className="p-5">
          <div className="mb-3" aria-hidden>
            {icon}
          </div>
          <h2 className="text-base font-semibold text-slate-50">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{text}</p>
        </CardContent>
      </Card>
    </li>
  );
}
