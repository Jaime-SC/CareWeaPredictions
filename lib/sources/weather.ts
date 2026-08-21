/**
 * Open-Meteo matchday weather. Cache TTL 24h.
 * Heavy rain (>5 mm/h) / extreme snow → λ factor 0.90.
 */
import {
  buildCacheKey,
  CACHE_TTL_MINUTES,
  getCachedPayload,
  upsertCachedPayload,
} from "../api-cache";

/** λ / total-xG multiplier under adverse precipitation. */
export const WEATHER_ADVERSE_LAMBDA = 0.9;
/** Precipitation intensity (mm/h) that triggers the adverse rule. */
export const WEATHER_HEAVY_PRECIP_MMH = 5;

export type FixtureWeather = {
  precipMmH: number;
  /** Multiplier applied to both home/away λ (1 or 0.90). */
  factor: number;
  alert?: string;
  lat: number;
  lon: number;
  date: string;
};

/** Static elite-city coords — no live geocoding (ponytail). */
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  london: { lat: 51.5074, lon: -0.1278 },
  manchester: { lat: 53.4808, lon: -2.2426 },
  liverpool: { lat: 53.4084, lon: -2.9916 },
  birmingham: { lat: 52.4862, lon: -1.8904 },
  madrid: { lat: 40.4168, lon: -3.7038 },
  barcelona: { lat: 41.3874, lon: 2.1686 },
  sevilla: { lat: 37.3891, lon: -5.9845 },
  valencia: { lat: 39.4699, lon: -0.3763 },
  milan: { lat: 45.4642, lon: 9.19 },
  rome: { lat: 41.9028, lon: 12.4964 },
  roma: { lat: 41.9028, lon: 12.4964 },
  turin: { lat: 45.0703, lon: 7.6869 },
  torino: { lat: 45.0703, lon: 7.6869 },
  naples: { lat: 40.8518, lon: 14.2681 },
  napoli: { lat: 40.8518, lon: 14.2681 },
  munich: { lat: 48.1351, lon: 11.582 },
  munchen: { lat: 48.1351, lon: 11.582 },
  berlin: { lat: 52.52, lon: 13.405 },
  dortmund: { lat: 51.5136, lon: 7.4653 },
  paris: { lat: 48.8566, lon: 2.3522 },
  lyon: { lat: 45.764, lon: 4.8357 },
  marseille: { lat: 43.2965, lon: 5.3698 },
  amsterdam: { lat: 52.3676, lon: 4.9041 },
  lisbon: { lat: 38.7223, lon: -9.1393 },
  lisboa: { lat: 38.7223, lon: -9.1393 },
  porto: { lat: 41.1579, lon: -8.6291 },
  santiago: { lat: -33.4489, lon: -70.6693 },
  "buenos aires": { lat: -34.6037, lon: -58.3816 },
  "sao paulo": { lat: -23.5505, lon: -46.6333 },
  "rio de janeiro": { lat: -22.9068, lon: -43.1729 },
  mexico: { lat: 19.4326, lon: -99.1332 },
  "mexico city": { lat: 19.4326, lon: -99.1332 },
  "new york": { lat: 40.7128, lon: -74.006 },
  "los angeles": { lat: 34.0522, lon: -118.2437 },
  miami: { lat: 25.7617, lon: -80.1918 },
};

function normalizePlace(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolve lat/lon from venue name or city using the static map. */
export function resolveVenueCoords(
  venue?: string | null,
  city?: string | null
): { lat: number; lon: number } | null {
  const candidates = [city, venue]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .map(normalizePlace);

  for (const c of candidates) {
    if (CITY_COORDS[c]) return CITY_COORDS[c];
    for (const [key, coords] of Object.entries(CITY_COORDS)) {
      if (c.includes(key) || key.includes(c)) return coords;
    }
  }
  return null;
}

export function weatherLambdaFactor(precipMmH: number): number {
  if (!Number.isFinite(precipMmH) || precipMmH <= WEATHER_HEAVY_PRECIP_MMH) {
    return 1;
  }
  return WEATHER_ADVERSE_LAMBDA;
}

export async function getFixtureWeather(
  lat: number,
  lon: number,
  date: string
): Promise<FixtureWeather | null> {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return null;
  }

  const cacheKey = buildCacheKey("weather", {
    lat: lat.toFixed(2),
    lon: lon.toFixed(2),
    date,
  });
  const cached = await getCachedPayload<FixtureWeather>(cacheKey);
  if (cached) return cached;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation&start_date=${date}&end_date=${date}&timezone=UTC`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      hourly?: { precipitation?: (number | null)[] };
    };
    const series = data.hourly?.precipitation ?? [];
    const precipMmH = series.reduce<number>((max, v) => {
      const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
      return Math.max(max, n);
    }, 0);
    const factor = weatherLambdaFactor(precipMmH);
    const result: FixtureWeather = {
      precipMmH: Number(precipMmH.toFixed(2)),
      factor,
      lat,
      lon,
      date,
      alert:
        factor < 1
          ? `Lluvia fuerte (${precipMmH.toFixed(1)} mm/h) → xG × ${factor}`
          : undefined,
    };
    await upsertCachedPayload(
      cacheKey,
      "weather",
      result,
      CACHE_TTL_MINUTES.WEATHER
    );
    return result;
  } catch (err) {
    console.warn("[weather] Open-Meteo failed:", err);
    return null;
  }
}
