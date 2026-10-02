/**
 * Dump TeamProfileSnapshot series for TimesFM batch (Neon HTTP via Prisma).
 * Usage: npx tsx scripts/dump-timesfm-series.ts --as-of YYYY-MM-DD
 * Prints JSON: { "<teamId>": { xg_scored: number[], ... }, ... }
 */
import { prisma } from "../lib/db";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

async function main() {
  const asOf = arg("--as-of", new Date().toISOString().slice(0, 10));
  const window = Math.max(2, Number(arg("--window", "20")) || 20);
  const asOfDate = new Date(`${asOf}T00:00:00.000Z`);
  if (!Number.isFinite(asOfDate.getTime())) {
    throw new Error(`invalid as-of: ${asOf}`);
  }

  const rows = await prisma.teamProfileSnapshot.findMany({
    where: { asOfDate: { lt: asOfDate } },
    orderBy: [{ teamId: "asc" }, { asOfDate: "asc" }],
    select: {
      teamId: true,
      avgNpxGScored: true,
      avgNpxGConceded: true,
      avgCornersFor: true,
      avgCornersAgainst: true,
      avgCardsFor: true,
      avgCardsAgainst: true,
      avgGoalsScoredHome: true,
      avgGoalsScoredAway: true,
      avgGoalsConcededHome: true,
      avgGoalsConcededAway: true,
      over15GoalsRate: true,
    },
  });

  type Series = Record<string, number[]>;
  const byTeam = new Map<number, Series>();
  const empty = (): Series => ({
    xg_scored: [],
    xg_conceded: [],
    npxg_scored: [],
    npxg_conceded: [],
    corners_for: [],
    corners_against: [],
    cards_for: [],
    cards_against: [],
    form: [],
  });

  for (const row of rows) {
    const bucket = byTeam.get(row.teamId) ?? empty();
    if (!byTeam.has(row.teamId)) byTeam.set(row.teamId, bucket);

    const gs =
      ((row.avgGoalsScoredHome ?? 0) + (row.avgGoalsScoredAway ?? 0)) / 2;
    const gc =
      ((row.avgGoalsConcededHome ?? 0) + (row.avgGoalsConcededAway ?? 0)) / 2;
    const xgS = row.avgNpxGScored ?? gs;
    const xgC = row.avgNpxGConceded ?? gc;
    bucket.xg_scored.push(xgS);
    bucket.xg_conceded.push(xgC);
    bucket.npxg_scored.push(row.avgNpxGScored ?? xgS);
    bucket.npxg_conceded.push(row.avgNpxGConceded ?? xgC);
    if (row.avgCornersFor != null) bucket.corners_for.push(row.avgCornersFor);
    if (row.avgCornersAgainst != null) {
      bucket.corners_against.push(row.avgCornersAgainst);
    }
    if (row.avgCardsFor != null) bucket.cards_for.push(row.avgCardsFor);
    if (row.avgCardsAgainst != null) {
      bucket.cards_against.push(row.avgCardsAgainst);
    }
    if (row.over15GoalsRate != null) {
      bucket.form.push(Math.min(1, Math.max(0, row.over15GoalsRate)));
    }
  }

  const out: Record<string, Series> = {};
  for (const [teamId, series] of byTeam) {
    const trimmed: Series = {};
    for (const [k, vals] of Object.entries(series)) {
      trimmed[k] = vals.length > window ? vals.slice(-window) : vals;
    }
    out[String(teamId)] = trimmed;
  }

  process.stdout.write(JSON.stringify(out));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
