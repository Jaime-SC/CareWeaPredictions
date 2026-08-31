import { INSUFFICIENT_MATCHES_MESSAGE } from "../config/builder-modes";
import {
  getMonopolyTeam,
  getMonopolyTeamIds,
  getMonopolyTeams,
  type MonopolyTeam,
} from "./monopoly-teams";
import {
  calculateEdge,
  estimateExpectedGoals,
  hasBookmakerOdds,
  impliedProbability,
  jugaBetMarketLabel,
  matchOutcomeProbabilities,
  buildScoreMatrix,
  teamOverProbability,
} from "./poisson";
import type {
  GeneratedParlay,
  MarketPrediction,
  MarketType,
  Match,
  NearbyTeamFixture,
  ParlayConfig,
  ParlayLeg,
  ParlayStatus,
} from "./types";
import { notesForFlags } from "./context-engine";
import {
  applyKnockoutMarketAdjustments,
  evaluateKnockoutContext,
  knockoutMarketLabel,
  toKnockoutContext,
} from "./knockout-engine";
import { failsMarketSanity } from "./filters";
import { isValueBet, valueMarginPercent } from "./value-finder";
import { chileDateOffset, chileDateString, getWeeklyDateRange } from "./utils";
export type { WeeklyDateRange } from "./utils";
export { getWeeklyDateRange };

export const MONOPOLY_MIN_PROBABILITY = 0.82;
export const MONOPOLY_MIN_LEGS = 2;
export const MONOPOLY_WINDOW_DAYS = 4;

export { INSUFFICIENT_MATCHES_MESSAGE };

export type { MonopolyTeam } from "./monopoly-teams";
export { getMonopolyTeam, getMonopolyTeamIds, getMonopolyTeams };

export type MonopolyFixture = NearbyTeamFixture;

export type MonopolyRejectReason =
  | "NOT_MONOPOLY_TEAM"
  | "NOT_DOMESTIC_LEAGUE"
  | "ROTATION_RISK"
  | "BELOW_PROBABILITY_FLOOR";

export const NEARBY_INTERNATIONAL_MATCH_PRESENT =
  "NEARBY_INTERNATIONAL_MATCH_PRESENT" as const;

export type MonopolyRotationWarning = typeof NEARBY_INTERNATIONAL_MATCH_PRESENT;

export interface MonopolyOptions {
  ignoreRotationFilter?: boolean;
  poissonProbability?: number;
}

export type MonopolySafetyResult = {
  isSafe: boolean;
  reason?: MonopolyRejectReason;
  team: MonopolyTeam | null;
  isHomeTeam: boolean;
  warning?: MonopolyRotationWarning;
};

/**
 * Continental / international club (and national-team) competitions.
 * Any of these in the ±4 day window triggers ROTATION_RISK.
 */
const CONTINENTAL_LEAGUE_IDS = new Set<number>([
  // UEFA
  2, 3, 848, 531, 1140,
  // FIFA / confed nation & club
  1, 4, 5, 6, 7, 9, 10, 15, 19, 22, 29, 30, 31, 32, 33, 34, 37,
  // AFC
  17, 18, 1149, 1181,
  // CAF
  12, 20,
  // CONMEBOL
  11, 13, 165,
  // CONCACAF
  16, 767, 779,
]);

const CONTINENTAL_NAME_RE =
  /champions\s*league|europa\s*league|conference\s*league|afc\s*champion|caf\s*champion|libertadores|sudamericana|club\s*world\s*cup|nations\s*league|world\s*cup|copa\s*am[eé]rica|africa(?:n)?\s*(?:cup|nations)|asian\s*cup|concacaf|uefa\s*super\s*cup|recopa|confederation\s*cup|leagues\s*cup|arab\s*club|intercontinental/i;

export function getMonopolyLeagueIds(): Set<number> {
  return new Set(getMonopolyTeams().map((t) => t.leagueId));
}

export function findMonopolySide(fixture: MonopolyFixture): {
  team: MonopolyTeam;
  isHomeTeam: boolean;
} | null {
  const home = getMonopolyTeam(fixture.teams.home.id);
  if (home) return { team: home, isHomeTeam: true };
  const away = getMonopolyTeam(fixture.teams.away.id);
  if (away) return { team: away, isHomeTeam: false };
  return null;
}

export function isContinentalOrInternational(
  leagueId: number,
  leagueName: string
): boolean {
  if (CONTINENTAL_LEAGUE_IDS.has(leagueId)) return true;
  return CONTINENTAL_NAME_RE.test(leagueName ?? "");
}

function chileYmdFromIso(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return String(iso).slice(0, 10);
  return chileDateString(new Date(ms));
}

function fixtureInWindow(
  fixtureYmd: string,
  centerYmd: string,
  days = MONOPOLY_WINDOW_DAYS
): boolean {
  const from = chileDateOffset(-days, centerYmd);
  const to = chileDateOffset(days, centerYmd);
  return fixtureYmd >= from && fixtureYmd <= to;
}

function toMonopolyFixture(match: Match): MonopolyFixture {
  const idRaw = match.id.match(/^live-(\d+)$/i);
  return {
    id: idRaw ? Number(idRaw[1]) : 0,
    date: match.kickoff,
    league: {
      id: Number(match.leagueId ?? 0),
      name: match.leagueName,
    },
    teams: {
      home: { id: match.home.id ?? 0, name: match.home.name },
      away: { id: match.away.id ?? 0, name: match.away.name },
    },
  };
}

function hasNearbyContinentalFixture(
  fixture: MonopolyFixture,
  teamFixturesWindow: MonopolyFixture[],
  teamId: number
): boolean {
  const centerYmd = chileYmdFromIso(fixture.date);

  for (const other of teamFixturesWindow) {
    if (other.id === fixture.id) continue;
    const otherYmd = chileYmdFromIso(other.date);
    if (!fixtureInWindow(otherYmd, centerYmd)) continue;

    const involvesTeam =
      other.teams.home.id === teamId || other.teams.away.id === teamId;
    if (!involvesTeam) continue;

    if (isContinentalOrInternational(other.league.id, other.league.name)) {
      return true;
    }
  }

  return false;
}

/**
 * Domestic-only + anti-rotation gate.
 * Probability floor is applied when `options.poissonProbability` is provided.
 * When `options.ignoreRotationFilter` is true, nearby continental fixtures
 * do not reject the match (ROTATION_RISK is bypassed) and a warning is set.
 */
export function isSafeMonopolyFixture(
  fixture: MonopolyFixture,
  teamFixturesWindow: MonopolyFixture[],
  options?: MonopolyOptions
): MonopolySafetyResult {
  const side = findMonopolySide(fixture);
  if (!side) {
    return {
      isSafe: false,
      reason: "NOT_MONOPOLY_TEAM",
      team: null,
      isHomeTeam: false,
    };
  }

  const fixtureLeagueId = Number(fixture.league.id);
  if (fixtureLeagueId !== side.team.leagueId) {
    console.log(
      `[MONOPOLY DROP] ${side.team.teamName}: League mismatch (${fixtureLeagueId} != ${side.team.leagueId})`
    );
    return {
      isSafe: false,
      reason: "NOT_DOMESTIC_LEAGUE",
      team: side.team,
      isHomeTeam: side.isHomeTeam,
    };
  }

  const nearbyContinental = hasNearbyContinentalFixture(
    fixture,
    teamFixturesWindow,
    side.team.teamId
  );

  if (nearbyContinental && options?.ignoreRotationFilter !== true) {
    console.log(
      `[MONOPOLY DROP] ${side.team.teamName}: ROTATION_RISK (Continental match within 4 days)`
    );
    return {
      isSafe: false,
      reason: "ROTATION_RISK",
      team: side.team,
      isHomeTeam: side.isHomeTeam,
    };
  }

  const poissonProbability = options?.poissonProbability;
  if (
    typeof poissonProbability === "number" &&
    poissonProbability < MONOPOLY_MIN_PROBABILITY
  ) {
    console.log(
      `[MONOPOLY DROP] ${side.team.teamName}: LOW_PROBABILITY (${(poissonProbability * 100).toFixed(1)}% < 82%)`
    );
    return {
      isSafe: false,
      reason: "BELOW_PROBABILITY_FLOOR",
      team: side.team,
      isHomeTeam: side.isHomeTeam,
    };
  }

  return {
    isSafe: true,
    team: side.team,
    isHomeTeam: side.isHomeTeam,
    warning:
      nearbyContinental && options?.ignoreRotationFilter === true
        ? NEARBY_INTERNATIONAL_MATCH_PRESENT
        : undefined,
  };
}

function oddsForResolvedMarket(
  match: Match,
  market: MarketType,
  probability: number
): number {
  const board = match.odds;
  const live = (() => {
    switch (market) {
      case "home":
        return board.home;
      case "away":
        return board.away;
      case "x2":
        return board.doubleChanceX2;
      case "dnb_away":
        return board.dnbAway;
      case "dnb_home":
        return board.dnbHome;
      case "home_over_1_5":
        return board.homeOver15 ?? 0;
      case "away_over_1_5":
        return board.awayOver15 ?? 0;
      default:
        return 0;
    }
  })();
  if (Number.isFinite(live) && live > 1) return live;

  // Derive DNB from 1X2 when the book omits the line (still real book prices).
  if (market === "dnb_away" && board.home > 1 && board.away > 1) {
    const pHome = 1 / board.home;
    const pAway = 1 / board.away;
    const denom = pHome + pAway;
    if (denom > 0) return Number((1 / (pAway / denom)).toFixed(3));
  }

  // Ban synthetic / fair-odds fallback — no explicit book line → reject.
  return 0;
}

function monopolyPoissonBoard(match: Match): {
  home: number;
  away: number;
  draw: number;
  x2: number;
  dnbAway: number;
  homeOver15: number;
  awayOver15: number;
} {
  const xg = estimateExpectedGoals(match);
  const matrix = buildScoreMatrix(xg.home, xg.away);
  const outcomes = matchOutcomeProbabilities(matrix);
  const decisive = outcomes.home + outcomes.away;
  const knockout = applyKnockoutMarketAdjustments(match, {
    home: outcomes.home,
    draw: outcomes.draw,
    away: outcomes.away,
    "1x": outcomes.home + outcomes.draw,
    x2: outcomes.away + outcomes.draw,
    over_0_5: 0,
    over_1_5: 0,
    over_2_5: 0,
    under_3_5: 0,
    under_4_5: 0,
    home_scores: 0,
    away_scores: 0,
    home_over_1_5: teamOverProbability(matrix, "home", 1.5),
    away_over_1_5: teamOverProbability(matrix, "away", 1.5),
    dnb_home: decisive > 0 ? outcomes.home / decisive : 0.5,
    dnb_away: decisive > 0 ? outcomes.away / decisive : 0.5,
  });
  return {
    home: knockout.home ?? outcomes.home,
    away: knockout.away ?? outcomes.away,
    draw: knockout.draw ?? outcomes.draw,
    x2: knockout.x2 ?? outcomes.away + outcomes.draw,
    dnbAway: knockout.dnb_away ?? (decisive > 0 ? outcomes.away / decisive : 0.5),
    homeOver15: knockout.home_over_1_5 ?? teamOverProbability(matrix, "home", 1.5),
    awayOver15: knockout.away_over_1_5 ?? teamOverProbability(matrix, "away", 1.5),
  };
}

function toPrediction(
  match: Match,
  market: MarketType,
  probability: number
): MarketPrediction {
  const odds = oddsForResolvedMarket(match, market, probability);
  const implied = impliedProbability(odds);
  const knockoutEval = evaluateKnockoutContext(match);
  const knockoutContext = toKnockoutContext(knockoutEval);
  const modelProbability = Math.min(0.99, Math.max(0, probability));
  const sanity = failsMarketSanity(match, market, modelProbability, odds);
  return {
    market,
    label: knockoutMarketLabel(
      jugaBetMarketLabel(market, match.home.name, match.away.name),
      knockoutEval
    ),
    odds,
    modelProbability,
    impliedProbability: implied,
    edge: calculateEdge(probability, odds),
    valueMarginPercent: Number(
      valueMarginPercent(modelProbability, odds).toFixed(2)
    ),
    isValueBet: isValueBet(modelProbability, odds),
    isSafePick:
      !sanity.fail &&
      probability >= MONOPOLY_MIN_PROBABILITY &&
      odds > 1,
    expectedGoals: estimateExpectedGoals(match),
    contextFlags: [...new Set([...knockoutEval.flags, ...sanity.flags])],
    knockoutContext,
  };
}

/**
 * Home: 1X2 (Home Win) or Team Total Over 1.5.
 * Away: Draw No Bet or Double Chance X2.
 * Picks the highest Poisson-base probability that clears 82%.
 */
export function resolveMonopolyMarket(
  fixture: MonopolyFixture | Match,
  isHomeTeam: boolean
): MarketPrediction | null {
  const match: Match | null =
    "odds" in fixture && "home" in fixture && "kickoff" in fixture
      ? (fixture as Match)
      : null;
  if (!match) return null;

  evaluateKnockoutContext(match);
  const board = monopolyPoissonBoard(match);
  const candidates: Array<{ market: MarketType; p: number }> = isHomeTeam
    ? [
        { market: "home", p: board.home },
        { market: "home_over_1_5", p: board.homeOver15 },
      ]
    : [
        { market: "dnb_away", p: board.dnbAway },
        { market: "x2", p: board.x2 },
      ];

  const teamName = isHomeTeam ? match.home.name : match.away.name;
  const eligible = candidates
    .filter((c) => c.p >= MONOPOLY_MIN_PROBABILITY)
    .sort((a, b) => b.p - a.p);

  if (eligible.length === 0) {
    const best = Math.max(0, ...candidates.map((c) => c.p));
    console.log(
      `[MONOPOLY DROP] ${teamName}: LOW_PROBABILITY (${(best * 100).toFixed(1)}% < 82%)`
    );
    return null;
  }

  let missingOdds = false;
  for (const c of eligible) {
    const pick = toPrediction(match, c.market, c.p);
    if (!(pick.odds > 1)) {
      missingOdds = true;
      continue;
    }
    if (pick.isSafePick) return pick;
  }
  if (missingOdds) {
    console.log(`[MONOPOLY DROP] ${teamName}: MISSING_BOOKMAKER_ODDS`);
  }
  return null;
}

function applyDominancePriors(match: Match, isHomeTeam: boolean): Match {
  const hasStats =
    match.home.goalsScoredAvg > 0 ||
    match.away.goalsScoredAvg > 0 ||
    (match.home.homeGoalsScoredAvg ?? 0) > 0 ||
    (match.away.awayGoalsScoredAvg ?? 0) > 0;
  if (hasStats || hasBookmakerOdds(match.odds)) return match;

  const monopolyLambda = 2.35;
  const opponentLambda = 0.7;
  const homeLambda = isHomeTeam ? monopolyLambda : opponentLambda;
  const awayLambda = isHomeTeam ? opponentLambda : monopolyLambda;

  return {
    ...match,
    home: {
      ...match.home,
      goalsScoredAvg: homeLambda,
      goalsConcededAvg: awayLambda,
      homeGoalsScoredAvg: homeLambda,
      homeGoalsConcededAvg: awayLambda,
    },
    away: {
      ...match.away,
      goalsScoredAvg: awayLambda,
      goalsConcededAvg: homeLambda,
      awayGoalsScoredAvg: awayLambda,
      awayGoalsConcededAvg: homeLambda,
    },
  };
}

function toLeg(
  match: Match,
  pick: MarketPrediction,
  warning?: MonopolyRotationWarning
): ParlayLeg {
  const knockoutEval = evaluateKnockoutContext(match);
  const knockoutContext = pick.knockoutContext ?? toKnockoutContext(knockoutEval);
  const flags = [...(pick.contextFlags ?? []), ...knockoutEval.flags];
  if (warning && !flags.includes(warning)) flags.push(warning);
  const uniqueFlags = [...new Set(flags)];
  const notes = notesForFlags(uniqueFlags);
  if (knockoutContext?.note && !notes.includes(knockoutContext.note)) {
    notes.push(knockoutContext.note);
  }
  return {
    matchId: match.id,
    matchLabel: `${match.home.name} vs ${match.away.name}`,
    leagueName: match.leagueName,
    kickoff: match.kickoff,
    market: pick.market,
    marketLabel: pick.label,
    odds: pick.odds,
    modelProbability: pick.modelProbability,
    edge: pick.edge,
    contextFlags: uniqueFlags,
    contextNotes: notes,
    referee: match.referee ?? null,
    venue: match.venue ?? null,
    warning,
    knockoutContext,
  };
}

export function collectMonopolyLegs(
  matches: Match[],
  options?: MonopolyOptions
): {
  legs: ParlayLeg[];
  rejected: Array<{ matchId: string; reason: MonopolyRejectReason }>;
} {
  const legs: ParlayLeg[] = [];
  const rejected: Array<{ matchId: string; reason: MonopolyRejectReason }> = [];
  const safetyOptions: MonopolyOptions = {
    ignoreRotationFilter: options?.ignoreRotationFilter === true,
  };

  for (const raw of matches) {
    const fixture = toMonopolyFixture(raw);
    const window = raw.nearbyTeamFixtures ?? [fixture];
    const structural = isSafeMonopolyFixture(fixture, window, safetyOptions);
    if (!structural.isSafe || !structural.team) {
      rejected.push({
        matchId: raw.id,
        reason: structural.reason ?? "NOT_MONOPOLY_TEAM",
      });
      continue;
    }

    const match = applyDominancePriors(raw, structural.isHomeTeam);
    const pick = resolveMonopolyMarket(match, structural.isHomeTeam);
    if (!pick) {
      rejected.push({ matchId: raw.id, reason: "BELOW_PROBABILITY_FLOOR" });
      continue;
    }

    const withProb = isSafeMonopolyFixture(fixture, window, {
      ...safetyOptions,
      poissonProbability: pick.modelProbability,
    });
    if (!withProb.isSafe) {
      rejected.push({
        matchId: raw.id,
        reason: withProb.reason ?? "BELOW_PROBABILITY_FLOOR",
      });
      continue;
    }

    legs.push(toLeg(match, pick, withProb.warning ?? structural.warning));
  }

  legs.sort(
    (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
  );
  return { legs, rejected };
}

function finalizeMonopoly(
  legs: ParlayLeg[],
  stake: number,
  status: ParlayStatus,
  fillNotice?: string,
  ignoreRotationFilter?: boolean
): GeneratedParlay {
  const totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);
  const jointProbability = legs.reduce(
    (acc, l) => acc * l.modelProbability,
    legs.length ? 1 : 0
  );
  const averageEdge =
    legs.length === 0 ? 0 : legs.reduce((s, l) => s + l.edge, 0) / legs.length;

  const insufficient = status === "INSUFFICIENT_MATCHES";

  return {
    legs,
    totalOdds: Number(totalOdds.toFixed(4)),
    stake,
    potentialPayout: Number((stake * totalOdds).toFixed(2)),
    jointProbability: Number(jointProbability.toFixed(6)),
    averageEdge: Number(averageEdge.toFixed(4)),
    hitTarget: legs.length >= MONOPOLY_MIN_LEGS,
    strategyMode: "monopoly-asymmetry",
    strategyLabel: "Modo Asimetría (Gigantes Exóticos)",
    riskTier: "monopoly",
    riskLevel: insufficient ? "extreme" : jointProbability >= 0.2 ? "low" : "medium",
    riskLabel: insufficient
      ? INSUFFICIENT_MATCHES_MESSAGE
      : "Asimetría / monopolio doméstico — filtro anti-rotación",
    successProbabilityLabel:
      legs.length > 0
        ? `Probabilidad estimada de éxito: ${(jointProbability * 100).toFixed(0)}%`
        : undefined,
    fillNotice,
    status,
    ignoreRotationFilter: ignoreRotationFilter === true,
  };
}

/**
 * Build a dynamic-leg monopoly ticket. NEVER truncates the qualifying set.
 */
export function buildMonopolyParlay(
  matches: Match[],
  config: Pick<ParlayConfig, "stake" | "ignoreRotationFilter">
): GeneratedParlay {
  const stake = config.stake > 0 ? config.stake : 1.5;
  const ignoreRotationFilter = config.ignoreRotationFilter === true;
  const week = getWeeklyDateRange();
  const { legs } = collectMonopolyLegs(matches, { ignoreRotationFilter });

  if (legs.length < MONOPOLY_MIN_LEGS) {
    return finalizeMonopoly(
      [],
      stake,
      "INSUFFICIENT_MATCHES",
      INSUFFICIENT_MATCHES_MESSAGE,
      ignoreRotationFilter
    );
  }

  return finalizeMonopoly(
    legs,
    stake,
    "OK",
    `Cartelera semanal ${week.fromYmd} → ${week.toYmd}: ${legs.length} monopolios domésticos (sin tope)`,
    ignoreRotationFilter
  );
}
