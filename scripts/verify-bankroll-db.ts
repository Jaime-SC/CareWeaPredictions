/**
 * Smoke: bankroll singleton on Neon (get → set → debit fail → debit ok → refund).
 * Usage: npx tsx scripts/verify-bankroll-db.ts
 */
import {
  adjustBankrollTotal,
  debitBankrollTotal,
  getOrCreateBankroll,
  putBankroll,
  refundBankrollTotal,
  setBankrollTotal,
} from "../lib/bankroll-db";
import { DEFAULT_BANKROLL_SETTINGS } from "../lib/bankroll-settings";
import { prisma } from "../lib/db";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const marker = 77_777;

  const initial = await putBankroll({
    ...DEFAULT_BANKROLL_SETTINGS,
    totalBankroll: marker,
  });
  assert(initial.totalBankroll === marker, `put got ${initial.totalBankroll}`);

  const got = await getOrCreateBankroll();
  assert(got.totalBankroll === marker, `get got ${got.totalBankroll}`);

  const fail = await debitBankrollTotal(marker + 1);
  assert(!fail.ok && fail.reason === "insufficient", "debit should fail");
  assert(
    fail.settings.totalBankroll === marker,
    `after fail debit balance ${fail.settings.totalBankroll}`
  );

  const ok = await debitBankrollTotal(777);
  assert(ok.ok, "debit should succeed");
  assert(
    ok.settings.totalBankroll === marker - 777,
    `after debit ${ok.settings.totalBankroll}`
  );

  const refunded = await refundBankrollTotal(777);
  assert(
    refunded.totalBankroll === marker,
    `after refund ${refunded.totalBankroll}`
  );

  const adjusted = await adjustBankrollTotal(-1_000);
  assert(
    adjusted.totalBankroll === marker - 1_000,
    `after adjust ${adjusted.totalBankroll}`
  );

  await setBankrollTotal(DEFAULT_BANKROLL_SETTINGS.totalBankroll);
  console.log("verify-bankroll-db: ok");
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
