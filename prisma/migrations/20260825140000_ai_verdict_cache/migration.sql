-- CreateTable
CREATE TABLE IF NOT EXISTS "AiVerdictCache" (
    "fixtureId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "vetoReason" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiVerdictCache_pkey" PRIMARY KEY ("fixtureId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiVerdictCache_expiresAt_idx" ON "AiVerdictCache"("expiresAt");
