/**
 * xCard / Friction Engine verification.
 * Simulates Boca Juniors vs. Palmeiras — Copa Libertadores Quarter-Finals,
 * strict referee (strictnessIndex 1.25).
 *
 * Usage: npx tsx scripts/verify-cards-engine.ts
 */
import { prisma } from "../lib/db";
import {
  computeXCard,
  computeCardProbabilities,
  resolveRivalryMultiplier,
  xCardProbabilities,
} from "../lib/friction-engine";
import { predictSecondaryMarkets } from "../lib/xgboost-runner";
import type { TeamProfileSnapshot } from "../lib/team-profile-shared";

// ─── Test fixtures ─────────────────────────────────────────────────────────

const REFEREE_NAME = "Wilton Sampaio (Verify Test)";

const bocaProfile: TeamProfileSnapshot = {
  teamId: 773,
  teamName: "Boca Juniors",
  primaryLeagueId: 128,
  totalMatchesAnalyzed: 20,
  homeMatchesCount: 10,
  awayMatchesCount: 10,
  avgGoalsScoredHome: 1.4,
  avgGoalsConcededHome: 1.0,
  avgGoalsScoredAway: 1.1,
  avgGoalsConcededAway: 1.2,
  over15GoalsRate: 0.65,
  over15GoalsRateHome: 0.7,
  over15GoalsRateAway: 0.6,
  over25GoalsRate: 0.4,
  cleanSheetRate: 0.25,
  cleanSheetRateHome: 0.3,
  cleanSheetRateAway: 0.2,
  keyAbsencesCount: 0,
  avgNpxGScored: 1.3,
  avgNpxGConceded: 1.1,
  avgPPDA: 7.5, // high press
  avgCornersFor: 5.2,
  avgCornersAgainst: 4.8,
  avgCardsFor: 2.8,  // aggressive
  avgCardsAgainst: 2.2,
};

const palmeirasProfle: TeamProfileSnapshot = {
  teamId: 121,
  teamName: "Palmeiras",
  primaryLeagueId: 71,
  totalMatchesAnalyzed: 22,
  homeMatchesCount: 11,
  awayMatchesCount: 11,
  avgGoalsScoredHome: 1.8,
  avgGoalsConcededHome: 0.8,
  avgGoalsScoredAway: 1.3,
  avgGoalsConcededAway: 1.1,
  over15GoalsRate: 0.72,
  over15GoalsRateHome: 0.75,
  over15GoalsRateAway: 0.68,
  over25GoalsRate: 0.48,
  cleanSheetRate: 0.35,
  cleanSheetRateHome: 0.4,
  cleanSheetRateAway: 0.3,
  keyAbsencesCount: 0,
  avgNpxGScored: 1.6,
  avgNpxGConceded: 0.9,
  avgPPDA: 9.2,
  avgCornersFor: 6.1,
  avgCornersAgainst: 4.3,
  avgCardsFor: 2.1,
  avgCardsAgainst: 1.9,
};

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ ${msg}`);
}

// ─── 1. DB: upsert & read RefereeProfile ──────────────────────────────────

async function step1_refereeDb(): Promise<void> {
  console.log("\n=== Step 1: RefereeProfile DB upsert & read ===");

  await prisma.refereeProfile.upsert({
    where: { name: REFEREE_NAME },
    create: {
      name: REFEREE_NAME,
      avgYellowCards: 4.8,
      avgRedCards: 0.4,
      avgFoulsPerMatch: 28.5,
      avgPenalties: 0.2,
      strictnessIndex: 1.25,
      matchCount: 12,
    },
    update: {
      avgYellowCards: 4.8,
      avgRedCards: 0.4,
      avgFoulsPerMatch: 28.5,
      avgPenalties: 0.2,
      strictnessIndex: 1.25,
      matchCount: 12,
    },
  });

  const profile = await prisma.refereeProfile.findUnique({
    where: { name: REFEREE_NAME },
  });

  assert(profile !== null, "RefereeProfile found after upsert");
  assert(profile!.strictnessIndex === 1.25, `strictnessIndex = 1.25 (got ${profile!.strictnessIndex})`);
  assert(profile!.avgYellowCards === 4.8, `avgYellowCards = 4.8 (got ${profile!.avgYellowCards})`);

  // Clean up test row
  await prisma.refereeProfile.delete({ where: { name: REFEREE_NAME } });
  console.log("  (test row cleaned up)");
}

// ─── 2. xCard with rivalry multiplier ────────────────────────────────────────

function step2_xCard(): void {
  console.log("\n=== Step 2: computeXCard with rivalry multiplier ===");

  const rivalryMult = resolveRivalryMultiplier({
    leagueId: 13, // Copa Libertadores
    roundLabel: "Quarter-Finals",
    homeCountry: "Argentina",
    awayCountry: "Brazil",
  });

  console.log(`  rivalry multiplier: ${rivalryMult}`);
  assert(rivalryMult === 1.35, `rivalry multiplier = 1.35 ARG-BRA + CONMEBOL KO (got ${rivalryMult})`);

  // Without rivalry (neutral league)
  const baseResult = computeXCard({
    homeAvgCardsFor: bocaProfile.avgCardsFor!,
    awayAvgCardsFor: palmeirasProfle.avgCardsFor!,
    homeAvgPPDA: bocaProfile.avgPPDA,
    awayAvgPPDA: palmeirasProfle.avgPPDA,
    refereeStrictness: 1.25,
    leagueId: 999, // neutral
    roundLabel: "Regular Season",
    homeCountry: "Argentina",
    awayCountry: "Brazil",
  });

  const rivalryResult = computeXCard({
    homeAvgCardsFor: bocaProfile.avgCardsFor!,
    awayAvgCardsFor: palmeirasProfle.avgCardsFor!,
    homeAvgPPDA: bocaProfile.avgPPDA,
    awayAvgPPDA: palmeirasProfle.avgPPDA,
    refereeStrictness: 1.25,
    leagueId: 13,
    roundLabel: "Quarter-Finals",
    homeCountry: "Argentina",
    awayCountry: "Brazil",
  });

  console.log(`  xCardTotal (neutral):  ${baseResult.xCardTotal.toFixed(3)}`);
  console.log(`  xCardTotal (rivalry):  ${rivalryResult.xCardTotal.toFixed(3)}`);
  console.log(`  rivalry multiplier applied: ${rivalryResult.rivalryMultiplier}`);

  assert(
    rivalryResult.xCardTotal > baseResult.xCardTotal,
    `xCardTotal with rivalry (${rivalryResult.xCardTotal.toFixed(3)}) > without (${baseResult.xCardTotal.toFixed(3)})`
  );
}

// ─── 3. Card probabilities thresholds ────────────────────────────────────────

function step3_probabilities(): void {
  console.log("\n=== Step 3: card probability thresholds ===");

  const { xCard, ...probs } = xCardProbabilities({
    homeAvgCardsFor: bocaProfile.avgCardsFor!,
    awayAvgCardsFor: palmeirasProfle.avgCardsFor!,
    homeAvgPPDA: bocaProfile.avgPPDA,
    awayAvgPPDA: palmeirasProfle.avgPPDA,
    refereeStrictness: 1.25,
    leagueId: 13,
    roundLabel: "Quarter-Finals",
    homeCountry: "Argentina",
    awayCountry: "Brazil",
  });

  console.log(`  xCard: home=${xCard.xCardHome.toFixed(3)} away=${xCard.xCardAway.toFixed(3)} total=${xCard.xCardTotal.toFixed(3)}`);
  console.log(`  P(cards_btts):     ${probs.cards_btts.toFixed(4)}`);
  console.log(`  P(cards_over_3_5): ${probs.cards_over_3_5.toFixed(4)}`);
  console.log(`  P(cards_over_4_5): ${probs.cards_over_4_5.toFixed(4)}`);

  assert(probs.cards_btts >= 0.55, `P(cards_btts) >= 0.55 (got ${probs.cards_btts.toFixed(4)})`);
  assert(probs.cards_over_3_5 >= 0.60, `P(cards_over_3_5) >= 0.60 (got ${probs.cards_over_3_5.toFixed(4)})`);
  assert(probs.cards_btts + probs.cards_over_3_5 > 0, "probabilities non-zero");
}

// ─── 4. predictSecondaryMarkets returns cards_btts without TS errors ─────────

function step4_secondaryMarkets(): void {
  console.log("\n=== Step 4: predictSecondaryMarkets includes cards_btts ===");

  const result = predictSecondaryMarkets({
    homeProfile: bocaProfile,
    awayProfile: palmeirasProfle,
    refereeStrictness: 1.25,
    rivalryMultiplier: 1.35,
    fixture: {
      leagueId: 13,
      isDerby: true,
      roundLabel: "Quarter-Finals",
      homeCountry: "Argentina",
      awayCountry: "Brazil",
    },
  });

  console.log(`  cards_btts: ${result.cards_btts?.toFixed(4) ?? "missing"}`);
  console.log(`  cards_over_3_5: ${result.cards_over_3_5?.toFixed(4) ?? "missing"}`);
  console.log(`  cards_over_4_5: ${result.cards_over_4_5?.toFixed(4) ?? "missing"}`);

  assert(result.cards_btts != null, "cards_btts present in secondary markets output");
  assert(typeof result.cards_btts === "number", "cards_btts is a number");
  assert((result.cards_btts ?? 0) > 0 && (result.cards_btts ?? 0) < 1, "cards_btts in (0,1)");
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🔍 verify-cards-engine: Boca Juniors vs Palmeiras — Libertadores QF\n");

  await step1_refereeDb();
  step2_xCard();
  step3_probabilities();
  step4_secondaryMarkets();

  console.log("\n✅ All checks passed — cards engine OK");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("❌ Fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
