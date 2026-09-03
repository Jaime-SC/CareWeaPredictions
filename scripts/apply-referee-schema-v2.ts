/**
 * Apply RefereeProfile v2 tables via Neon HTTP.
 * Usage: npx tsx --env-file=.env scripts/apply-referee-schema-v2.ts
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  await sql`ALTER TABLE "RefereeProfile" ADD COLUMN IF NOT EXISTS "avgPenalties" DOUBLE PRECISION NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE "RefereeProfile" ADD COLUMN IF NOT EXISTS "matchCount" INTEGER NOT NULL DEFAULT 0`;

  await sql`
    CREATE TABLE IF NOT EXISTS "RefereeLeagueStat" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "refereeId" TEXT NOT NULL REFERENCES "RefereeProfile"(id) ON DELETE CASCADE,
      "leagueId" INTEGER NOT NULL,
      region TEXT NOT NULL,
      "avgYellowCards" DOUBLE PRECISION NOT NULL,
      "avgRedCards" DOUBLE PRECISION NOT NULL,
      "avgFoulsPerMatch" DOUBLE PRECISION NOT NULL,
      "avgPenalties" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "matchCount" INTEGER NOT NULL,
      "strictnessIndex" DOUBLE PRECISION NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("refereeId", "leagueId")
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "RefereeLeagueStat_leagueId_idx" ON "RefereeLeagueStat"("leagueId")`;
  await sql`CREATE INDEX IF NOT EXISTS "RefereeLeagueStat_region_idx" ON "RefereeLeagueStat"(region)`;

  await sql`
    CREATE TABLE IF NOT EXISTS "CompetitionCardBaseline" (
      "leagueId" INTEGER PRIMARY KEY,
      region TEXT NOT NULL,
      "avgYellowCards" DOUBLE PRECISION NOT NULL,
      "avgRedCards" DOUBLE PRECISION NOT NULL,
      "avgFoulsPerMatch" DOUBLE PRECISION NOT NULL,
      "avgPenalties" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "matchCount" INTEGER NOT NULL,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "CompetitionCardBaseline_region_idx" ON "CompetitionCardBaseline"(region)`;

  await sql`
    CREATE TABLE IF NOT EXISTS "RefereeMatchRecord" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "refereeId" TEXT NOT NULL REFERENCES "RefereeProfile"(id) ON DELETE CASCADE,
      "leagueId" INTEGER NOT NULL,
      "apiFixtureId" INTEGER NOT NULL UNIQUE,
      "matchDate" TIMESTAMPTZ NOT NULL,
      "yellowCards" DOUBLE PRECISION NOT NULL,
      "redCards" DOUBLE PRECISION NOT NULL,
      fouls DOUBLE PRECISION NOT NULL,
      penalties DOUBLE PRECISION NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "RefereeMatchRecord_refereeId_matchDate_idx" ON "RefereeMatchRecord"("refereeId", "matchDate")`;
  await sql`CREATE INDEX IF NOT EXISTS "RefereeMatchRecord_refereeId_leagueId_matchDate_idx" ON "RefereeMatchRecord"("refereeId", "leagueId", "matchDate")`;

  console.log("Referee schema v2 applied.");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
