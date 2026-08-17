/**
 * API-response cache helpers (purge / generation markers).
 */
import { prisma } from "./db";
import { PERMANENT_EXPIRES_AT } from "./api-cache";

/** Bump to force another one-shot wipe of bulk date caches. */
export const STALE_CACHE_PURGE_MARKER = "cache_purge_odds_fixture_v1";

export async function purgeStaleOddsAndFixtureCache(): Promise<{
  deleted: number;
  skipped: boolean;
}> {
  try {
    const marker = await prisma.cachedApiResponse.findUnique({
      where: { id: STALE_CACHE_PURGE_MARKER },
    });
    if (marker) {
      return { deleted: 0, skipped: true };
    }

    const result = await prisma.cachedApiResponse.deleteMany({
      where: {
        OR: [
          { id: { startsWith: "fixtures_date_" } },
          { id: { startsWith: "odds_date_" } },
        ],
      },
    });

    await prisma.cachedApiResponse.create({
      data: {
        id: STALE_CACHE_PURGE_MARKER,
        endpoint: "cache/purge",
        payload: JSON.stringify({
          purgedAt: new Date().toISOString(),
          deleted: result.count,
        }),
        expiresAt: PERMANENT_EXPIRES_AT,
      },
    });

    console.log(
      `[cache] purged ${result.count} stale fixtures_date_* / odds_date_* keys`
    );
    return { deleted: result.count, skipped: false };
  } catch (err) {
    console.warn("[cache] stale cache purge failed:", err);
    return { deleted: 0, skipped: false };
  }
}
