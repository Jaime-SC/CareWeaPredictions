/**
 * JugaBet labels: all 59 markets fully qualified (Category → Selection).
 */
import assert from "node:assert/strict";
import {
  evaluateMarket,
  factsFromFixture,
  type FixtureResult,
} from "../lib/result-checker";
import {
  ALL_PARLAY_MARKETS,
  PHASE2_MARKET_TYPES,
  poissonOverProb,
  poissonUnderProb,
  phase2MarketProbs,
} from "../lib/phase2-markets";
import { getJugaBetLabel } from "../lib/jugabet-labels";
import { jugaBetMarketLabel } from "../lib/poisson";
import type { MarketType, Match } from "../types";

assert(PHASE2_MARKET_TYPES.length >= 20, "phase2 market count");
assert(ALL_PARLAY_MARKETS.has("corners_over_8_5"), "corners in pool");
assert(ALL_PARLAY_MARKETS.has("cards_under_4_5"), "cards in pool");
assert(ALL_PARLAY_MARKETS.has("ht_home"), "ht in pool");

const over85 = poissonOverProb(9, 8.5);
assert(over85 > 0.3 && over85 < 0.9, `over 8.5 @λ9 = ${over85}`);
const under85 = poissonUnderProb(9, 8.5);
assert(Math.abs(over85 + under85 - 1) < 0.02, "over+under ≈ 1");

// --- Explicit JugaBet syntax audit (all pool markets) ---
for (const market of ALL_PARLAY_MARKETS) {
  const label = getJugaBetLabel(market, {
    homeTeam: "Colo Colo",
    awayTeam: "U. de Chile",
  });
  assert(label.includes("→"), `${market} missing →: ${label}`);
  assert(!/^(O|U)\d/.test(label), `${market} shorthand code: ${label}`);
  assert(label !== market, `${market} raw enum leaked`);
}

assert(
  getJugaBetLabel("corners_1h_over_4_5", { homeTeam: "A", awayTeam: "B" }) ===
    "Córners. Total. 1ª parte → Más de 4.5",
  "1h corners label"
);
assert(
  getJugaBetLabel("corners_home_over_3_5", {
    homeTeam: "Colo Colo",
    awayTeam: "U",
  }) === "Córners total Colo Colo → Más de 3.5",
  "team corners label"
);
assert(
  getJugaBetLabel("cards_under_4_5") ===
    "Tarjetas amarillas. Total → Menos de 4.5",
  "cards label"
);
assert(
  getJugaBetLabel("cards_away_under_1_5", {
    homeTeam: "H",
    awayTeam: "Visitante X",
  }) === "Tarjetas amarillas total Visitante X → Menos de 1.5",
  "team cards label"
);
assert(
  getJugaBetLabel("ht_over_0_5") === "Total de goles. 1ª parte → Más de 0.5",
  "ht ou label"
);
assert(
  getJugaBetLabel("ht_home", { homeTeam: "Colo", awayTeam: "U" }) ===
    "Resultado 1ª parte → Colo",
  "ht 1x2 label"
);
assert(
  getJugaBetLabel("over_1_5") === "Total de goles → Más de 1.5",
  "ft goals ou"
);
assert(
  getJugaBetLabel("home_over_1_5", { homeTeam: "Cardiff", awayTeam: "N" }) ===
    "Cardiff total → Más de 1.5 goles",
  "team total goals"
);
assert(
  jugaBetMarketLabel("btts_yes", "A", "B") === "Ambos equipos marcan → Sí",
  "btts alias"
);
assert(
  jugaBetMarketLabel("1x", "Cardiff", "Norwich") ===
    "Doble oportunidad → Gana o empata Cardiff",
  "dc 1x team label"
);
assert(
  jugaBetMarketLabel("x2", "Cardiff", "Norwich") ===
    "Doble oportunidad → Gana o empata Norwich",
  "dc x2 team label"
);

assert(evaluateMarket("corners_over_8_5", {
  homeGoals: 1,
  awayGoals: 0,
  cornersHome: 5,
  cornersAway: 5,
}) === "won", "corners over won");
assert(evaluateMarket("corners_1h_over_3_5", {
  homeGoals: 1,
  awayGoals: 0,
  corners1hTotal: null,
}) === "void", "1h corners void without data");
assert(evaluateMarket("ht_home", {
  homeGoals: 2,
  awayGoals: 1,
  htHomeGoals: 1,
  htAwayGoals: 0,
}) === "won", "ht home won");
assert(evaluateMarket("btts_yes", 1, 1) === "won", "compat overload btts");
assert(
  evaluateMarket("corners_over_9_5", {
    homeGoals: 0,
    awayGoals: 0,
  }) === "need_stats",
  "need_stats without corners"
);

const stubMatch = {
  home: { name: "H", shortName: "H", form: [], goalsScoredAvg: 1.2, goalsConcededAvg: 1 },
  away: { name: "A", shortName: "A", form: [], goalsScoredAvg: 1.0, goalsConcededAvg: 1.1 },
} as unknown as Match;
const p2 = phase2MarketProbs(stubMatch, { home: 1.4, away: 1.1 });
assert((p2.corners_over_8_5 ?? 0) > 0, "phase2 probs corners");

const fx: FixtureResult = {
  fixtureId: 1,
  statusShort: "FT",
  finished: true,
  homeGoals: 2,
  awayGoals: 1,
  htHomeGoals: 1,
  htAwayGoals: 0,
  cornersHome: 6,
  cornersAway: 4,
  yellowHome: 1,
  yellowAway: 2,
};
assert(factsFromFixture(fx).cornersHome === 6, "factsFromFixture");

console.log(
  JSON.stringify({
    ok: true,
    phase2Count: PHASE2_MARKET_TYPES.length,
    poolSize: ALL_PARLAY_MARKETS.size,
    labelsAudited: ALL_PARLAY_MARKETS.size,
    sample: getJugaBetLabel("corners_over_8_5" as MarketType),
    over85: Number(over85.toFixed(3)),
  })
);
