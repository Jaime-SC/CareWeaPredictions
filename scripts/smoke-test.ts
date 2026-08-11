/**
 * Live smoke: fetch real fixtures and run Poisson + auto-parlay.
 * Usage: npx tsx scripts/smoke-test.ts
 */
import { fetchUpcomingMatches } from "../lib/api-football";
import { DEFAULT_AUTO_PARLAY_CONFIG } from "../lib/parlay-defaults";
import { generateParlay } from "../lib/parlay-generator";
import { predictMatchMarkets } from "../lib/poisson";

async function main() {
  const { matches, source } = await fetchUpcomingMatches({ daysAhead: 3 });
  console.log(`source=${source} matches=${matches.length}`);

  for (const m of matches.slice(0, 8)) {
    const { markets } = predictMatchMarkets(m);
    const safe = markets
      .filter((x) => x.isSafePick)
      .sort((a, b) => b.odds - a.odds);
    if (safe[0]) {
      console.log(
        m.home.shortName,
        "vs",
        m.away.shortName,
        safe[0].market,
        "@",
        safe[0].odds,
        (safe[0].modelProbability * 100).toFixed(1) + "%"
      );
    }
  }

  const parlay = generateParlay(matches, DEFAULT_AUTO_PARLAY_CONFIG);
  console.log(
    `auto-parlay legs=${parlay.legs.length} odds=${parlay.totalOdds} hit=${parlay.hitTarget} payout=${parlay.potentialPayout}`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
