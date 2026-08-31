import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
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
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(10,132,255,0.18),_transparent_50%),radial-gradient(ellipse_at_bottom_right,_rgba(48,209,88,0.1),_transparent_45%)]"
      />

      <section
        aria-labelledby="home-heading"
        className="relative mx-auto flex min-h-[calc(100dvh-8rem)] max-w-7xl flex-col justify-center px-4 py-10 sm:min-h-[calc(100vh-3.5rem)] sm:px-6 sm:py-16"
      >
        <Badge variant="success" className="mb-4 w-fit gap-1.5 sm:mb-6">
          <FlaskConical className="h-3 w-3" aria-hidden />
          Poisson · Dixon-Coles · Parlays
        </Badge>

        <h1
          id="home-heading"
          className="max-w-full text-[clamp(1.75rem,7.2vw,4.5rem)] font-bold leading-[1.08] tracking-tight text-white"
        >
          <span className="inline-block">CareWea</span>
          <span className="inline-block">Predictions</span>
        </h1>
        <p className="mt-2 text-base font-medium text-[#30d158] sm:mt-3 sm:text-xl">
          Laboratorio de acumuladores de fútbol
        </p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-neutral-400 sm:mt-4 sm:text-lg">
          Scrapea partidos, estima xG con Poisson, filtra cuotas 1.40–1.85
          con EV ≥ 3% y arma parlays de alto multiplicador con métricas en
          unidades.
        </p>

        <div className="mt-8 flex w-full flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap">
          <Link
            href="/builder"
            className={buttonVariants({ size: "lg", className: "w-full sm:w-auto" })}
          >
            Abrir Parlay Studio
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href="/dashboard"
            className={buttonVariants({
              size: "lg",
              variant: "outline",
              className: "w-full sm:w-auto",
            })}
          >
            Ver Dashboard
          </Link>
        </div>

        <ul className="mt-10 grid list-none gap-3 p-0 sm:mt-16 sm:grid-cols-3 sm:gap-4">
          <Feature
            icon={<LineChart className="h-5 w-5 text-[#64d2ff]" />}
            title="Modelo estadístico"
            text="xG esperados, 1X2, doble oportunidad y Over/Under con ajuste Dixon-Coles."
          />
          <Feature
            icon={<Shield className="h-5 w-5 text-[#30d158]" />}
            title="Safe picks"
            text="Solo mercados con probabilidad modelo ≥ 80%, cuotas 1.40–1.85 y EV ≥ 3%."
          />
          <Feature
            icon={<Zap className="h-5 w-5 text-[#ffd60a]" />}
            title="Auto-parlay"
            text="Genera acumuladores de 15 legs (~150x–500x) con piso 80% por selección, cuotas 1.40–1.85 y EV ≥ 3%."
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
    <li className="lift rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 backdrop-blur-md sm:rounded-3xl sm:p-6">
      <div className="mb-3 inline-flex rounded-2xl bg-white/8 p-2.5 ring-1 ring-white/10 sm:mb-4" aria-hidden>
        {icon}
      </div>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{text}</p>
    </li>
  );
}
