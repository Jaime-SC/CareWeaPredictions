-- Single-tenant bankroll settings (singleton row id = 'default')
CREATE TABLE IF NOT EXISTS "BankrollSettings" (
    "id" TEXT NOT NULL,
    "totalBankroll" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "minBookmakerStake" DOUBLE PRECISION NOT NULL,
    "maxRiskSingle" DOUBLE PRECISION NOT NULL,
    "maxRiskParlay" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankrollSettings_pkey" PRIMARY KEY ("id")
);
