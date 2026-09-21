/**
 * Prediction scope (default preset / expansion / country filters).
 * Usage: npx tsx scripts/verify-prediction-scope.ts
 */
import {
  DEFAULT_PREDICTION_LEAGUE_IDS,
  EXPANSION_LEAGUE_IDS,
  resolvePredictionLeagueIds,
} from "../config/allowed-leagues";
import { filterMatchesByPredictionScope } from "../lib/parlay-generator";
import type { Match } from "../lib/types";

function stub(leagueId: number): Match {
  return {
    id: `live-${leagueId}`,
    league: "x",
    leagueName: "x",
    leagueId: String(leagueId),
    kickoff: new Date().toISOString(),
    home: {
      name: "H",
      shortName: "H",
      form: [],
      goalsScoredAvg: 1,
      goalsConcededAvg: 1,
    },
    away: {
      name: "A",
      shortName: "A",
      form: [],
      goalsScoredAvg: 1,
      goalsConcededAvg: 1,
    },
    h2h: { homeWins: 1, draws: 0, awayWins: 0, avgGoals: 2 },
    odds: {
      home: 1.5,
      draw: 3.5,
      away: 6,
      doubleChance1X: 1.2,
      doubleChanceX2: 2.2,
      over05: 1.1,
      over15: 1.3,
      over25: 1.8,
      under35: 1.4,
      under45: 1.15,
      homeScores: 1.2,
      awayScores: 1.6,
      dnbHome: 1.25,
      dnbAway: 3.5,
    },
  };
}

const pool = [
  stub(39), // PL default
  stub(2), // UCL default
  stub(265), // Chile expansion
  stub(61), // France expansion
  stub(13), // Libertadores default
];

const defaultIds = resolvePredictionLeagueIds();
const expanded = resolvePredictionLeagueIds({ expandLeagues: true });
const onlyChile = resolvePredictionLeagueIds({
  selectedCountries: ["Chile"],
});
const onlyUefa = resolvePredictionLeagueIds({
  selectedCountries: ["UEFA"],
});
const onlyFrance = filterMatchesByPredictionScope(pool, {
  selectedCountries: ["France"],
});

const checks = {
  defaultHasPl: defaultIds.includes(39),
  defaultHasUcl: defaultIds.includes(2),
  defaultHasEuropa: defaultIds.includes(3),
  defaultHasConference: defaultIds.includes(848),
  defaultHasBundesliga: defaultIds.includes(78),
  defaultHasLigue1: defaultIds.includes(61),
  defaultHasDfbPokal: defaultIds.includes(81),
  defaultHasCoupeDeFrance: defaultIds.includes(66),
  defaultHasLibertadores: defaultIds.includes(13),
  defaultNoChile: !defaultIds.includes(265),
  defaultNoArgentina: !defaultIds.includes(128),
  gerFraNotExpansion: ![61, 62, 66, 78, 79, 81].some((id) =>
    EXPANSION_LEAGUE_IDS.includes(id)
  ),
  uefaNotExpansion: ![2, 3, 848].some((id) => EXPANSION_LEAGUE_IDS.includes(id)),
  expansionHasChile: EXPANSION_LEAGUE_IDS.includes(265),
  expandedHasChile: expanded.includes(265),
  chileOnly: onlyChile.length === 3 && onlyChile.every((id) => [265, 266, 267].includes(id)),
  uefaOnly:
    onlyUefa.length === 3 && onlyUefa.every((id) => [2, 3, 848].includes(id)),
  franceFilter: onlyFrance.length === 1 && onlyFrance[0].leagueId === "61",
  defaultCount: DEFAULT_PREDICTION_LEAGUE_IDS.length === 24,
  expandPlusChile: resolvePredictionLeagueIds({
    expandLeagues: true,
    selectedLeagueIds: [265],
  }).includes(39) &&
    resolvePredictionLeagueIds({
      expandLeagues: true,
      selectedLeagueIds: [265],
    }).includes(265),
};

const failed = Object.entries(checks).filter(([, v]) => !v);
console.log(JSON.stringify({ ok: failed.length === 0, failed: failed.map(([k]) => k), checks }, null, 2));
if (failed.length > 0) process.exit(1);
