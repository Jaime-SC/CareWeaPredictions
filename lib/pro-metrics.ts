/**
 * Professional readiness metrics before committing real bankroll.
 * All formulas use settled tickets (WON / LOST) unless noted (CLV is per-leg).
 */

export const READINESS_THRESHOLDS = {
  /** Minimum settled tickets to drown out variance / luck streaks. */
  minSample: 300,
  /** Stronger sample for professional-grade claims. */
  strongSample: 500,
  /** Yield / ROI % floor (professional band starts ~5% after 500 bets). */
  minRoiPct: 4,
  professionalRoiPct: 5,
  /** Share of legs that beat the closing line. */
  minClvRate: 0.55,
  /** Minimum CLV comparisons (later snapshot vs taken odds). */
  minClvSample: 30,
  /** Gross wins / gross losses. */
  minProfitFactor: 1.2,
  /** One-sided p-value that mean unit return > 0. */
  maxPValue: 0.05,
  /** Worst peak-to-trough as a fraction of peak equity. */
  maxDrawdownPct: 20,
  /** Minutes after pick time required for a later snapshot to count as close. */
  clvMinLagMinutes: 15,
  /** Decimal-odds epsilon treated as a CLV push (line unchanged). */
  clvPushEpsilon: 0.01,
  /** Fractional Kelly multiplier (25%). */
  kellyFraction: 0.25,
  /** Hard cap of bankroll per ticket. */
  maxStakePct: 0.02,
  /** Soft cap recommended in the golden rules. */
  conservativeStakePct: 0.01,
} as const;

export type MetricStatus = "pass" | "fail" | "thin";

export type SettledTicketPnL = {
  stake: number;
  payout: number;
  status: "won" | "lost";
};

export type ClvLeg = {
  takenOdds: number;
  closingOdds: number;
  createdAtMs: number;
  closingOddsAtMs: number;
  kickoffMs: number;
};

export type ReadinessMetric = {
  id: "sample" | "roi" | "clv" | "profitFactor" | "pValue" | "maxDrawdown";
  label: string;
  thresholdLabel: string;
  why: string;
  value: number | null;
  display: string;
  status: MetricStatus;
  detail: string;
};

export type ReadinessReport = {
  settledTickets: number;
  clvCompared: number;
  clvBeats: number;
  clvPushes: number;
  roiPct: number;
  profitFactor: number | null;
  pValue: number | null;
  maxDrawdownPct: number | null;
  maxDrawdownAmount: number;
  initialBankroll: number;
  readyForRealCapital: boolean;
  passedCount: number;
  metrics: ReadinessMetric[];
  generatedAt: string;
};

export type FractionalKellyResult = {
  fullKellyPct: number;
  fractionalKellyPct: number;
  recommendedStakePct: number;
  recommendedStake: number;
  edge: number;
  reason: string;
};

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Abramowitz–Stegun approximation of erf. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function standardNormalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function ticketReturn(ticket: SettledTicketPnL): number {
  const stake = ticket.stake > 0 ? ticket.stake : 0;
  if (stake <= 0) return 0;
  if (ticket.status === "won") return (ticket.payout - stake) / stake;
  return -1;
}

function ticketProfit(ticket: SettledTicketPnL): number {
  const stake = ticket.stake > 0 ? ticket.stake : 0;
  if (ticket.status === "won") return ticket.payout - stake;
  return -stake;
}

export function computeRoiPct(tickets: SettledTicketPnL[]): number {
  let staked = 0;
  let profit = 0;
  for (const t of tickets) {
    const stake = t.stake > 0 ? t.stake : 0;
    staked += stake;
    profit += ticketProfit(t);
  }
  return staked > 0 ? (profit / staked) * 100 : 0;
}

/**
 * Gross winning amounts / gross losing amounts.
 * Null when there are no settled tickets; Infinity when losses are 0 and wins > 0.
 */
export function computeProfitFactor(tickets: SettledTicketPnL[]): number | null {
  if (tickets.length === 0) return null;
  let grossWins = 0;
  let grossLosses = 0;
  for (const t of tickets) {
    const pnl = ticketProfit(t);
    if (pnl > 0) grossWins += pnl;
    else if (pnl < 0) grossLosses += -pnl;
  }
  if (grossLosses === 0) return grossWins > 0 ? Number.POSITIVE_INFINITY : 0;
  return grossWins / grossLosses;
}

/**
 * One-sided test H1: E[unit return] > 0.
 * Uses a z-test (valid for n ≥ 30; callers mark smaller samples as thin).
 */
export function computeOneSidedPValue(returns: number[]): number | null {
  const n = returns.length;
  if (n < 2) return null;
  const mean = returns.reduce((s, x) => s + x, 0) / n;
  const variance =
    returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(Math.max(0, variance));
  if (sd === 0) return mean > 0 ? 0 : 1;
  const z = mean / (sd / Math.sqrt(n));
  return 1 - standardNormalCdf(z);
}

export function inferInitialBankroll(
  tickets: SettledTicketPnL[],
  override?: number
): number {
  if (typeof override === "number" && override > 0) return override;
  if (tickets.length === 0) return 0;
  const avgStake =
    tickets.reduce((s, t) => s + Math.max(0, t.stake), 0) / tickets.length;
  return Math.max(avgStake * 50, 1);
}

/**
 * Max peak-to-trough drawdown as % of running peak equity.
 * Equity starts at `initialBankroll` and adds ticket P&L in chronological order.
 */
export function computeMaxDrawdown(
  tickets: SettledTicketPnL[],
  initialBankroll: number
): { pct: number | null; amount: number } {
  if (tickets.length === 0 || initialBankroll <= 0) {
    return { pct: null, amount: 0 };
  }
  let equity = initialBankroll;
  let peak = initialBankroll;
  let maxAmount = 0;
  let maxPct = 0;
  for (const t of tickets) {
    equity += ticketProfit(t);
    if (equity > peak) peak = equity;
    const amount = peak - equity;
    if (amount > maxAmount) {
      maxAmount = amount;
      maxPct = peak > 0 ? (amount / peak) * 100 : 0;
    }
  }
  return { pct: maxPct, amount: maxAmount };
}

const CLV_WINDOW_BEFORE_MS = 3 * 60 * 60 * 1000;
const CLV_WINDOW_AFTER_MS = 30 * 60 * 1000;

export function isValidClvSample(leg: ClvLeg): boolean {
  if (!(leg.takenOdds > 1) || !(leg.closingOdds > 1)) return false;
  if (!(leg.closingOddsAtMs > 0) || !(leg.kickoffMs > 0)) return false;
  const inClosingWindow =
    leg.closingOddsAtMs >= leg.kickoffMs - CLV_WINDOW_BEFORE_MS &&
    leg.closingOddsAtMs <= leg.kickoffMs + CLV_WINDOW_AFTER_MS;
  if (!inClosingWindow) return false;
  const lagMs = leg.closingOddsAtMs - leg.createdAtMs;
  const moved =
    Math.abs(leg.takenOdds - leg.closingOdds) >=
    READINESS_THRESHOLDS.clvPushEpsilon;
  return moved || lagMs >= READINESS_THRESHOLDS.clvMinLagMinutes * 60_000;
}

/** True when the taken decimal odds were better than the close (line shortened). */
export function beatClosingLine(
  takenOdds: number,
  closingOdds: number,
  epsilon = READINESS_THRESHOLDS.clvPushEpsilon
): boolean {
  return takenOdds > closingOdds + epsilon;
}

export function computeClvRate(legs: ClvLeg[]): {
  compared: number;
  beats: number;
  pushes: number;
  rate: number | null;
} {
  let beats = 0;
  let misses = 0;
  let pushes = 0;
  for (const leg of legs) {
    if (!isValidClvSample(leg)) continue;
    if (Math.abs(leg.takenOdds - leg.closingOdds) < READINESS_THRESHOLDS.clvPushEpsilon) {
      pushes += 1;
      misses += 1;
      continue;
    }
    if (beatClosingLine(leg.takenOdds, leg.closingOdds)) beats += 1;
    else misses += 1;
  }
  const compared = beats + misses;
  return {
    compared,
    beats,
    pushes,
    rate: compared > 0 ? beats / compared : null,
  };
}

/**
 * Fractional Kelly with a 1–2% hard cap.
 * f* = (p·odds − 1) / (odds − 1); stake = min(2%, 25% · max(0, f*)).
 */
export function computeFractionalKelly(input: {
  bankroll: number;
  odds: number;
  modelProbability: number;
  fraction?: number;
  maxStakePct?: number;
}): FractionalKellyResult {
  const fraction = input.fraction ?? READINESS_THRESHOLDS.kellyFraction;
  const maxStakePct = input.maxStakePct ?? READINESS_THRESHOLDS.maxStakePct;
  const odds = input.odds;
  const p = input.modelProbability;
  const bankroll = input.bankroll;

  if (!(odds > 1) || !(p > 0) || p >= 1 || !(bankroll > 0)) {
    return {
      fullKellyPct: 0,
      fractionalKellyPct: 0,
      recommendedStakePct: 0,
      recommendedStake: 0,
      edge: 0,
      reason: "Cuota, probabilidad o banca inválidas.",
    };
  }

  const b = odds - 1;
  const q = 1 - p;
  const full = (p * odds - 1) / b;
  const edge = p * odds - 1;

  if (full <= 0 || edge <= 0) {
    return {
      fullKellyPct: round(full * 100, 2),
      fractionalKellyPct: 0,
      recommendedStakePct: 0,
      recommendedStake: 0,
      edge: round(edge, 4),
      reason: "Sin valor esperado: Kelly pide no apostar.",
    };
  }

  const fractional = full * fraction;
  const capped = Math.min(maxStakePct, fractional);
  return {
    fullKellyPct: round(full * 100, 2),
    fractionalKellyPct: round(fractional * 100, 2),
    recommendedStakePct: round(capped * 100, 2),
    recommendedStake: Math.floor(bankroll * capped),
    edge: round(edge, 4),
    reason:
      fractional > maxStakePct
        ? `Kelly al ${Math.round(fraction * 100)}% sugiere ${round(fractional * 100, 2)}%; se recorta al tope del ${round(maxStakePct * 100, 1)}%.`
        : `Kelly al ${Math.round(fraction * 100)}% de la fracción plena.`,
  };
}

function statusFrom(
  pass: boolean,
  thin: boolean
): MetricStatus {
  if (thin) return "thin";
  return pass ? "pass" : "fail";
}

export function buildReadinessMetrics(input: {
  tickets: SettledTicketPnL[];
  clvLegs: ClvLeg[];
  initialBankroll?: number;
}): Omit<ReadinessReport, "generatedAt"> {
  const tickets = input.tickets.filter(
    (t) => t.status === "won" || t.status === "lost"
  );
  const n = tickets.length;
  const roiPct = computeRoiPct(tickets);
  const profitFactor = computeProfitFactor(tickets);
  const returns = tickets.map(ticketReturn);
  const pValue = computeOneSidedPValue(returns);
  const bankroll = inferInitialBankroll(tickets, input.initialBankroll);
  const dd = computeMaxDrawdown(tickets, bankroll);
  const clv = computeClvRate(input.clvLegs);

  const samplePass = n >= READINESS_THRESHOLDS.minSample;
  const roiPass = n > 0 && roiPct >= READINESS_THRESHOLDS.minRoiPct;
  const clvThin =
    clv.rate == null || clv.compared < READINESS_THRESHOLDS.minClvSample;
  const clvPass = !clvThin && (clv.rate ?? 0) > READINESS_THRESHOLDS.minClvRate;
  const pfPass =
    profitFactor != null &&
    Number.isFinite(profitFactor) &&
    profitFactor > READINESS_THRESHOLDS.minProfitFactor;
  const pfThin = profitFactor == null;
  const pThin = pValue == null || n < 30;
  const pPass =
    !pThin && pValue != null && pValue < READINESS_THRESHOLDS.maxPValue;
  const ddThin = dd.pct == null;
  const ddPass =
    !ddThin && (dd.pct ?? 0) < READINESS_THRESHOLDS.maxDrawdownPct;

  const pfDisplay =
    profitFactor == null
      ? "—"
      : Number.isFinite(profitFactor)
        ? profitFactor.toFixed(2)
        : "∞";

  const metrics: ReadinessMetric[] = [
    {
      id: "sample",
      label: "Muestra (N)",
      thresholdLabel: `≥ ${READINESS_THRESHOLDS.minSample}–${READINESS_THRESHOLDS.strongSample} apuestas`,
      why: "Número mínimo de tickets liquidados para disipar el ruido estadístico y las rachas de suerte.",
      value: n,
      display: String(n),
      status: statusFrom(samplePass, n === 0),
      detail:
        n >= READINESS_THRESHOLDS.strongSample
          ? "Muestra fuerte (≥ 500)."
          : samplePass
            ? "Muestra mínima alcanzada (≥ 300)."
            : `Faltan ${READINESS_THRESHOLDS.minSample - n} tickets liquidados.`,
    },
    {
      id: "roi",
      label: "Yield / ROI",
      thresholdLabel: `+${READINESS_THRESHOLDS.minRoiPct}% a +8%`,
      why: "En apuestas deportivas, mantener un ROI superior al 5% tras 500 apuestas es rendimiento de nivel profesional.",
      value: n > 0 ? roiPct : null,
      display: n > 0 ? `${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(1)}%` : "—",
      status: statusFrom(roiPass, n === 0),
      detail:
        n === 0
          ? "Sin tickets liquidados."
          : roiPct >= READINESS_THRESHOLDS.professionalRoiPct
            ? "En banda profesional (≥ +5%)."
            : roiPass
              ? "Supera el piso de +4%."
              : "Por debajo del piso de +4%.",
    },
    {
      id: "clv",
      label: "CLV (Closing Line Value)",
      thresholdLabel: `> ${READINESS_THRESHOLDS.minClvRate * 100}% del tiempo`,
      why: "Mide si la cuota a la que apostaste fue superior a la cuota final con la que inició el partido.",
      value: clv.rate,
      display: clv.rate == null ? "—" : `${(clv.rate * 100).toFixed(1)}%`,
      status: statusFrom(clvPass, clvThin),
      detail: clvThin
        ? clv.compared === 0
          ? "Aún no hay snapshots de cuota de cierre posteriores al pick."
          : `Solo ${clv.compared} comparaciones (mínimo ${READINESS_THRESHOLDS.minClvSample}).`
          : `${clv.beats} beats / ${clv.compared} cierres (${clv.pushes} líneas sin movimiento).`,
    },
    {
      id: "profitFactor",
      label: "Profit Factor",
      thresholdLabel: `> ${READINESS_THRESHOLDS.minProfitFactor.toFixed(2)}`,
      why: "Ganancias brutas divididas entre pérdidas brutas. Indica cuánto ganas por cada peso perdido.",
      value:
        profitFactor == null || !Number.isFinite(profitFactor)
          ? profitFactor == null
            ? null
            : 999
          : profitFactor,
      display: pfDisplay,
      status: statusFrom(pfPass, pfThin),
      detail: pfThin
        ? "Sin tickets liquidados."
        : pfPass
          ? "Más de $1.20 ganado por cada $1 perdido."
          : "Las pérdidas brutas pesan demasiado frente a las ganancias.",
    },
    {
      id: "pValue",
      label: "p-Valor",
      thresholdLabel: `< ${READINESS_THRESHOLDS.maxPValue}`,
      why: "Probabilidad de que la ganancia sea casualidad. Si es < 0.05, hay un 95% de certeza de que el modelo no es ruido.",
      value: pValue,
      display: pValue == null ? "—" : pValue < 0.001 ? "< 0.001" : pValue.toFixed(3),
      status: statusFrom(pPass, pThin),
      detail: pThin
        ? "Se necesitan ≥ 30 retornos para un z-test fiable."
        : pPass
          ? "Rechaza azar al 95% (una cola)."
          : "Aún no se distingue de una racha de suerte.",
    },
    {
      id: "maxDrawdown",
      label: "Max Drawdown",
      thresholdLabel: `< ${READINESS_THRESHOLDS.maxDrawdownPct}% de la banca`,
      why: "La peor racha de caídas desde un máximo. Indica qué tan protegido está el capital en el peor escenario.",
      value: dd.pct,
      display: dd.pct == null ? "—" : `${dd.pct.toFixed(1)}%`,
      status: statusFrom(ddPass, ddThin),
      detail: ddThin
        ? "Sin curva de banca todavía."
        : `Caída máxima ${Math.round(dd.amount).toLocaleString("es-CL")} sobre banca notional ${Math.round(bankroll).toLocaleString("es-CL")}.`,
    },
  ];

  const passedCount = metrics.filter((m) => m.status === "pass").length;
  const readyForRealCapital = metrics.every((m) => m.status === "pass");

  return {
    settledTickets: n,
    clvCompared: clv.compared,
    clvBeats: clv.beats,
    clvPushes: clv.pushes,
    roiPct,
    profitFactor:
      profitFactor == null
        ? null
        : Number.isFinite(profitFactor)
          ? profitFactor
          : 99.99,
    pValue,
    maxDrawdownPct: dd.pct,
    maxDrawdownAmount: dd.amount,
    initialBankroll: bankroll,
    readyForRealCapital,
    passedCount,
    metrics,
  };
}
