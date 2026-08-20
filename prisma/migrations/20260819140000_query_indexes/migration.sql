-- Query indexes for settlement, calibration, and fixture lookups
CREATE INDEX IF NOT EXISTS "MatchFixture_leagueId_idx" ON "MatchFixture"("leagueId");
CREATE INDEX IF NOT EXISTS "MatchFixture_matchDate_idx" ON "MatchFixture"("matchDate");
CREATE INDEX IF NOT EXISTS "MatchFixture_status_idx" ON "MatchFixture"("status");
CREATE INDEX IF NOT EXISTS "MatchFixture_createdAt_idx" ON "MatchFixture"("createdAt");
CREATE INDEX IF NOT EXISTS "Prediction_fixtureId_idx" ON "Prediction"("fixtureId");
CREATE INDEX IF NOT EXISTS "Prediction_createdAt_idx" ON "Prediction"("createdAt");
CREATE INDEX IF NOT EXISTS "AccumulatorTicket_createdAt_idx" ON "AccumulatorTicket"("createdAt");
