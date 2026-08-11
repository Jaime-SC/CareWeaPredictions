/**
 * One-shot connection + elite-filter smoke check.
 * Usage: npx tsx scripts/verify-api.ts
 */
import {
  fetchUpcomingMatches,
  FootballApiError,
  pingApiFootball,
} from "../lib/api-football";

async function main() {
  const ping = await pingApiFootball();
  console.log("ping:", JSON.stringify(ping, null, 2));

  if (!ping.ok) {
    process.exitCode = 1;
    return;
  }

  try {
    const { matches, source } = await fetchUpcomingMatches({
      daysAhead: 3,
    });
    console.log("source:", source);
    console.log("count:", matches.length);
    console.log(
      "sample:",
      matches.slice(0, 8).map((m) => ({
        id: m.id,
        league: m.leagueName,
        kickoff: m.kickoff,
        fixture: `${m.home.name} vs ${m.away.name}`,
      }))
    );
  } catch (error) {
    if (error instanceof FootballApiError) {
      console.error(`FootballApiError [${error.code}]:`, error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
