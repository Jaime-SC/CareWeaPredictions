-- CreateTable
CREATE TABLE "MatchFixture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "apiFixtureId" INTEGER NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "leagueName" TEXT NOT NULL,
    "matchDate" DATETIME NOT NULL,
    "finalScore" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NS',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Prediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "ticketId" TEXT,
    "market" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "odds" REAL NOT NULL,
    "modelProbability" REAL NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prediction_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "MatchFixture" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Prediction_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "AccumulatorTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccumulatorTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "stakeCLP" REAL NOT NULL,
    "totalOdds" REAL NOT NULL,
    "payoutCLP" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
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
