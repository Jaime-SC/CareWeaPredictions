import { prisma } from "../lib/db";

async function main() {
  const sample = await prisma.matchFixture.findMany({
    where: { finalScore: { not: null } },
    orderBy: { matchDate: "desc" },
    take: 5,
    select: {
      homeTeam: true,
      awayTeam: true,
      matchDate: true,
      finalScore: true,
      status: true,
      apiFixtureId: true,
    },
  });
  const range = await prisma.matchFixture.aggregate({
    where: { finalScore: { not: null } },
    _min: { matchDate: true },
    _max: { matchDate: true },
  });
  const profiles = await prisma.teamProfile.count();
  const mapped = await prisma.teamProfile.count({
    where: { teamId: { gt: 0 } },
  });
  console.log(
    JSON.stringify({ sample, range, profiles, mapped }, null, 2)
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
