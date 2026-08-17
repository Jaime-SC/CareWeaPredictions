/**
 * Apply Prisma migrations to Neon over HTTPS (port 443).
 * Use this when the network blocks Postgres 5432 (`prisma migrate deploy`).
 *
 * Usage: npm run db:migrate:http
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const MIGRATIONS_DIR = path.join("prisma", "migrations");

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL debe ser la cadena PostgreSQL de Neon en .env"
    );
  }
  return url;
}

function sqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

async function main() {
  const sql = neon(requireDatabaseUrl());

  await sql(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY ("id")
    )
  `);

  const appliedRows = (await sql(
    `SELECT "migration_name" FROM "_prisma_migrations" WHERE "rolled_back_at" IS NULL`
  )) as { migration_name: string }[];
  const applied = new Set(appliedRows.map((row) => row.migration_name));

  const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let appliedCount = 0;
  for (const name of folders) {
    if (applied.has(name)) {
      console.log(`skip  ${name}`);
      continue;
    }

    const file = path.join(MIGRATIONS_DIR, name, "migration.sql");
    const raw = readFileSync(file, "utf8");
    const statements = sqlStatements(raw);
    if (statements.length === 0) {
      console.log(`empty ${name}`);
      continue;
    }

    console.log(`apply ${name} (${statements.length} statements)`);
    for (const statement of statements) {
      await sql(statement);
    }

    await sql(
      `INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
       VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), $4)`,
      [randomUUID(), checksum(raw), name, statements.length]
    );
    appliedCount += 1;
  }

  console.log(`Migraciones aplicadas: ${appliedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
