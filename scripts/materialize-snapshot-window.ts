/**
 * Materialize TeamProfileSnapshot for a window of cutoffs (Neon HTTP via Prisma).
 * Use when Understat ingest is unavailable — builds PIT rows from MatchFixture.
 *
 * Usage: npx tsx scripts/materialize-snapshot-window.ts --days=30 --step=2
 */
import { materializeMatchdaySnapshots } from "../lib/team-profiler";
import { prisma } from "../lib/db";

function argNum(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  const n = hit ? Number(hit.slice(name.length + 1)) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main() {
  const days = argNum("--days", 40);
  const step = argNum("--step", 2);

  const fixtureCount = await prisma.matchFixture.count({
    where: { finalScore: { not: null } },
  });
  console.log(
    JSON.stringify({ finishedFixtures: fixtureCount, days, step })
  );
  if (fixtureCount === 0) {
    throw new Error(
      "No MatchFixture with finalScore — cannot materialize snapshots"
    );
  }

  let totalUpserted = 0;
  const today = new Date();
  for (let back = 0; back < days; back += step) {
    const asOf = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - back
      )
    );
    const result = await materializeMatchdaySnapshots(asOf);
    totalUpserted += result.upserted;
    console.log(
      JSON.stringify({
        asOf: asOf.toISOString().slice(0, 10),
        ...result,
      })
    );
  }

  const snapshots = await prisma.teamProfileSnapshot.count();
  console.log(JSON.stringify({ done: true, totalUpserted, snapshots }));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
