-- CreateTable
CREATE TABLE "TeamProfileSnapshot" (
    "id" TEXT NOT NULL,
    "teamId" INTEGER NOT NULL,
    "asOfDate" DATE NOT NULL,
    "teamName" TEXT,
    "primaryLeagueId" INTEGER,
    "totalMatchesAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "homeMatchesCount" INTEGER NOT NULL DEFAULT 0,
    "awayMatchesCount" INTEGER NOT NULL DEFAULT 0,
    "avgGoalsScoredHome" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgGoalsConcededHome" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgGoalsScoredAway" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgGoalsConcededAway" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "over15GoalsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "over15GoalsRateHome" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "over15GoalsRateAway" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "over25GoalsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cleanSheetRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cleanSheetRateHome" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cleanSheetRateAway" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgNpxGScored" DOUBLE PRECISION,
    "avgNpxGConceded" DOUBLE PRECISION,
    "avgPPDA" DOUBLE PRECISION,
    "avgCornersFor" DOUBLE PRECISION,
    "avgCornersAgainst" DOUBLE PRECISION,
    "avgCardsFor" DOUBLE PRECISION,
    "avgCardsAgainst" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamProfileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamProfileSnapshot_teamId_asOfDate_key" ON "TeamProfileSnapshot"("teamId", "asOfDate");

-- CreateIndex
CREATE INDEX "TeamProfileSnapshot_teamId_asOfDate_idx" ON "TeamProfileSnapshot"("teamId", "asOfDate");
