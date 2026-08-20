import { prisma } from "@/lib/db";
import {
  BANKROLL_ROW_ID,
  DEFAULT_BANKROLL_SETTINGS,
  clampBankroll,
  isVirginBankrollRow,
  parseBankrollSettings,
  type BankrollSettings,
} from "@/lib/bankroll-settings";
import { roundCLP } from "@/lib/utils";

export type BankrollRow = BankrollSettings & {
  createdAt: Date;
  updatedAt: Date;
  virgin: boolean;
};

type DbRow = {
  id: string;
  totalBankroll: number;
  currency: string;
  minBookmakerStake: number;
  maxRiskSingle: number;
  maxRiskParlay: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function toRow(row: DbRow): BankrollRow {
  const settings = parseBankrollSettings(row);
  return {
    ...settings,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    virgin: isVirginBankrollRow(row),
  };
}

async function selectRow(): Promise<DbRow | null> {
  const rows = await prisma.$queryRaw<DbRow[]>`
    SELECT * FROM "BankrollSettings" WHERE "id" = ${BANKROLL_ROW_ID} LIMIT 1
  `;
  return rows[0] ?? null;
}

async function insertDefaults(): Promise<DbRow> {
  const d = DEFAULT_BANKROLL_SETTINGS;
  const rows = await prisma.$queryRaw<DbRow[]>`
    INSERT INTO "BankrollSettings" (
      "id", "totalBankroll", "currency", "minBookmakerStake",
      "maxRiskSingle", "maxRiskParlay", "createdAt", "updatedAt"
    ) VALUES (
      ${BANKROLL_ROW_ID},
      ${d.totalBankroll},
      ${d.currency},
      ${d.minBookmakerStake},
      ${d.maxRiskSingle},
      ${d.maxRiskParlay},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO NOTHING
    RETURNING *
  `;
  if (rows[0]) return rows[0];
  const existing = await selectRow();
  if (!existing) throw new Error("BankrollSettings row missing after insert");
  return existing;
}

/** GET-or-create singleton. Uses raw SQL (no Prisma model delegate). */
export async function getOrCreateBankroll(): Promise<BankrollRow> {
  const existing = await selectRow();
  if (existing) return toRow(existing);
  return toRow(await insertDefaults());
}

export async function putBankroll(raw: unknown): Promise<BankrollRow> {
  const s = parseBankrollSettings(raw);
  const rows = await prisma.$queryRaw<DbRow[]>`
    INSERT INTO "BankrollSettings" (
      "id", "totalBankroll", "currency", "minBookmakerStake",
      "maxRiskSingle", "maxRiskParlay", "createdAt", "updatedAt"
    ) VALUES (
      ${BANKROLL_ROW_ID},
      ${s.totalBankroll},
      ${s.currency},
      ${s.minBookmakerStake},
      ${s.maxRiskSingle},
      ${s.maxRiskParlay},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO UPDATE SET
      "totalBankroll" = EXCLUDED."totalBankroll",
      "currency" = EXCLUDED."currency",
      "minBookmakerStake" = EXCLUDED."minBookmakerStake",
      "maxRiskSingle" = EXCLUDED."maxRiskSingle",
      "maxRiskParlay" = EXCLUDED."maxRiskParlay",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING *
  `;
  const row = rows[0];
  if (!row) throw new Error("BankrollSettings upsert returned no row");
  return toRow(row);
}

export async function patchBankrollSettings(
  patch: Partial<BankrollSettings>
): Promise<BankrollRow> {
  const current = await getOrCreateBankroll();
  const next = parseBankrollSettings({ ...current, ...patch });
  return putBankroll(next);
}

export async function setBankrollTotal(amountCLP: number): Promise<BankrollRow> {
  return patchBankrollSettings({ totalBankroll: clampBankroll(amountCLP) });
}

export async function adjustBankrollTotal(
  deltaCLP: number
): Promise<BankrollRow> {
  await getOrCreateBankroll();
  const delta = roundCLP(deltaCLP);
  if (!Number.isFinite(delta) || delta === 0) {
    return getOrCreateBankroll();
  }
  const rows = await prisma.$queryRaw<DbRow[]>`
    UPDATE "BankrollSettings"
    SET
      "totalBankroll" = GREATEST(0, "totalBankroll" + ${delta}),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${BANKROLL_ROW_ID}
    RETURNING *
  `;
  const row = rows[0];
  if (!row) throw new Error("BankrollSettings row missing after adjust");
  return toRow(row);
}

export type DebitBankrollDbResult =
  | { ok: true; settings: BankrollRow }
  | { ok: false; settings: BankrollRow; reason: "invalid" | "insufficient" };

export async function debitBankrollTotal(
  amountCLP: number
): Promise<DebitBankrollDbResult> {
  await getOrCreateBankroll();
  const amount = roundCLP(amountCLP);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      settings: await getOrCreateBankroll(),
      reason: "invalid",
    };
  }
  const rows = await prisma.$queryRaw<DbRow[]>`
    UPDATE "BankrollSettings"
    SET
      "totalBankroll" = "totalBankroll" - ${amount},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${BANKROLL_ROW_ID}
      AND "totalBankroll" >= ${amount}
    RETURNING *
  `;
  if (rows[0]) {
    return { ok: true, settings: toRow(rows[0]) };
  }
  return {
    ok: false,
    settings: await getOrCreateBankroll(),
    reason: "insufficient",
  };
}

export async function refundBankrollTotal(
  amountCLP: number
): Promise<BankrollRow> {
  const amount = roundCLP(amountCLP);
  if (!Number.isFinite(amount) || amount <= 0) {
    return getOrCreateBankroll();
  }
  return adjustBankrollTotal(amount);
}
