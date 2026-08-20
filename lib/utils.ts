import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Zona horaria oficial de Chile (maneja horario de verano automáticamente). */
export const CHILE_TIMEZONE = "America/Santiago";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatOdds(value: number): string {
  return value.toFixed(2);
}

/** Redondea montos CLP a máximo 2 decimales. */
export function roundCLP(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function formatCLPAmount(value: number): string {
  const n = roundCLP(value);
  const hasCents = Math.round(Math.abs(n) * 100) % 100 !== 0;
  return n.toLocaleString("es-CL", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function formatCLP(value: number): string {
  return `$${formatCLPAmount(value)} CLP`;
}

/**
 * Parse a CLP amount from user input.
 * Chile: `.` miles, `,` decimal (ej. 10.000,50). También acepta `10000.5`.
 */
export function parseStakeCLP(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$\s]/g, "");
  if (!cleaned) return null;

  let normalized: string;
  if (cleaned.includes(",")) {
    const [intPart, ...rest] = cleaned.split(",");
    const frac = rest.join("").replace(/\D/g, "").slice(0, 2);
    const ints = intPart.replace(/\./g, "").replace(/\D/g, "");
    if (!ints && !frac) return null;
    normalized = `${ints || "0"}${frac ? `.${frac}` : ""}`;
  } else if (/^\d+\.\d{1,2}$/.test(cleaned)) {
    normalized = cleaned;
  } else {
    const digits = cleaned.replace(/[^\d]/g, "");
    if (!digits) return null;
    normalized = digits;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return roundCLP(value);
}

/**
 * Formatea input de montos en estilo chileno (10.000 o 10.000,50).
 * Conserva la coma decimal mientras se escribe (máx. 2 dígitos).
 */
export function formatStakeInput(raw: string): string {
  const trimmed = raw.trim();
  // Número JS / pegado con punto decimal → estilo chileno
  if (/^\d+\.\d{1,2}$/.test(trimmed)) {
    const [intPart, frac] = trimmed.split(".");
    return `${Number(intPart).toLocaleString("es-CL")},${frac}`;
  }

  let s = trimmed.replace(/[^\d.,]/g, "");
  if (!s) return "";

  // Una sola coma decimal; el resto de separadores se ignoran en la fracción
  const commaIdx = s.indexOf(",");
  let intRaw: string;
  let frac: string | undefined;
  if (commaIdx !== -1) {
    intRaw = s.slice(0, commaIdx);
    frac = s
      .slice(commaIdx + 1)
      .replace(/[^\d]/g, "")
      .slice(0, 2);
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s) || !s.includes(".")) {
    // Solo miles o solo dígitos
    intRaw = s;
    frac = undefined;
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    const parts = s.split(".");
    intRaw = parts[0];
    frac = parts[1];
  } else {
    intRaw = s.replace(/\./g, "");
    frac = undefined;
  }

  const intDigits = intRaw.replace(/\D/g, "");
  if (!intDigits && frac === undefined) return "";
  const formattedInt = Number(intDigits || "0").toLocaleString("es-CL");
  if (frac !== undefined) return `${formattedInt},${frac}`;
  return formattedInt;
}

/** Standardized unit stake for analytics (1U per ticket). */
export const UNIT_STAKE = 1;

/** Fecha civil YYYY-MM-DD en hora Chile. */
export function chileDateString(date: Date | string = new Date()): string {
  const value = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHILE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Number.isFinite(value.getTime()) ? value : new Date());
}

/** Suma/resta días civiles a una fecha YYYY-MM-DD (calendario Chile). */
export function chileDateOffset(
  days: number,
  from: string = chileDateString()
): string {
  const [y, m, d] = from.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * API query window for a Chile civil day.
 * Evening CONMEBOL kickoffs often sit on the next UTC calendar day when the
 * upstream date filter ignores timezone — fetch ±1 day then filter locally.
 */
export function chileDateApiWindow(ymd: string): string[] {
  return [chileDateOffset(-1, ymd), ymd, chileDateOffset(1, ymd)];
}

/**
 * Rango de fechas civiles en hora Chile: hoy + N días.
 * Usado para consultar fixtures alineados al calendario local.
 */
export function chileDateRange(daysAhead = 3): string[] {
  const today = chileDateString();
  const dates: string[] = [];
  for (let i = 0; i <= daysAhead; i++) {
    dates.push(chileDateOffset(i, today));
  }
  return dates;
}

export type WeeklyDateRange = {
  /** Monday 00:00:00 Chile, as UTC ISO. */
  from: string;
  /** Sunday 23:59:59 Chile, as UTC ISO. */
  to: string;
  fromYmd: string;
  toYmd: string;
  dates: string[];
};

function chileWeekdayMonday0(date: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: CHILE_TIMEZONE,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[wd] ?? 0;
}

/** Convert a Chile civil wall-clock to UTC milliseconds. */
function chileWallTimeToUtcMs(
  ymd: string,
  hour: number,
  minute: number,
  second: number
): number {
  const [y, m, d] = ymd.split("-").map(Number);
  let ms = Date.UTC(y, m - 1, d, hour + 4, minute, second);
  for (let i = 0; i < 8; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: CHILE_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    const got = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    const want = Date.UTC(y, m - 1, d, hour, minute, second);
    const delta = want - got;
    if (delta === 0) break;
    ms += delta;
  }
  return ms;
}

/**
 * Current Chile week: Monday 00:00:00 → Sunday 23:59:59.
 * Monopoly / Asimetría always scans this window (FULL_WEEK_AUTO).
 */
export function getWeeklyDateRange(now: Date = new Date()): WeeklyDateRange {
  const today = chileDateString(now);
  const monday = chileDateOffset(-chileWeekdayMonday0(now), today);
  const sunday = chileDateOffset(6, monday);
  const dates = Array.from({ length: 7 }, (_, i) => chileDateOffset(i, monday));
  return {
    from: new Date(chileWallTimeToUtcMs(monday, 0, 0, 0)).toISOString(),
    to: new Date(chileWallTimeToUtcMs(sunday, 23, 59, 59)).toISOString(),
    fromYmd: monday,
    toYmd: sunday,
    dates,
  };
}

/** Kickoff formateado en hora Chile (24h). */
export function formatKickoff(iso: string): string {
  try {
    const formatted = new Intl.DateTimeFormat("es-CL", {
      timeZone: CHILE_TIMEZONE,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
    return `${formatted} CL`;
  } catch {
    return iso;
  }
}

/** Solo hora HH:mm en Chile. */
export function formatKickoffTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-CL", {
      timeZone: CHILE_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

/**
 * Relative day label for multi-day parlays:
 * [Hoy 18:00] / [Mañana 20:30] / [Viernes 19:00].
 */
export function formatKickoffDayLabel(
  iso: string,
  referenceYmd: string = chileDateString()
): string {
  const kickoffYmd = chileDateString(new Date(iso));
  const time = formatKickoffTime(iso) || "--:--";
  if (kickoffYmd === referenceYmd) return `Hoy ${time}`;
  if (kickoffYmd === chileDateOffset(1, referenceYmd)) return `Mañana ${time}`;
  if (kickoffYmd === chileDateOffset(-1, referenceYmd)) return `Ayer ${time}`;

  try {
    const weekday = new Intl.DateTimeFormat("es-CL", {
      timeZone: CHILE_TIMEZONE,
      weekday: "long",
    }).format(new Date(iso));
    const capped =
      weekday.charAt(0).toUpperCase() + weekday.slice(1).replace(/\./g, "");
    return `${capped} ${time}`;
  } catch {
    return `${kickoffYmd.slice(5)} ${time}`;
  }
}

/** Kickoff ISO → ms. Invalid / missing dates sort as oldest (end when desc). */
export function kickoffTimestamp(iso: string | undefined | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Flat list: kickoff late → early. Same kickoff keeps same competition together
 * (league name as secondary key). No competition section headers.
 */
export function sortByKickoffDesc<T>(
  items: T[],
  kickoffFn: (item: T) => string | undefined | null,
  leagueFn?: (item: T) => string | undefined | null
): T[] {
  return [...items].sort((a, b) => {
    const tb = kickoffTimestamp(kickoffFn(b));
    const ta = kickoffTimestamp(kickoffFn(a));
    if (tb !== ta) return tb - ta;
    if (leagueFn) {
      const la = (leagueFn(a) || "Otros").trim();
      const lb = (leagueFn(b) || "Otros").trim();
      const byLeague = la.localeCompare(lb, "es");
      if (byLeague !== 0) return byLeague;
    }
    return 0;
  });
}

/**
 * Prisma DateTime as ISO string. Neon HTTP can hand back strings (or `{}`)
 * instead of Date; callers must not assume `.toISOString()` exists.
 */
export function toIsoDateTime(
  value: Date | string | number | null | undefined
): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}
