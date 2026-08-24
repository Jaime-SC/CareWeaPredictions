/**
 * Neon HTTP: Prisma 5.22 wraps updateMany in an internal transaction.
 * Usage: npx tsx scripts/verify-neon-http-nomany.ts
 */
import { prisma } from "../lib/db";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  let updateManyFailed = false;
  try {
    await prisma.prediction.updateMany({
      where: { id: { in: ["__neon_http_txn_probe__"] } },
      data: { outcome: "PENDING" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateManyFailed = msg.includes("Transactions are not supported in HTTP mode");
    if (!updateManyFailed) throw err;
  }
  assert(updateManyFailed, "expected updateMany to fail on Neon HTTP");

  const n = await prisma.prediction.count();
  assert(typeof n === "number", "count must work without a transaction");
  console.log("verify-neon-http-nomany: ok (updateMany blocked, count works)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
