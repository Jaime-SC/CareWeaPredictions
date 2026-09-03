/**
 * Assert settle is decoupled from calibration; snapshot cutoff ignores T+1.
 * Usage: npx tsx scripts/verify-cron-decouple.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyBrierLearningToWeightsAsOf,
  maybeUpdateBrierLearning,
  type BrierPickRow,
} from "../lib/learning-engine";
import { maybeRecalibrateAfterSettlement } from "../lib/auto-tuner";
import { loadModelWeights } from "../lib/model-weights";
import {
  aggregateTeamEvents,
  buildTeamEventsFromFixtures,
  type MatchFixtureRowForProfile,
} from "../lib/team-profiler";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function source(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

const settleCron = source("app/api/cron/settle/route.ts");
const settleApi = source("app/api/settle/route.ts");
const predict = source("app/api/predict/route.ts");
const parlay = source("app/api/parlay/route.ts");
const profiler = source("lib/team-profiler.ts");
const vercel = source("vercel.json");

assert(
  !settleCron.includes("saveModelWeights"),
  "cron/settle must not persist model weights"
);
assert(
  !settleCron.includes("maybeRecalibrateAfterSettlement"),
  "cron/settle must not call auto-tuner"
);
assert(
  !settleCron.includes("runOperationalCalibration"),
  "cron/settle must not run operational calibration"
);
assert(
  settleCron.includes('deferredTo: "/api/cron/calibrate"'),
  "cron/settle should defer calibration"
);
assert(
  !settleApi.includes("saveModelWeights") &&
    !settleApi.includes("maybeUpdateBrierLearning") &&
    !settleApi.includes("maybeRecalibrateAfterSettlement"),
  "POST /api/settle must not calibrate weights"
);
assert(
  vercel.includes("/api/cron/calibrate") &&
    vercel.includes("/api/cron/profile-snapshots"),
  "vercel.json must schedule calibrate + profile-snapshots"
);

const warmFn = profiler.slice(
  profiler.indexOf("export async function warmTeamProfilesForMatches"),
  profiler.indexOf("function snapshotRowToProfile")
);
assert(
  !warmFn.includes("getTeamProfileAt("),
  "warmTeamProfilesForMatches must not call getTeamProfileAt"
);
assert(
  predict.includes("warmTeamProfilesForMatches") &&
    parlay.includes("warmTeamProfilesForMatches"),
  "predict/parlay still warm asOf cache"
);

async function main(): Promise<void> {
  const T = new Date("2026-03-15T12:00:00.000Z");
  const TEAM_ID = 9001;
  const byName = new Map<string, number>([["alpha fc", TEAM_ID]]);

  const pre: MatchFixtureRowForProfile[] = [
    {
      apiFixtureId: 1,
      homeTeam: "Alpha FC",
      awayTeam: "Beta United",
      matchDate: new Date("2026-03-10T18:00:00.000Z"),
      finalScore: "2 - 0",
      status: "FT",
      leagueId: 39,
    },
  ];
  const future: MatchFixtureRowForProfile = {
    apiFixtureId: 99,
    homeTeam: "Alpha FC",
    awayTeam: "Future XI",
    matchDate: new Date("2026-03-20T18:00:00.000Z"),
    finalScore: "5 - 0",
    status: "FT",
    leagueId: 39,
  };

  const base = buildTeamEventsFromFixtures(pre, {
    asOf: T,
    byName,
    byFixture: new Map(),
  });
  const leak = buildTeamEventsFromFixtures([future, ...pre], {
    asOf: T,
    byName,
    byFixture: new Map(),
  });
  const aggBase = aggregateTeamEvents(base.eventsByTeam.get(TEAM_ID) ?? []);
  const aggLeak = aggregateTeamEvents(leak.eventsByTeam.get(TEAM_ID) ?? []);
  assert(
    JSON.stringify(aggBase) === JSON.stringify(aggLeak),
    "matchday snapshot events must ignore matchDate >= asOf"
  );

  const brierRows: BrierPickRow[] = [
    {
      league: "PL",
      market: "home",
      modelProbability: 0.7,
      odds: 1.5,
      outcome: "WON",
      homeTeam: "A",
      awayTeam: "B",
      kickoff: new Date("2026-03-01T12:00:00.000Z"),
    },
    {
      league: "PL",
      market: "home",
      modelProbability: 0.9,
      odds: 1.4,
      outcome: "LOST",
      homeTeam: "C",
      awayTeam: "D",
      kickoff: new Date("2026-03-20T12:00:00.000Z"),
    },
  ];
  const seed = loadModelWeights();
  const w1 = applyBrierLearningToWeightsAsOf(brierRows, T, seed);
  assert(w1.sampleSize === 1, "Brier operational window excludes kickoff >= T");

  const noopTuner = await maybeRecalibrateAfterSettlement(99);
  const noopBrier = await maybeUpdateBrierLearning(99);
  assert(noopTuner == null && noopBrier == null, "legacy settle hooks are no-ops");

  console.log("verify-cron-decouple: OK", {
    brierTrainN: w1.sampleSize,
    snapshotMatches: aggBase.totalMatchesAnalyzed,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
