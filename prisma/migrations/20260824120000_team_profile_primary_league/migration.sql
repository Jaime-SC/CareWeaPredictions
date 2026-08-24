-- Disambiguate Serie A IT vs Brasileirão via primaryLeagueId
ALTER TABLE "TeamProfile" ADD COLUMN IF NOT EXISTS "primaryLeagueId" INTEGER;
ALTER TABLE "TeamProfile" ADD COLUMN IF NOT EXISTS "country" TEXT;
CREATE INDEX IF NOT EXISTS "TeamProfile_primaryLeagueId_idx" ON "TeamProfile"("primaryLeagueId");
