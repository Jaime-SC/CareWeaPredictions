/**
 * The Odds API — optional fill-gaps for 1X2 / O-U / DC.
 * Cache TTL 6h. No-op without ODDS_API_KEY.
 */
import { env } from "../env";
import {
  buildCacheKey,
  CACHE_TTL_MINUTES,
  getCachedPayload,
  upsertCachedPayload,
} from "../api-cache";
import type { MatchOdds } from "../types";

type OddsOutcome = { name?: string; price?: number };
type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
type OddsBookmaker = { key?: string; markets?: OddsMarket[] };
type OddsEvent = {
  id?: string;
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  bookmakers?: OddsBookmaker[];
};

export type PartialMatchOdds = Partial<MatchOdds>;

function priceOf(
  markets: OddsMarket[] | undefined,
  marketKey: string,
  outcomeName: string
): number | undefined {
  const m = markets?.find((x) => x.key === marketKey);
  const o = m?.outcomes?.find(
    (x) => (x.name ?? "").toLowerCase() === outcomeName.toLowerCase()
  );
  const p = o?.price;
  return typeof p === "number" && p > 1 ? p : undefined;
}

function mapEventToOdds(event: OddsEvent): PartialMatchOdds {
  const books = event.bookmakers ?? [];
  const markets = books[0]?.markets ?? [];
  const home = event.home_team ?? "";
  const away = event.away_team ?? "";

  const h = priceOf(markets, "h2h", home);
  const a = priceOf(markets, "h2h", away);
  const d = priceOf(markets, "h2h", "Draw");
  const over25 = priceOf(markets, "totals", "Over");
  const under35 = priceOf(markets, "totals", "Under");

  const out: PartialMatchOdds = {};
  if (h) out.home = h;
  if (d) out.draw = d;
  if (a) out.away = a;
  if (h && d) out.doubleChance1X = Number(((1 / (1 / h + 1 / d))).toFixed(3));
  if (a && d) out.doubleChanceX2 = Number(((1 / (1 / a + 1 / d))).toFixed(3));
  if (over25) out.over25 = over25;
  if (under35) out.under35 = under35;
  return out;
}

/**
 * Fetch soccer odds snapshot for a sport key + region.
 * Caller is responsible for matching events to fixtures.
 */
export async function fetchMatchOdds(
  sportKey: string,
  region = "eu"
): Promise<OddsEvent[]> {
  const apiKey = env.ODDS_API_KEY?.trim();
  if (!apiKey) return [];

  const cacheKey = buildCacheKey("odds_api", { sport: sportKey, region });
  const cached = await getCachedPayload<OddsEvent[]>(cacheKey);
  if (cached) return cached;

  const url =
    `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds` +
    `?apiKey=${encodeURIComponent(apiKey)}&regions=${encodeURIComponent(region)}` +
    `&markets=h2h,totals&oddsFormat=decimal`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[odds-api] HTTP ${res.status} sport=${sportKey}`);
      return [];
    }
    const data = (await res.json()) as OddsEvent[];
    const events = Array.isArray(data) ? data : [];
    await upsertCachedPayload(
      cacheKey,
      "odds_api",
      events,
      CACHE_TTL_MINUTES.ODDS_API
    );
    return events;
  } catch (err) {
    console.warn("[odds-api] fetch failed:", err);
    return [];
  }
}

function namesClose(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Map Odds API event list onto a fixture by team names. */
export function oddsPartialForFixture(
  events: OddsEvent[],
  homeName: string,
  awayName: string
): PartialMatchOdds | null {
  const hit = events.find(
    (e) =>
      namesClose(e.home_team ?? "", homeName) &&
      namesClose(e.away_team ?? "", awayName)
  );
  if (!hit) return null;
  const partial = mapEventToOdds(hit);
  return Object.keys(partial).length > 0 ? partial : null;
}

/** Fill only missing / sentinel (<=1) book lines. Never overwrite real odds. */
export function fillOddsGaps(
  current: MatchOdds,
  partial: PartialMatchOdds
): MatchOdds {
  const next = { ...current };
  for (const [key, value] of Object.entries(partial) as [
    keyof MatchOdds,
    number | undefined,
  ][]) {
    if (value == null || !(value > 1)) continue;
    const cur = next[key];
    if (typeof cur !== "number" || !(cur > 1)) {
      (next as Record<string, number>)[key] = value;
    }
  }
  return next;
}

/** Default soccer sport key for The Odds API (no aggregate `soccer` key). */
export const DEFAULT_SOCCER_SPORT_KEY = "soccer_epl";
