/**
 * Assert walk-forward weight snapshots at T ignore picks with kickoff > T.
 * Usage: npx tsx scripts/verify-walkforward-tuning.ts
 */
import {
  calibrateModelParametersAsOf,
  type HistoricalPickRow,
} from "../lib/auto-tuner";
import { buildWalkForwardWeights } from "../lib/backtest-replay";
import {
  applyBrierLearningToWeightsAsOf,
  type BrierPickRow,
} from "../lib/learning-engine";
import { loadModelWeights, type ModelWeights } from "../lib/model-weights";
import { predictMatchMarkets } from "../lib/poisson";
import type { Match } from "../lib/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function stableWeightsSlice(w: ModelWeights): string {
  return JSON.stringify({
    leagues: Object.fromEntries(
      Object.entries(w.leagues).map(([k, v]) => [
        k,
        {
          probabilityScale: v.probabilityScale,
          riskPenalty: v.riskPenalty,
          brierCalibrationFactor: v.brierCalibrationFactor,
          minOdds: v.minOdds,
        },
      ])
    ),
    markets: Object.fromEntries(
      Object.entries(w.markets).map(([k, v]) => [
        k,
        {
          weight: v.weight,
          disabled: v.disabled,
          brierCalibrationFactor: v.brierCalibrationFactor,
          minProbability: v.minProbability,
        },
      ])
    ),
    teams: Object.fromEntries(
      Object.entries(w.teams ?? {}).map(([k, v]) => [
        k,
        { brierCalibrationFactor: v.brierCalibrationFactor },
      ])
    ),
    global: {
      strictMinProbability: w.global.strictMinProbability,
      over15MinProbability: w.global.over15MinProbability,
    },
  });
}

const T = new Date("2026-03-15T12:00:00.000Z");

const brierPre: BrierPickRow[] = [
  {
    league: "Premier League",
    leagueId: "39",
    market: "home",
    modelProbability: 0.72,
    odds: 1.55,
    outcome: "WON",
    homeTeam: "Alpha FC",
    awayTeam: "Beta United",
    kickoff: new Date("2026-03-01T15:00:00.000Z"),
  },
  {
    league: "Premier League",
    leagueId: "39",
    market: "over_2_5",
    modelProbability: 0.61,
    odds: 1.8,
    outcome: "LOST",
    homeTeam: "Gamma City",
    awayTeam: "Delta Rovers",
    kickoff: new Date("2026-03-08T18:00:00.000Z"),
  },
  {
    league: "Premier League",
    leagueId: "39",
    market: "home",
    modelProbability: 0.68,
    odds: 1.6,
    outcome: "WON",
    homeTeam: "Alpha FC",
    awayTeam: "Epsilon Town",
    kickoff: new Date("2026-03-10T20:00:00.000Z"),
  },
  {
    league: "Premier League",
    leagueId: "39",
    market: "away",
    modelProbability: 0.55,
    odds: 2.1,
    outcome: "LOST",
    homeTeam: "Zeta Athletic",
    awayTeam: "Alpha FC",
    kickoff: new Date("2026-03-12T17:00:00.000Z"),
  },
  {
    league: "Premier League",
    leagueId: "39",
    market: "draw",
    modelProbability: 0.3,
    odds: 3.4,
    outcome: "WON",
    homeTeam: "Beta United",
    awayTeam: "Gamma City",
    kickoff: new Date("2026-03-14T12:00:00.000Z"),
  },
];

const brierFuture: BrierPickRow = {
  league: "Premier League",
  leagueId: "39",
  market: "home",
  modelProbability: 0.9,
  odds: 1.4,
  outcome: "WON",
  homeTeam: "Future XI",
  awayTeam: "Leak FC",
  kickoff: new Date("2026-03-20T18:00:00.000Z"),
};

const tunerPre: HistoricalPickRow[] = brierPre.map((r) => ({
  league: r.league,
  leagueId: r.leagueId,
  market: r.market,
  modelProbability: r.modelProbability,
  odds: r.odds,
  outcome: r.outcome,
  kickoff: r.kickoff,
}));

const tunerFuture: HistoricalPickRow = {
  league: "Premier League",
  leagueId: "39",
  market: "home",
  modelProbability: 0.95,
  odds: 1.35,
  outcome: "WON",
  kickoff: new Date("2026-03-22T15:00:00.000Z"),
};

const seed = loadModelWeights();

const brierBase = applyBrierLearningToWeightsAsOf(brierPre, T, seed);
const brierLeak = applyBrierLearningToWeightsAsOf(
  [...brierPre, brierFuture],
  T,
  seed
);
assert(
  stableWeightsSlice(brierBase.weights) ===
    stableWeightsSlice(brierLeak.weights),
  "Brier asOf weights must ignore kickoff >= T"
);
assert(
  brierBase.sampleSize === brierLeak.sampleSize,
  "Brier train sample size unchanged by future picks"
);

const tunerBase = calibrateModelParametersAsOf(tunerPre, T, brierBase.weights);
const tunerLeak = calibrateModelParametersAsOf(
  [...tunerPre, tunerFuture],
  T,
  brierBase.weights
);
assert(
  stableWeightsSlice(tunerBase.weights) ===
    stableWeightsSlice(tunerLeak.weights),
  "auto-tuner asOf weights must ignore kickoff >= T"
);

const walkBase = buildWalkForwardWeights(T, seed, brierPre, tunerPre);
const walkLeak = buildWalkForwardWeights(
  T,
  seed,
  [...brierPre, brierFuture],
  [...tunerPre, tunerFuture]
);
assert(
  stableWeightsSlice(walkBase) === stableWeightsSlice(walkLeak),
  "buildWalkForwardWeights(T) invariant under T+1 data"
);

const match: Match = {
  id: "wf-verify",
  league: "premier-league",
  leagueName: "Premier League",
  leagueId: "39",
  kickoff: T.toISOString(),
  home: {
    name: "Alpha FC",
    shortName: "ALP",
    form: ["W", "D", "W"],
    goalsScoredAvg: 1.5,
    goalsConcededAvg: 1.0,
    homeGoalsScoredAvg: 1.7,
    homeGoalsConcededAvg: 0.9,
  },
  away: {
    name: "Beta United",
    shortName: "BET",
    form: ["L", "D", "W"],
    goalsScoredAvg: 1.1,
    goalsConcededAvg: 1.3,
  },
  h2h: { homeWins: 2, draws: 1, awayWins: 2, avgGoals: 2.4 },
  odds: {
    home: 2.1,
    draw: 3.4,
    away: 3.5,
    over25: 1.9,
    under35: 1.4,
    doubleChance1X: 1.28,
    doubleChanceX2: 1.55,
    over05: 1.08,
    over15: 1.3,
    under45: 1.15,
    bttsYes: 1.75,
    bttsNo: 2.0,
    dnbHome: 1.55,
    dnbAway: 2.2,
    homeScores: 1.35,
    awayScores: 1.42,
  },
};

const predBase = predictMatchMarkets(match, {
  asOf: T,
  weights: walkBase,
});
const predLeak = predictMatchMarkets(match, {
  asOf: T,
  weights: walkLeak,
});
const homeBase = predBase.markets.find((m) => m.market === "home");
const homeLeak = predLeak.markets.find((m) => m.market === "home");
assert(homeBase != null && homeLeak != null, "home market present");
assert(
  Math.abs(homeBase!.modelProbability - homeLeak!.modelProbability) < 1e-12,
  "predictMatchMarkets with walk-forward weights unchanged by T+1 picks"
);

console.log("verify-walkforward-tuning: OK", {
  brierTrainN: brierBase.sampleSize,
  homeP: homeBase?.modelProbability,
  leaguesTouched: Object.keys(walkBase.leagues).length,
});
