-- Local rolling team profiles for historical Poisson calibration
CREATE TABLE IF NOT EXISTS "TeamProfile" (
    "id" TEXT NOT NULL,
    "teamId" INTEGER NOT NULL,
    "teamName" TEXT NOT NULL,
    "totalMatchesAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "avgGoalsScoredHome" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgGoalsConcededHome" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgGoalsScoredAway" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgGoalsConcededAway" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "over15GoalsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "over25GoalsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cleanSheetRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeamProfile_teamId_key" ON "TeamProfile"("teamId");
CREATE INDEX IF NOT EXISTS "TeamProfile_teamName_idx" ON "TeamProfile"("teamName");
