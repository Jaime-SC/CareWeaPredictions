/**
 * Monopoly / asimetría engine checks.
 * Usage: npx tsx scripts/verify-monopoly-engine.ts
 */
import { STRATEGY_PRESETS } from "../lib/parlay-defaults";
import {
  INSUFFICIENT_MATCHES_MESSAGE,
  isSafeMonopolyFixture,
  resolveMonopolyMarket,
  buildMonopolyParlay,
  getWeeklyDateRange,
  type MonopolyFixture,
} from "../lib/monopoly-engine";
import { generateParlay } from "../lib/parlay-generator";
import type { Match, MatchOdds } from "../lib/types";

const HILAL = 2931;
const PRO_LEAGUE = 307;
const UCL = 2;

function fx(
  id: number,
  leagueId: number,
  leagueName: string,
  homeId: number,
  awayId: number,
  date: string
): MonopolyFixture {
  return {
    id,
    date,
    league: { id: leagueId, name: leagueName },
    teams: {
      home: { id: homeId, name: homeId === HILAL ? "Al Hilal" : `T${homeId}` },
      away: { id: awayId, name: awayId === HILAL ? "Al Hilal" : `T${awayId}` },
    },
  };
}

const domestic = fx(
  10,
  PRO_LEAGUE,
  "Pro League",
  HILAL,
  99,
  "2026-08-14T12:00:00.000Z"
);
const ucl = fx(
  11,
  UCL,
  "UEFA Champions League",
  HILAL,
  50,
  "2026-08-16T18:00:00.000Z"
);
const cup = fx(
  12,
  350,
  "FA Cup",
  HILAL,
  88,
  "2026-08-14T12:00:00.000Z"
);

function board(partial?: Partial<MatchOdds>): MatchOdds {
  return {
    home: 1.18,
    draw: 6.5,
    away: 11,
    doubleChance1X: 1.08,
    doubleChanceX2: 3.9,
    over05: 1.05,
    over15: 1.22,
    over25: 1.7,
    under35: 1.4,
    under45: 1.12,
    homeScores: 1.12,
    awayScores: 1.55,
    homeOver15: 1.35,
    awayOver15: 2.1,
    dnbHome: 1.12,
    dnbAway: 1.25,
    ...partial,
  };
}

function monopolyMatch(opts: {
  id: number;
  homeId: number;
  awayId: number;
  isHomeMonopoly: boolean;
  leagueId?: number;
  leagueName?: string;
  nearby?: MonopolyFixture[];
}): Match {
  const homeDom = opts.isHomeMonopoly;
  return {
    id: `live-${opts.id}`,
    league: "other-domestic",
    leagueName: opts.leagueName ?? "Pro League",
    leagueId: String(opts.leagueId ?? PRO_LEAGUE),
    kickoff: "2026-08-14T12:00:00.000Z",
    nearbyTeamFixtures: opts.nearby ?? [domestic],
    home: {
      id: opts.homeId,
      name: homeDom ? "Al Hilal" : "Rival",
      shortName: homeDom ? "HIL" : "RIV",
      form: ["W", "W", "W", "W", "W"],
      goalsScoredAvg: homeDom ? 3.4 : 0.45,
      goalsConcededAvg: homeDom ? 0.35 : 2.6,
      homeGoalsScoredAvg: homeDom ? 3.6 : 0.5,
      homeGoalsConcededAvg: homeDom ? 0.3 : 2.4,
    },
    away: {
      id: opts.awayId,
      name: homeDom ? "Rival" : "Al Ahly",
      shortName: homeDom ? "RIV" : "AHL",
      form: homeDom ? ["L", "L", "D", "L", "L"] : ["W", "W", "W", "W", "D"],
      goalsScoredAvg: homeDom ? 0.45 : 2.9,
      goalsConcededAvg: homeDom ? 2.6 : 0.5,
      awayGoalsScoredAvg: homeDom ? 0.4 : 2.7,
      awayGoalsConcededAvg: homeDom ? 2.8 : 0.55,
    },
    h2h: { homeWins: 8, draws: 1, awayWins: 0, avgGoals: 3.4 },
    odds: board(
      homeDom
        ? { home: 1.2, dnbAway: 3.8, doubleChanceX2: 4.2 }
        : {
            home: 4.8,
            away: 1.55,
            doubleChanceX2: 1.18,
            dnbAway: 1.22,
            dnbHome: 3.4,
          }
    ),
  };
}

const safeDomestic = isSafeMonopolyFixture(domestic, [domestic]);
const cupRejected = isSafeMonopolyFixture(cup, [cup]);
const rotationRejected = isSafeMonopolyFixture(domestic, [domestic, ucl]);
const rotationBypassed = isSafeMonopolyFixture(domestic, [domestic, ucl], {
  ignoreRotationFilter: true,
});

const homeMatch = monopolyMatch({
  id: 10,
  homeId: HILAL,
  awayId: 99,
  isHomeMonopoly: true,
  nearby: [domestic],
});
const awayMatch = monopolyMatch({
  id: 20,
  homeId: 77,
  awayId: 1029,
  isHomeMonopoly: false,
  leagueId: 233,
  leagueName: "Premier League",
  nearby: [
    fx(20, 233, "Premier League", 77, 1029, "2026-08-14T12:00:00.000Z"),
  ],
});

const homePick = resolveMonopolyMarket(homeMatch, true);
const awayPick = resolveMonopolyMarket(awayMatch, false);

const three = [
  monopolyMatch({
    id: 31,
    homeId: HILAL,
    awayId: 91,
    isHomeMonopoly: true,
    nearby: [fx(31, PRO_LEAGUE, "Pro League", HILAL, 91, "2026-08-14T12:00:00.000Z")],
  }),
  monopolyMatch({
    id: 32,
    homeId: 562,
    awayId: 92,
    isHomeMonopoly: true,
    leagueId: 172,
    leagueName: "First League",
    nearby: [fx(32, 172, "First League", 562, 92, "2026-08-14T15:00:00.000Z")],
  }),
  monopolyMatch({
    id: 33,
    homeId: 643,
    awayId: 93,
    isHomeMonopoly: true,
    leagueId: 361,
    leagueName: "Premyer Liqa",
    nearby: [fx(33, 361, "Premyer Liqa", 643, 93, "2026-08-14T17:00:00.000Z")],
  }),
];
three[1].kickoff = "2026-08-14T15:00:00.000Z";
three[1].home.name = "Ludogorets";
three[2].kickoff = "2026-08-14T17:00:00.000Z";
three[2].home.name = "Qarabağ";

const dynamic = buildMonopolyParlay(three, { stake: 1.5 });
const short = buildMonopolyParlay(three.slice(0, 1), { stake: 1.5 });

function mockFunMatch(id: number): Match {
  const bump = (id % 5) * 0.015;
  return {
    id: `live-${id}`,
    league: "premier-league",
    leagueName: "Premier League",
    kickoff: new Date().toISOString(),
    home: {
      name: `Home${id}`,
      shortName: `H${id}`,
      form: ["W", "W", "D", "W", "W"],
      goalsScoredAvg: 1.8,
      goalsConcededAvg: 0.7,
      homeGoalsScoredAvg: 1.9,
      homeGoalsConcededAvg: 0.65,
    },
    away: {
      name: `Away${id}`,
      shortName: `A${id}`,
      form: ["L", "D", "L", "W", "L"],
      goalsScoredAvg: 0.9,
      goalsConcededAvg: 1.6,
      awayGoalsScoredAvg: 0.85,
      awayGoalsConcededAvg: 1.7,
    },
    h2h: { homeWins: 3, draws: 1, awayWins: 1, avgGoals: 2.4 },
    odds: board({
      doubleChance1X: Number((1.2 + bump).toFixed(2)),
      over15: Number((1.2 + bump).toFixed(2)),
      under35: Number((1.22 + bump).toFixed(2)),
      homeScores: Number((1.19 + bump).toFixed(2)),
      dnbHome: Number((1.21 + bump).toFixed(2)),
    }),
  };
}

const rotationMatch = monopolyMatch({
  id: 10,
  homeId: HILAL,
  awayId: 99,
  isHomeMonopoly: true,
  nearby: [domestic, ucl],
});
const rotationPool = [rotationMatch, three[1], three[2]];
const rotationFiltered = buildMonopolyParlay(rotationPool, { stake: 1.5 });
const rotationIgnored = buildMonopolyParlay(rotationPool, {
  stake: 1.5,
  ignoreRotationFilter: true,
});
const viaGenerator = generateParlay(rotationPool, {
  ...STRATEGY_PRESETS["monopoly-asymmetry"],
  ignoreRotationFilter: true,
});

const funParlay = generateParlay(
  Array.from({ length: 20 }, (_, i) => mockFunMatch(i + 1)),
  STRATEGY_PRESETS["daily-fun"]
);

const week = getWeeklyDateRange(new Date("2026-08-14T16:00:00.000Z"));
const weekStart = new Date(week.from);
const weekEnd = new Date(week.to);

const checks = {
  domesticSafe: safeDomestic.isSafe === true,
  cupRejected: cupRejected.reason === "NOT_DOMESTIC_LEAGUE",
  rotationRejected: rotationRejected.reason === "ROTATION_RISK",
  rotationBypassSafe: rotationBypassed.isSafe === true,
  rotationBypassWarning:
    rotationBypassed.warning === "NEARBY_INTERNATIONAL_MATCH_PRESENT",
  rotationFilteredDropsHilal: !rotationFiltered.legs.some((l) =>
    l.matchLabel.includes("Al Hilal")
  ),
  rotationIgnoredKeepsHilal: rotationIgnored.legs.some(
    (l) =>
      l.matchLabel.includes("Al Hilal") &&
      l.warning === "NEARBY_INTERNATIONAL_MATCH_PRESENT"
  ),
  generatorPassThrough: viaGenerator.legs.some(
    (l) => l.warning === "NEARBY_INTERNATIONAL_MATCH_PRESENT"
  ),
  homeMarket:
    homePick?.market === "home" || homePick?.market === "home_over_1_5",
  homeFloor: (homePick?.modelProbability ?? 0) >= 0.82,
  awayMarket: awayPick?.market === "dnb_away" || awayPick?.market === "x2",
  awayFloor: (awayPick?.modelProbability ?? 0) >= 0.82,
  dynamicLegs: dynamic.legs.length === 3,
  noTruncate: dynamic.status === "OK",
  insufficient: short.status === "INSUFFICIENT_MATCHES",
  insufficientText: short.fillNotice === INSUFFICIENT_MATCHES_MESSAGE,
  funStill15: funParlay.legs.length === 15,
  weekMonday: week.fromYmd === "2026-08-10",
  weekSunday: week.toYmd === "2026-08-16",
  weekSevenDays: week.dates.length === 7,
  weekIsoOrder: weekStart.getTime() < weekEnd.getTime(),
};

const failed = Object.entries(checks).filter(([, v]) => !v);
console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      failed: failed.map(([k]) => k),
      checks,
      homePick: homePick && {
        market: homePick.market,
        p: Number(homePick.modelProbability.toFixed(3)),
      },
      awayPick: awayPick && {
        market: awayPick.market,
        p: Number(awayPick.modelProbability.toFixed(3)),
      },
      dynamicLegs: dynamic.legs.map((l) => l.matchLabel),
    },
    null,
    2
  )
);

if (failed.length > 0) process.exit(1);
