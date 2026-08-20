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

export function formatCLP(value: number): string {
  return `$${Math.round(value).toLocaleString("es-CL")} CLP`;
}

/** Parse a CLP amount from user input (digits, dots, commas, $). */
export function parseStakeCLP(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Format a digit string as Chilean thousands (10.000). */
export function formatStakeInput(raw: string): string {
  const parsed = parseStakeCLP(raw);
  if (parsed == null) return "";
  return parsed.toLocaleString("es-CL");
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

/** Group items by a string key, preserving first-seen order of groups. */
export function groupByKey<T>(
  items: T[],
  keyFn: (item: T) => string
): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item) || "Otros";
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries()).map(([key, groupItems]) => ({
    key,
    items: groupItems,
  }));
}

/** Kickoff ISO → ms. Invalid dates sort last. */
export function kickoffTimestamp(iso: string | undefined | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * Group by key, sort items by kickoff within each group,
 * then sort groups by earliest kickoff (early → late).
 */
export function groupByKeyThenKickoff<T>(
  items: T[],
  keyFn: (item: T) => string,
  kickoffFn: (item: T) => string | undefined | null
): { key: string; items: T[] }[] {
  const groups = groupByKey(items, keyFn).map((g) => ({
    key: g.key,
    items: [...g.items].sort(
      (a, b) => kickoffTimestamp(kickoffFn(a)) - kickoffTimestamp(kickoffFn(b))
    ),
  }));
  groups.sort((a, b) => {
    const ta = kickoffTimestamp(kickoffFn(a.items[0]));
    const tb = kickoffTimestamp(kickoffFn(b.items[0]));
    if (ta !== tb) return ta - tb;
    return a.key.localeCompare(b.key, "es");
  });
  return groups;
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
