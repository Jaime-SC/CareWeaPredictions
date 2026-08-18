import { prisma } from "./db";
import {
  buildReadinessMetrics,
  type ClvLeg,
  type ReadinessReport,
  type SettledTicketPnL,
} from "./pro-metrics";

function ticketStatus(status: string): "won" | "lost" | null {
  const s = status.trim().toUpperCase();
  if (s === "WON") return "won";
  if (s === "LOST") return "lost";
  return null;
}

type ClvSqlRow = {
  odds: number;
  closingOdds: number | null;
  closingOddsAt: Date | string | null;
  createdAt: Date | string;
  matchDate: Date | string;
};

export async function buildReadinessReport(
  initialBankroll?: number
): Promise<ReadinessReport> {
  const [tickets, clvRows] = await Promise.all([
    prisma.accumulatorTicket.findMany({
      where: { status: { in: ["WON", "LOST"] } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        stakeCLP: true,
        payoutCLP: true,
        status: true,
      },
    }),
    // Raw SQL so this works even if a stale PrismaClient (hot-reload /
    // Turbopack vendored copy) still does not know closingOdds.
    prisma.$queryRaw<ClvSqlRow[]>`
      SELECT
        p.odds,
        p."closingOdds",
        p."closingOddsAt",
        p."createdAt",
        f."matchDate"
      FROM "Prediction" p
      INNER JOIN "MatchFixture" f ON f.id = p."fixtureId"
      WHERE p."closingOdds" IS NOT NULL
        AND p."closingOddsAt" IS NOT NULL
    `,
  ]);

  const settled: SettledTicketPnL[] = [];
  for (const t of tickets) {
    const status = ticketStatus(t.status);
    if (!status) continue;
    settled.push({
      stake: t.stakeCLP,
      payout: t.payoutCLP,
      status,
    });
  }

  const clvLegs: ClvLeg[] = [];
  for (const row of clvRows) {
    if (row.closingOdds == null || row.closingOddsAt == null) continue;
    clvLegs.push({
      takenOdds: row.odds,
      closingOdds: row.closingOdds,
      createdAtMs: new Date(row.createdAt).getTime(),
      closingOddsAtMs: new Date(row.closingOddsAt).getTime(),
      kickoffMs: new Date(row.matchDate).getTime(),
    });
  }

  const metrics = buildReadinessMetrics({
    tickets: settled,
    clvLegs,
    initialBankroll,
  });

  return {
    ...metrics,
    generatedAt: new Date().toISOString(),
  };
}
