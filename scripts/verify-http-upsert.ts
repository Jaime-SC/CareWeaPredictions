/**
 * Smoke: Neon HTTP cannot Prisma.upsert; find+create/update must work twice.
 * Usage: npx tsx scripts/verify-http-upsert.ts
 */
import {
  getCachedPayload,
  upsertCachedPayload,
} from "../lib/api-cache";
import { deleteTicketById, recordBet } from "../lib/bet-db";
import { prisma } from "../lib/db";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const cacheKey = "verify_http_upsert_cache";
  await upsertCachedPayload(cacheKey, "/verify", { n: 1 }, 5);
  await upsertCachedPayload(cacheKey, "/verify", { n: 2 }, 5);
  const hit = await getCachedPayload<{ n: number }>(cacheKey);
  assert(hit?.n === 2, `cache hit ${JSON.stringify(hit)}`);

  const kickoff = new Date().toISOString();
  const legs = [
    {
      matchId: "live-888001",
      matchLabel: "Verify Alpha vs Verify Beta",
      leagueName: "Verify League",
      kickoff,
      market: "over_1_5",
      marketLabel: "+1.5",
      odds: 1.4,
      modelProbability: 0.7,
    },
    {
      matchId: "live-888002",
      matchLabel: "Verify Gamma vs Verify Delta",
      leagueName: "Verify League",
      kickoff,
      market: "1x",
      marketLabel: "1X",
      odds: 1.5,
      modelProbability: 0.65,
    },
  ];

  const first = await recordBet({
    date: "2099-01-01",
    mode: "Diversion",
    strategyMode: "daily-fun",
    stakeCLP: 1,
    totalOdds: 2.1,
    payoutCLP: 2.1,
    legs,
  });
  const second = await recordBet({
    date: "2099-01-02",
    mode: "Diversion",
    strategyMode: "daily-fun",
    stakeCLP: 1,
    totalOdds: 2.1,
    payoutCLP: 2.1,
    legs,
  });
  assert(first.ticketId, "first ticket missing");
  assert(second.ticketId && second.ticketId !== first.ticketId, "second upsert path");

  await deleteTicketById(first.ticketId);
  await deleteTicketById(second.ticketId);
  await prisma.matchFixture.deleteMany({
    where: { apiFixtureId: { in: [888001, 888002] } },
  });
  await prisma.cachedApiResponse.deleteMany({ where: { id: cacheKey } });
  console.log("verify-http-upsert: ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
