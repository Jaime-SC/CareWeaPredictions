"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  computeFractionalKelly,
  READINESS_THRESHOLDS,
  type ReadinessMetric,
  type ReadinessReport,
} from "@/lib/pro-metrics";
import { cn, formatCLP, parseStakeCLP } from "@/lib/utils";
import {
  CheckCircle2,
  CircleAlert,
  Crown,
  Hourglass,
  Landmark,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export function ReadinessGate({ report }: { report: ReadinessReport }) {
  return (
    <section aria-label="Puerta de capital serio" className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold tracking-tight text-slate-50">
          Umbrales antes de capital serio
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">
          El modelo no se juzga por un fin de semana. Estos seis números son la
          puerta: si alguno falla o la muestra es delgada, el capital real espera.
        </p>
      </header>
      <VerdictBanner report={report} />
      <div className="overflow-x-auto rounded-2xl border border-slate-600/80">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">
            Umbrales profesionales antes de apostar capital serio
          </caption>
          <thead className="bg-slate-950/80 text-xs font-medium text-slate-300">
            <tr>
              <th className="px-4 py-2.5">Métrica</th>
              <th className="px-4 py-2.5">Umbral mínimo</th>
              <th className="px-4 py-2.5">Actual</th>
              <th className="px-4 py-2.5">¿Por qué es determinante?</th>
            </tr>
          </thead>
          <tbody>
            {report.metrics.map((metric) => (
              <tr key={metric.id} className="border-t border-slate-600/80">
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <StatusDot status={metric.status} />
                    <span className="font-medium text-slate-100">
                      {metric.label}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 align-top tabular-nums text-slate-300">
                  {metric.thresholdLabel}
                </td>
                <td className="px-4 py-3 align-top">
                  <p
                    className={cn(
                      "font-semibold tabular-nums",
                      metric.status === "pass"
                        ? "text-emerald-200"
                        : metric.status === "fail"
                          ? "text-rose-200"
                          : "text-amber-100"
                    )}
                  >
                    {metric.display}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">{metric.detail}</p>
                </td>
                <td className="px-4 py-3 align-top text-slate-300">{metric.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GoldenRules />
        <KellyCalculator />
      </div>
    </section>
  );
}

export function ReadinessSummaryCard({
  report,
}: {
  report: ReadinessReport;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Puerta de capital serio</CardTitle>
          <CardDescription>
            {report.passedCount}/{report.metrics.length} umbrales profesionales.
            CLV es la métrica reina — no evalúes por rachas cortas.
          </CardDescription>
        </div>
        <Badge variant={report.readyForRealCapital ? "success" : "warning"}>
          {report.readyForRealCapital ? "Listo" : "Aún no"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {report.metrics.map((metric) => (
            <li
              key={metric.id}
              className="rounded-xl border border-slate-600/80 bg-slate-950/50 px-3 py-2"
            >
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <StatusDot status={metric.status} />
                {metric.label}
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-slate-100">
                {metric.display}
              </p>
            </li>
          ))}
        </ul>
        <Link
          href="/health"
          className="inline-flex text-sm text-emerald-300 underline-offset-4 hover:underline"
        >
          Ver umbrales, reglas de oro y Kelly fraccionado
        </Link>
      </CardContent>
    </Card>
  );
}

function VerdictBanner({ report }: { report: ReadinessReport }) {
  const ready = report.readyForRealCapital;
  return (
    <Card
      className={
        ready
          ? "border-emerald-400/40 bg-emerald-950/25"
          : "border-amber-400/40 bg-amber-950/20"
      }
    >
      <CardContent className="flex items-start gap-3 p-5">
        {ready ? (
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
        ) : (
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" aria-hidden />
        )}
        <div>
          <p className="text-base font-semibold text-slate-50">
            {ready
              ? "La base de datos cumple los umbrales para transicionar capital con Kelly fraccionado."
              : "Todavía no metas dinero serio: faltan umbrales o muestra."}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-200">
            {report.settledTickets} tickets liquidados · {report.passedCount}/
            {report.metrics.length} métricas en verde. Banca notional usada para
            drawdown: {formatCLP(report.initialBankroll)} (50× stake medio, o la
            que indiques).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusDot({ status }: { status: ReadinessMetric["status"] }) {
  if (status === "pass") {
    return (
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Cumple" />
    );
  }
  if (status === "fail") {
    return (
      <CircleAlert className="h-4 w-4 shrink-0 text-rose-400" aria-label="No cumple" />
    );
  }
  return (
    <Hourglass className="h-4 w-4 shrink-0 text-amber-300" aria-label="Muestra insuficiente" />
  );
}

function GoldenRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-amber-300" aria-hidden />
          3 reglas de oro
        </CardTitle>
        <CardDescription>
          Antes de meter dinero serio, el acumulado manda — no el fin de semana.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed text-slate-200">
        <p>
          <strong className="text-slate-50">1. El CLV es la métrica reina.</strong>{" "}
          Si el modelo toma Over 1.5 a 1.80 y al pitazo la cuota cayó a 1.62, fue
          más rápido que el mercado. Ganarle de forma consistente a la cuota de
          cierre hace el beneficio económico inevitable a largo plazo.
        </p>
        <p>
          <strong className="text-slate-50">2. No evalúes por sensaciones.</strong>{" "}
          Ganar 8 de 10 un sábado no prueba edge; perder 7 seguidas tampoco lo
          niega. Confía solo en el acumulado de más de{" "}
          {READINESS_THRESHOLDS.minSample} picks liquidados.
        </p>
        <p>
          <strong className="text-slate-50">3. Kelly al 25%, tope 1–2%.</strong>{" "}
          Nunca más del 1–2% de la banca por ticket, por más “segura” que parezca
          la predicción. Si Kelly pleno pide 4%, apuestas el 1%.
        </p>
      </CardContent>
    </Card>
  );
}

function KellyCalculator() {
  const [bankrollRaw, setBankrollRaw] = useState("1.000.000");
  const [oddsRaw, setOddsRaw] = useState("1.80");
  const [probRaw, setProbRaw] = useState("62");

  const result = useMemo(() => {
    const bankroll = parseStakeCLP(bankrollRaw) ?? 0;
    const odds = Number(String(oddsRaw).replace(",", "."));
    const pct = Number(String(probRaw).replace(",", "."));
    return computeFractionalKelly({
      bankroll,
      odds,
      modelProbability: pct / 100,
    });
  }, [bankrollRaw, oddsRaw, probRaw]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-sky-300" aria-hidden />
          Kelly fraccionado (25%)
        </CardTitle>
        <CardDescription>
          Transición de capital: fracción de Kelly con tope del{" "}
          {READINESS_THRESHOLDS.maxStakePct * 100}% de la banca.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="kelly-bankroll">Banca (CLP)</Label>
            <Input
              id="kelly-bankroll"
              inputMode="numeric"
              value={bankrollRaw}
              onChange={(e) => setBankrollRaw(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kelly-odds">Cuota decimal</Label>
            <Input
              id="kelly-odds"
              inputMode="decimal"
              value={oddsRaw}
              onChange={(e) => setOddsRaw(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kelly-prob">Prob. modelo (%)</Label>
            <Input
              id="kelly-prob"
              inputMode="decimal"
              value={probRaw}
              onChange={(e) => setProbRaw(e.target.value)}
            />
          </div>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <div className="rounded-xl border border-slate-600/80 bg-slate-950/50 px-3 py-2">
            <dt className="text-xs text-slate-400">Kelly pleno</dt>
            <dd className="font-semibold tabular-nums">{result.fullKellyPct}%</dd>
          </div>
          <div className="rounded-xl border border-slate-600/80 bg-slate-950/50 px-3 py-2">
            <dt className="text-xs text-slate-400">Kelly × 25%</dt>
            <dd className="font-semibold tabular-nums">
              {result.fractionalKellyPct}%
            </dd>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 sm:col-span-2">
            <dt className="text-xs text-emerald-200/80">Stake recomendado</dt>
            <dd className="text-lg font-semibold tabular-nums text-emerald-100">
              {formatCLP(result.recommendedStake)}{" "}
              <span className="text-sm font-normal text-emerald-200/80">
                ({result.recommendedStakePct}% de la banca)
              </span>
            </dd>
          </div>
        </dl>
        <p className="text-xs leading-relaxed text-slate-400">{result.reason}</p>
        <p className="text-xs text-slate-500">
          Tope duro 1–2% de la banca. El 25% de Kelly absorbe las rachas negativas
          inevitables.
        </p>
      </CardContent>
    </Card>
  );
}
