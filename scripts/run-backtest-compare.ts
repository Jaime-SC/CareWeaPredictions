/**
 * CLI: compare legacy (leaky season Poisson) vs walk-forward replay.
 * Usage:
 *   npx tsx scripts/run-backtest-compare.ts --competition=PL --season=2024 --threshold=3
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(file: string): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main(): Promise<void> {
  const { loadHistoricalDataFromDb } = await import("../lib/auto-tuner");
  const { runReplayBacktest } = await import("../lib/backtest-replay");
  const { loadSettledPicksForBrier } = await import("../lib/learning-engine");
  const { hydrateModelWeightsFromDb } = await import("../lib/model-weights");
  const {
    fetchHistoricalMatches,
    parseBacktestMarket,
    runPaperBacktest,
  } = await import("../lib/sources/football-data");
  type BacktestSummary = Awaited<
    ReturnType<typeof runPaperBacktest>
  >;

  await hydrateModelWeightsFromDb().catch(() => undefined);

  const competition = arg("competition", "PL");
  const season = Number(arg("season", String(new Date().getFullYear() - 1)));
  const threshold = Number(arg("threshold", "3"));
  const minOdds = Number(arg("minOdds", "1.4"));
  const maxOdds = Number(arg("maxOdds", "1.85"));
  const market = parseBacktestMarket(arg("market", "ALL"));

  console.log(
    `[compare] FOOTBALL_DATA_API_KEY=${process.env.FOOTBALL_DATA_API_KEY ? "YES" : "NO"}`
  );
  console.log(
    `Fetching ${competition} ${season} (threshold=${threshold}, odds ${minOdds}-${maxOdds}, market=${market})…`
  );
  const matches = await fetchHistoricalMatches(competition, season);
  if (matches.length === 0) {
    console.error(
      "No matches. Set FOOTBALL_DATA_API_KEY in .env.local or check competition/season."
    );
    process.exit(1);
  }

  const opts = { threshold, minOdds, maxOdds, market };
  const [brierRows, tunerRows] = await Promise.all([
    loadSettledPicksForBrier().catch(() => []),
    loadHistoricalDataFromDb().catch(() => []),
  ]);
  console.log(
    `Loaded ${matches.length} matches, ${brierRows.length} brier rows, ${tunerRows.length} tuner rows`
  );

  const legacy = runPaperBacktest(matches, opts);
  console.log("Legacy done. Running replay walk-forward…");
  const replay = await runReplayBacktest(matches, {
    ...opts,
    competition,
    brierRows,
    tunerRows,
  });

  function line(
    label: string,
    a: string | number,
    b: string | number
  ): void {
    console.log(
      `${label.padEnd(14)} ${String(a).padStart(12)} ${String(b).padStart(12)}`
    );
  }

  function topMarkets(summary: BacktestSummary, n = 5): void {
    const rows = Object.entries(summary.byMarket)
      .sort((x, y) => y[1].nBets - x[1].nBets)
      .slice(0, n);
    for (const [m, bucket] of rows) {
      console.log(
        `  ${m.padEnd(14)} n=${bucket.nBets} wr=${bucket.winRate ?? "-"}% roi=${bucket.roi ?? "-"}%` +
          ` bs=${bucket.meanBrier ?? "-"} ll=${bucket.meanLogLoss ?? "-"}`
      );
    }
  }

  console.log("\n=== Backtest compare ===");
  console.log(
    `${"".padEnd(14)} ${"legacy".padStart(12)} ${"replay".padStart(12)}`
  );
  line("nMatches", legacy.nMatches, replay.nMatches);
  line("nBets", legacy.nBets, replay.nBets);
  line("winRate%", legacy.winRate, replay.winRate);
  line("ROI%", legacy.roi, replay.roi);
  line("meanBrier", legacy.meanBrier ?? "-", replay.meanBrier ?? "-");
  line("meanLogLoss", legacy.meanLogLoss ?? "-", replay.meanLogLoss ?? "-");
  line("unmapped", "-", replay.unmappedTeams);

  console.log("\nTop markets (legacy):");
  topMarkets(legacy);
  console.log("Top markets (replay):");
  topMarkets(replay);

  console.log("\nDelta (replay − legacy):", {
    roi: Number((replay.roi - legacy.roi).toFixed(2)),
    winRate: Number((replay.winRate - legacy.winRate).toFixed(2)),
    meanBrier:
      replay.meanBrier != null && legacy.meanBrier != null
        ? Number((replay.meanBrier - legacy.meanBrier).toFixed(4))
        : null,
    meanLogLoss:
      replay.meanLogLoss != null && legacy.meanLogLoss != null
        ? Number((replay.meanLogLoss - legacy.meanLogLoss).toFixed(4))
        : null,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
