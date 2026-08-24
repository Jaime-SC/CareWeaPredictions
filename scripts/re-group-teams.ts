/**
 * Remap TeamProfile.primaryLeagueId to domestic 1ª/2ª origin leagues.
 * Cup/UEFA/CONMEBOL ids (2, 3, 11, 13, 848, …) are replaced when a domestic
 * match history is available.
 *
 * Usage: npx tsx scripts/re-group-teams.ts
 */
import { isTeamProfileOriginLeagueId } from "../config/allowed-leagues";
import { prisma } from "../lib/db";
import {
  needsDomesticLeagueRemap,
  resolveDomesticLeagueByTeamId,
} from "../lib/team-league-resolve";
import {
  getLeagueCountry,
  getLeagueDisplayName,
} from "../lib/utils/league-labels";

async function main(): Promise<void> {
  const domestic = await resolveDomesticLeagueByTeamId();
  const profiles = await prisma.teamProfile.findMany({
    select: {
      id: true,
      teamId: true,
      teamName: true,
      primaryLeagueId: true,
      country: true,
    },
  });

  let updated = 0;
  let remappedFromCup = 0;
  let stillOtros = 0;

  for (const p of profiles) {
    const next =
      p.primaryLeagueId != null &&
      isTeamProfileOriginLeagueId(p.primaryLeagueId)
        ? p.primaryLeagueId
        : (domestic.get(p.teamId) ?? null);

    if (next == null) {
      stillOtros += 1;
      console.log(
        `  OTROS ${p.teamName} (teamId=${p.teamId}) primary=${p.primaryLeagueId ?? "null"}`
      );
      if (p.primaryLeagueId != null && needsDomesticLeagueRemap(p.primaryLeagueId)) {
        await prisma.teamProfile.update({
          where: { id: p.id },
          data: { primaryLeagueId: null, country: null },
        });
        updated += 1;
      }
      continue;
    }

    const country = getLeagueCountry(next);
    const label = getLeagueDisplayName(next);
    const changed =
      p.primaryLeagueId !== next || (p.country ?? null) !== (country ?? null);

    if (
      needsDomesticLeagueRemap(p.primaryLeagueId) &&
      isTeamProfileOriginLeagueId(next)
    ) {
      remappedFromCup += 1;
      console.log(
        `  REMAP ${p.teamName}: ${p.primaryLeagueId ?? "null"} → ${next} (${label})`
      );
    }

    if (changed) {
      await prisma.teamProfile.update({
        where: { id: p.id },
        data: { primaryLeagueId: next, country },
      });
      updated += 1;
    }
  }

  console.log(
    `[re-group-teams] profiles=${profiles.length} updated=${updated} remappedFromCup=${remappedFromCup} stillOtros=${stillOtros}`
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
