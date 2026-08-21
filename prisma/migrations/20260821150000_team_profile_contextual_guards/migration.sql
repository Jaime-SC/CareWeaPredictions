-- Manager reset cutoff + key absence count for TeamProfile guards
ALTER TABLE "TeamProfile" ADD COLUMN IF NOT EXISTS "lastManagerChangeDate" TIMESTAMP(3);
ALTER TABLE "TeamProfile" ADD COLUMN IF NOT EXISTS "keyAbsencesCount" INTEGER NOT NULL DEFAULT 0;
