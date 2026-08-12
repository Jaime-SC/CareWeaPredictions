/**
 * Smoke: record a ticket and read stats from SQLite.
 * Usage: npx tsx scripts/verify-db.ts
 */
import { buildStatsSummary, clearAllBets, recordBet } from "../lib/bet-db";
import { prisma } from "../lib/db";

async function main() {
  const r = await recordBet({
    date: "2026-08-12",
    mode: "Diversion",
    strategyMode: "daily-fun",
    stakeCLP: 200,
    totalOdds: 12.5,
    payoutCLP: 2500,
    legs: [
      {
        matchId: "live-999001",
        matchLabel: "Test FC vs Rival United",
        leagueName: "Premier League",
        kickoff: new Date().toISOString(),
        market: "over_1_5",
        marketLabel: "+1.5 Goles",
        odds: 1.25,
        modelProbability: 0.82,
      },
      {
        matchId: "live-999002",
        matchLabel: "Alpha vs Beta",
        leagueName: "Copa Libertadores",
        kickoff: new Date().toISOString(),
        market: "1x",
        marketLabel: "Doble Oportunidad 1X",
        odds: 1.3,
        modelProbability: 0.79,
      },
    ],
  });

  console.log("record", r);
  const summary = await buildStatsSummary();
  console.log(
    JSON.stringify(
      {
        tickets: summary.tickets.length,
        predictions: summary.trainingExport.length,
        byLeague: summary.byLeague.length,
        meta: summary.summary,
      },
      null,
      2
    )
  );

  // cleanup smoke data
  await clearAllBets();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
