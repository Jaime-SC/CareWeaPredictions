-- CreateTable
CREATE TABLE "MatchFixture" (
    "id" TEXT NOT NULL,
    "apiFixtureId" INTEGER NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL,
    "matchDate" TIMESTAMP(3) NOT NULL,
    "finalScore" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchFixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "ticketId" TEXT,
    "market" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "odds" DOUBLE PRECISION NOT NULL,
    "modelProbability" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccumulatorTicket" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "stakeCLP" DOUBLE PRECISION NOT NULL,
    "totalOdds" DOUBLE PRECISION NOT NULL,
    "payoutCLP" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccumulatorTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CachedApiResponse" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CachedApiResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiQuotaDaily" (
    "date" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER NOT NULL DEFAULT 100,
    "remaining" INTEGER NOT NULL DEFAULT 100,
    "fromHeaders" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiQuotaDaily_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchFixture_apiFixtureId_key" ON "MatchFixture"("apiFixtureId");

-- CreateIndex
CREATE INDEX "Prediction_ticketId_idx" ON "Prediction"("ticketId");

-- CreateIndex
CREATE INDEX "Prediction_outcome_idx" ON "Prediction"("outcome");

-- CreateIndex
CREATE INDEX "Prediction_market_idx" ON "Prediction"("market");

-- CreateIndex
CREATE INDEX "AccumulatorTicket_date_idx" ON "AccumulatorTicket"("date");

-- CreateIndex
CREATE INDEX "AccumulatorTicket_mode_idx" ON "AccumulatorTicket"("mode");

-- CreateIndex
CREATE INDEX "AccumulatorTicket_status_idx" ON "AccumulatorTicket"("status");

-- CreateIndex
CREATE INDEX "CachedApiResponse_endpoint_idx" ON "CachedApiResponse"("endpoint");

-- CreateIndex
CREATE INDEX "CachedApiResponse_expiresAt_idx" ON "CachedApiResponse"("expiresAt");

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "MatchFixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "AccumulatorTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
