-- CreateTable
CREATE TABLE "CachedApiResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpoint" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ApiQuotaDaily" (
    "date" TEXT NOT NULL PRIMARY KEY,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "CachedApiResponse_endpoint_idx" ON "CachedApiResponse"("endpoint");

-- CreateIndex
CREATE INDEX "CachedApiResponse_expiresAt_idx" ON "CachedApiResponse"("expiresAt");
