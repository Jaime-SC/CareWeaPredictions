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

/** Fecha civil YYYY-MM-DD en hora Chile. */
export function chileDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHILE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
