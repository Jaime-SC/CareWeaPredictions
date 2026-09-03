/**
 * Referee asOf leakage check: post-cutoff fixtures must not affect strictness.
 * Usage: npx tsx --env-file=.env scripts/verify-referee-asof.ts
 */
import { prisma } from "../lib/db";
import {
  MIN_REFEREE_LEAGUE_SAMPLE,
  resolveRefereeStrictnessAt,
  resetRefereeCache,
  strictnessFromYellow,
} from "../lib/referee-engine";

const REF = "AsOf Verify Referee";
const LEAGUE = 39;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

async function main() {
  const profile = await prisma.refereeProfile.upsert({
    where: { name: REF },
    create: {
      name: REF,
      avgYellowCards: 4,
      avgRedCards: 0.2,
      avgFoulsPerMatch: 22,
      avgPenalties: 0.1,
      strictnessIndex: 1.05,
      matchCount: 6,
    },
    update: {
      avgYellowCards: 4,
      avgRedCards: 0.2,
      avgFoulsPerMatch: 22,
      matchCount: 6,
    },
  });

  await prisma.competitionCardBaseline.upsert({
    where: { leagueId: LEAGUE },
    create: {
      leagueId: LEAGUE,
      region: "europe-top3-and-2nd",
      avgYellowCards: 3.5,
      avgRedCards: 0.15,
      avgFoulsPerMatch: 20,
      matchCount: 100,
    },
    update: { avgYellowCards: 3.5 },
  });

  const pre = new Date("2026-03-10T18:00:00.000Z");
  const cutoff = new Date("2026-03-15T20:00:00.000Z");
  const post = new Date("2026-03-20T18:00:00.000Z");

  await prisma.refereeMatchRecord.deleteMany({ where: { refereeId: profile.id } });

  const rows = [
    { apiFixtureId: 900001, matchDate: pre, yellowCards: 3 },
    { apiFixtureId: 900002, matchDate: pre, yellowCards: 3 },
    { apiFixtureId: 900003, matchDate: pre, yellowCards: 3 },
    { apiFixtureId: 900004, matchDate: pre, yellowCards: 3 },
    { apiFixtureId: 900005, matchDate: pre, yellowCards: 3 },
    { apiFixtureId: 900006, matchDate: post, yellowCards: 10 },
  ];

  for (const r of rows) {
    await prisma.refereeMatchRecord.create({
      data: {
        refereeId: profile.id,
        leagueId: LEAGUE,
        apiFixtureId: r.apiFixtureId,
        matchDate: r.matchDate,
        yellowCards: r.yellowCards,
        redCards: 0,
        fouls: 20,
        penalties: 0,
      },
    });
  }

  resetRefereeCache();

  const atCutoff = await resolveRefereeStrictnessAt(REF, LEAGUE, cutoff);
  const expected = strictnessFromYellow(3, 3.5);
  assert(
    Math.abs(atCutoff - expected) < 0.01,
    `asOf strictness uses only pre-cutoff matches (${atCutoff.toFixed(3)} ~ ${expected.toFixed(3)})`
  );
  assert(
    atCutoff < strictnessFromYellow(4.5, 3.5),
    "post-cutoff high-card fixture excluded from asOf aggregate"
  );

  console.log(`MIN_REFEREE_LEAGUE_SAMPLE=${MIN_REFEREE_LEAGUE_SAMPLE}`);

  await prisma.refereeMatchRecord.deleteMany({ where: { refereeId: profile.id } });
  await prisma.refereeProfile.delete({ where: { id: profile.id } });
  console.log("\nAll referee asOf checks passed.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
