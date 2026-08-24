/**
 * Verify Neon/Prisma connectivity + TeamProfile.primaryLeagueId column.
 * Does NOT run on `npm run dev` — invoke manually when schema drifts.
 *
 * Usage: npm run db:sync
 */
import { existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("file:")) {
    throw new Error("DATABASE_URL debe ser la cadena PostgreSQL de Neon");
  }

  const sql = neon(url);
  const t0 = Date.now();
  await sql`select 1 as ok`;
  console.log(`connection OK (${Date.now() - t0}ms)`);

  const cols = await sql`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'TeamProfile'
      and column_name = 'primaryLeagueId'
  `;

  if (!Array.isArray(cols) || cols.length === 0) {
    console.warn(
      "[sync-db-schema] TeamProfile.primaryLeagueId missing — run: npm run db:migrate:http"
    );
    process.exitCode = 1;
    return;
  }

  console.log("TeamProfile.primaryLeagueId:", cols[0]);

  // Read-only probe (fail-safe if empty table)
  const sample = await sql`
    select "teamId", "teamName", "primaryLeagueId"
    from "TeamProfile"
    order by "updatedAt" desc
    limit 3
  `;
  console.log(`sample rows: ${Array.isArray(sample) ? sample.length : 0}`);
}

main().catch((err) => {
  console.error("[sync-db-schema]", err);
  process.exitCode = 1;
});
