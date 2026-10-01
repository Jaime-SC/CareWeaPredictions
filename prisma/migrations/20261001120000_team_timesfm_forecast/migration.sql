-- CreateTable
CREATE TABLE "TeamTimesfmForecast" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "asOfDate" DATE NOT NULL,
    "timesfmXgScored" DOUBLE PRECISION,
    "timesfmXgConceded" DOUBLE PRECISION,
    "timesfmNpxGScored" DOUBLE PRECISION,
    "timesfmNpxGConceded" DOUBLE PRECISION,
    "timesfmCornersFor" DOUBLE PRECISION,
    "timesfmCornersAgainst" DOUBLE PRECISION,
    "timesfmCardsFor" DOUBLE PRECISION,
    "timesfmCardsAgainst" DOUBLE PRECISION,
    "timesfmFormScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamTimesfmForecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamTimesfmForecast_teamId_asOfDate_key" ON "TeamTimesfmForecast"("teamId", "asOfDate");

-- CreateIndex
CREATE INDEX "TeamTimesfmForecast_asOfDate_idx" ON "TeamTimesfmForecast"("asOfDate");

-- CreateIndex
CREATE INDEX "TeamTimesfmForecast_teamId_asOfDate_idx" ON "TeamTimesfmForecast"("teamId", "asOfDate");
