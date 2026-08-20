/**
 * Capture pre-kickoff closing odds for pending (and backfill) predictions.
 * Piggybacks on odds already fetched for the dashboard — no extra API calls.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { oddsForMarket } from "./poisson";
import type { MarketType, MatchOdds } from "./types";

const MARKET_TYPES = new Set<MarketType>([
  "home",
  "draw",
  "away",
  "1x",
  "x2",
  "over_0_5",
  "over_1_5",
  "over_2_5",
  "under_3_5",
  "under_4_5",
  "home_scores",
  "away_scores",
  "home_over_1_5",
  "away_over_1_5",
  "dnb_home",
  "dnb_away",
]);

function asMarketType(raw: string): MarketType | null {
  return MARKET_TYPES.has(raw as MarketType) ? (raw as MarketType) : null;
}

type PendingClvRow = {
  id: string;
  market: string;
  closingOdds: number | null;
  apiFixtureId: number;
  matchDate: Date | string;
};

/**
 * Persist the latest pre-match book line as closingOdds.
 * Updates freely while the fixture has not kicked off; freezes after kickoff.
 */
export async function snapshotClosingOdds(
  oddsByFixture: Map<number, MatchOdds>
): Promise<number> {
  if (oddsByFixture.size === 0) return 0;

  try {
    const fixtureIds = Array.from(oddsByFixture.keys());
    const rows = await prisma.$queryRaw<PendingClvRow[]>`
      SELECT
        p.id,
        p.market,
        p."closingOdds",
        f."apiFixtureId",
        f."matchDate"
      FROM "Prediction" p
      INNER JOIN "MatchFixture" f ON f.id = p."fixtureId"
      WHERE f."apiFixtureId" IN (${Prisma.join(fixtureIds)})
        AND (p.outcome = 'PENDING' OR p."closingOdds" IS NULL)
    `;

    if (rows.length === 0) return 0;

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    let updated = 0;

    for (const row of rows) {
      const odds = oddsByFixture.get(row.apiFixtureId);
      if (!odds) continue;

      const market = asMarketType(row.market);
      if (!market) continue;

      const closing = oddsForMarket(odds, market);
      if (!(closing > 1)) continue;

      const kickedOff = new Date(row.matchDate).getTime() <= now;
      if (kickedOff && row.closingOdds != null) continue;

      await prisma.$executeRaw`
        UPDATE "Prediction"
        SET
          "closingOdds" = ${closing},
          "closingOddsAt" = ${nowIso}::timestamp,
          "updatedAt" = ${nowIso}::timestamp
        WHERE id = ${row.id}
      `;
      updated += 1;
    }

    return updated;
  } catch (error) {
    console.warn("[clv] snapshot failed", error);
    return 0;
  }
}
