/**
 * Copy local SQLite (prisma/dev.db) into Neon PostgreSQL.
 *
 * Prerequisites:
 *   DATABASE_URL + DIRECT_URL pointing at Neon
 *   npm run db:migrate   (empty Postgres schema)
 *
 * Usage:
 *   npm run db:import-sqlite
 *   npx tsx scripts/migrate-sqlite-to-neon.ts --sqlite prisma/dev.db
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/db";

type SqliteRow = Record<string, unknown>;

function parseArgs(argv: string[]): { sqlitePath: string } {
  const idx = argv.indexOf("--sqlite");
  const fromFlag = idx >= 0 ? argv[idx + 1] : undefined;
  return {
    sqlitePath:
      fromFlag ||
      process.env.SQLITE_DATABASE_PATH ||
      path.join("prisma", "dev.db"),
  };
}

function toDate(value: unknown, field: string): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = value.includes("T") ? value : value.replace(" ", "T");
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new Error(`Fecha inválida en ${field}: ${String(value)}`);
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Número inválido en ${field}: ${String(value)}`);
}

function toStringValue(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  if (value == null) throw new Error(`Texto vacío en ${field}`);
  return String(value);
}

function toOptionalString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function main() {
  const { sqlitePath } = parseArgs(process.argv.slice(2));
  const resolved = path.resolve(sqlitePath);

  if (!existsSync(resolved)) {
    console.error(`No encontré SQLite en ${resolved}`);
    console.error("Pasa la ruta: npx tsx scripts/migrate-sqlite-to-neon.ts --sqlite prisma/dev.db");
    process.exitCode = 1;
    return;
  }

  const sqliteMod = (await import("node:sqlite")) as {
    DatabaseSync: new (
      dbPath: string,
      options?: { readOnly?: boolean }
    ) => {
      prepare(sql: string): { all(): unknown[] };
      close(): void;
    };
  };
  const sqlite = new sqliteMod.DatabaseSync(resolved, { readOnly: true });

  const fixtures = sqlite.prepare("SELECT * FROM MatchFixture").all() as SqliteRow[];
  const tickets = sqlite
    .prepare("SELECT * FROM AccumulatorTicket")
    .all() as SqliteRow[];
  const predictions = sqlite.prepare("SELECT * FROM Prediction").all() as SqliteRow[];
  const cache = sqlite
    .prepare("SELECT * FROM CachedApiResponse")
    .all() as SqliteRow[];
  const quota = sqlite.prepare("SELECT * FROM ApiQuotaDaily").all() as SqliteRow[];
  sqlite.close();

  console.log("SQLite leído:", {
    file: resolved,
    fixtures: fixtures.length,
    tickets: tickets.length,
    predictions: predictions.length,
    cache: cache.length,
    quota: quota.length,
  });

  await prisma.$queryRaw`SELECT 1`;

  const fixtureResult = await prisma.matchFixture.createMany({
    data: fixtures.map((row) => ({
      id: toStringValue(row.id, "MatchFixture.id"),
      apiFixtureId: toNumber(row.apiFixtureId, "MatchFixture.apiFixtureId"),
      homeTeam: toStringValue(row.homeTeam, "MatchFixture.homeTeam"),
      awayTeam: toStringValue(row.awayTeam, "MatchFixture.awayTeam"),
      leagueId: toStringValue(row.leagueId, "MatchFixture.leagueId"),
      leagueName: toStringValue(row.leagueName, "MatchFixture.leagueName"),
      matchDate: toDate(row.matchDate, "MatchFixture.matchDate"),
      finalScore: toOptionalString(row.finalScore),
      status: toStringValue(row.status, "MatchFixture.status"),
      createdAt: toDate(row.createdAt, "MatchFixture.createdAt"),
      updatedAt: toDate(row.updatedAt, "MatchFixture.updatedAt"),
    })),
    skipDuplicates: true,
  });

  const ticketResult = await prisma.accumulatorTicket.createMany({
    data: tickets.map((row) => ({
      id: toStringValue(row.id, "AccumulatorTicket.id"),
      date: toStringValue(row.date, "AccumulatorTicket.date"),
      mode: toStringValue(row.mode, "AccumulatorTicket.mode"),
      stakeCLP: toNumber(row.stakeCLP, "AccumulatorTicket.stakeCLP"),
      totalOdds: toNumber(row.totalOdds, "AccumulatorTicket.totalOdds"),
      payoutCLP: toNumber(row.payoutCLP, "AccumulatorTicket.payoutCLP"),
      status: toStringValue(row.status, "AccumulatorTicket.status"),
      createdAt: toDate(row.createdAt, "AccumulatorTicket.createdAt"),
      updatedAt: toDate(row.updatedAt, "AccumulatorTicket.updatedAt"),
    })),
    skipDuplicates: true,
  });

  const predictionResult = await prisma.prediction.createMany({
    data: predictions.map((row) => ({
      id: toStringValue(row.id, "Prediction.id"),
      fixtureId: toStringValue(row.fixtureId, "Prediction.fixtureId"),
      ticketId: toOptionalString(row.ticketId),
      market: toStringValue(row.market, "Prediction.market"),
      selection: toStringValue(row.selection, "Prediction.selection"),
      odds: toNumber(row.odds, "Prediction.odds"),
      modelProbability: toNumber(
        row.modelProbability,
        "Prediction.modelProbability"
      ),
      outcome: toStringValue(row.outcome, "Prediction.outcome"),
      createdAt: toDate(row.createdAt, "Prediction.createdAt"),
      updatedAt: toDate(row.updatedAt, "Prediction.updatedAt"),
    })),
    skipDuplicates: true,
  });

  const cacheRows = cache.map((row) => ({
    id: toStringValue(row.id, "CachedApiResponse.id"),
    endpoint: toStringValue(row.endpoint, "CachedApiResponse.endpoint"),
    payload: toStringValue(row.payload, "CachedApiResponse.payload"),
    expiresAt: toDate(row.expiresAt, "CachedApiResponse.expiresAt"),
    createdAt: toDate(row.createdAt, "CachedApiResponse.createdAt"),
    updatedAt: toDate(row.updatedAt, "CachedApiResponse.updatedAt"),
  }));
  let cacheCount = 0;
  for (const batch of chunk(cacheRows, 10)) {
    const inserted = await prisma.cachedApiResponse.createMany({
      data: batch,
      skipDuplicates: true,
    });
    cacheCount += inserted.count;
  }

  const quotaResult = await prisma.apiQuotaDaily.createMany({
    data: quota.map((row) => ({
      date: toStringValue(row.date, "ApiQuotaDaily.date"),
      callCount: toNumber(row.callCount ?? 0, "ApiQuotaDaily.callCount"),
      limit: toNumber(row.limit ?? 100, "ApiQuotaDaily.limit"),
      remaining: toNumber(row.remaining ?? 100, "ApiQuotaDaily.remaining"),
      fromHeaders: toBool(row.fromHeaders ?? false),
      updatedAt: toDate(row.updatedAt, "ApiQuotaDaily.updatedAt"),
    })),
    skipDuplicates: true,
  });

  console.log("Importado a Neon (filas nuevas; duplicados omitidos):", {
    fixtures: fixtureResult.count,
    tickets: ticketResult.count,
    predictions: predictionResult.count,
    cache: cacheCount,
    quota: quotaResult.count,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
