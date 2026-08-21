/**
 * ESPN public JSON — soft-fail team injuries / news.
 * Cache TTL 12h via CachedApiResponse. Does not replace API-Football injuries.
 */
import {
  buildCacheKey,
  CACHE_TTL_MINUTES,
  getCachedPayload,
  upsertCachedPayload,
} from "../api-cache";

export type EspnTeamContext = {
  teamName: string;
  keyAbsences: string[];
  newsCount: number;
  source: "espn" | "cache" | "empty";
};

type EspnSearchHit = {
  type?: string;
  displayName?: string;
  id?: string | number;
  uid?: string;
};

type EspnInjuryRow = {
  status?: string;
  athlete?: { displayName?: string };
  type?: { description?: string };
};

function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function isOutStatus(status?: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s.includes("out") ||
    s.includes("injured") ||
    s.includes("suspended") ||
    s === "o"
  );
}

async function softFetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve ESPN team id via public search, then injuries endpoint when available.
 */
export async function getEspnTeamContext(
  teamName: string
): Promise<EspnTeamContext> {
  const name = teamName.trim();
  if (!name) {
    return { teamName: name, keyAbsences: [], newsCount: 0, source: "empty" };
  }

  const cacheKey = buildCacheKey("espn_team", { slug: slug(name) });
  const cached = await getCachedPayload<EspnTeamContext>(cacheKey);
  if (cached) return { ...cached, source: "cache" };

  const empty: EspnTeamContext = {
    teamName: name,
    keyAbsences: [],
    newsCount: 0,
    source: "empty",
  };

  const searchUrl =
    `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}` +
    `&limit=8&type=team&sport=soccer`;
  const search = await softFetchJson<{
    items?: EspnSearchHit[];
    results?: EspnSearchHit[];
  }>(searchUrl);

  const hits = search?.items ?? search?.results ?? [];
  const teamHit =
    hits.find((h) => (h.type ?? "").toLowerCase().includes("team")) ??
    hits[0];
  const teamId = teamHit?.id != null ? String(teamHit.id) : null;
  if (!teamId) {
    await upsertCachedPayload(
      cacheKey,
      "espn_team",
      empty,
      CACHE_TTL_MINUTES.ESPN
    );
    return empty;
  }

  // League-agnostic injuries path used by ESPN site API for soccer clubs
  const injuryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/${teamId}/injuries`;
  const injuryPayload = await softFetchJson<{
    items?: EspnInjuryRow[];
    injuries?: EspnInjuryRow[];
  }>(injuryUrl);

  const rows = injuryPayload?.items ?? injuryPayload?.injuries ?? [];
  const keyAbsences = rows
    .filter((r) => isOutStatus(r.status ?? r.type?.description))
    .map((r) => r.athlete?.displayName?.trim())
    .filter((n): n is string => !!n);

  const newsUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/${teamId}/news?limit=5`;
  const news = await softFetchJson<{ articles?: unknown[]; headlines?: unknown[] }>(
    newsUrl
  );
  const newsCount = (news?.articles ?? news?.headlines ?? []).length;

  const result: EspnTeamContext = {
    teamName: name,
    keyAbsences: [...new Set(keyAbsences)],
    newsCount,
    source: "espn",
  };
  await upsertCachedPayload(
    cacheKey,
    "espn_team",
    result,
    CACHE_TTL_MINUTES.ESPN
  );
  return result;
}
