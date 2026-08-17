/**
 * Context Engine: post-Poisson probability multipliers from real-world factors.
 * Venue splits, injuries, friendlies / pre-season, H2H, form streaks and derbies.
 */
import type {
  InjuryRole,
  MarketType,
  Match,
  TeamInjury,
  TeamStats,
} from "./types";

export interface ContextResult {
  finalProbability: number;
  /** Combined multiplier; typical band 0.92–1.08 (derby unders can go to 0.85). */
  confidenceModifier: number;
  contextFlags: string[];
  contextNotes: string[];
}

export interface ContextMarketMap {
  probs: Record<MarketType, number>;
  modifiers: Record<MarketType, number>;
  perMarket: Record<MarketType, ContextResult>;
  contextFlags: string[];
  contextNotes: string[];
}

const SOFT_MOD_MIN = 0.92;
const SOFT_MOD_MAX = 1.08;
const POLICY_MOD_MIN = 0.85;
const POLICY_MOD_MAX = 1.12;

const WIN_STREAK_PROB_BOOST = 1.05;
const DERBY_OVER_BOOST = 1.05;
const DERBY_BTTS_BOOST = 1.04;
const DERBY_UNDER35 = 0.85;
const DERBY_UNDER45 = 0.92;
export const FATIGUE_MAX_DAYS = 4;

const HOME_WIN_MARKETS = new Set<MarketType>(["home", "1x", "dnb_home"]);
const AWAY_WIN_MARKETS = new Set<MarketType>(["away", "x2", "dnb_away"]);
const OVER_MARKETS = new Set<MarketType>([
  "over_0_5",
  "over_1_5",
  "over_2_5",
  "home_over_1_5",
  "away_over_1_5",
]);
const UNDER_MARKETS = new Set<MarketType>(["under_3_5", "under_4_5"]);

const ALL_MARKETS: MarketType[] = [
  "home",
  "draw",
  "away",
  "1x",
  "x2",
  "over_0_5",
  "over_1_5",
  "over_2_5",
  "under_3_5",
  "under_4_5",
  "home_scores",
  "away_scores",
  "home_over_1_5",
  "away_over_1_5",
  "dnb_home",
  "dnb_away",
];

const FLAG_NOTES: Record<string, string> = {
  HOME_DOMINANT: "Local claramente más fuerte en casa",
  HOME_FORTRESS: "Local encaja poco como local",
  AWAY_LEAKY: "Visitante encaja mucho fuera",
  AWAY_MUTED: "Visitante marca poco fuera",
  KEY_INJURY_STRIKER: "Baja de delantero clave",
  KEY_INJURY_GOALKEEPER: "Baja de arquero",
  KEY_INJURY_DEFENDER: "Baja de defensa clave",
  KEY_INJURY_CLUSTER: "Varias bajas relevantes",
  FRIENDLY_HIGH_VARIANCE: "Amistoso — alta varianza",
  PRE_SEASON: "Pretemporada — rotaciones esperadas",
  H2H_HOME_DOMINANT: "H2H favorece al local",
  H2H_AWAY_DOMINANT: "H2H favorece al visitante",
  H2H_HIGH_SCORING: "H2H con muchos goles",
  H2H_LOW_SCORING: "H2H con pocos goles",
  H2H_DRAWISH: "H2H con muchos empates",
  H2H_THIN_SAMPLE: "Pocos enfrentamientos previos",
  HOME_WIN_STREAK: "Racha de victorias del local",
  AWAY_WIN_STREAK: "Racha de victorias del visitante",
  HIGH_RISK_DERBY: "Clásico de alto riesgo",
  FATIGUE_HOME: "Fatiga del local (calendario apretado)",
  FATIGUE_AWAY: "Fatiga del visitante (calendario apretado)",
  NEARBY_INTERNATIONAL_MATCH_PRESENT:
    "Partido continental cercano — riesgo de rotación (filtro desactivado)",
};

/** Short UI badges (match cards / parlay legs). */
export const CONTEXT_BADGE_LABELS: Record<string, string> = {
  HOME_DOMINANT: "Fuerte de Local",
  HOME_FORTRESS: "Fortaleza Local",
  AWAY_LEAKY: "Visita Frágil",
  AWAY_MUTED: "Visita Sin Gol",
  KEY_INJURY_STRIKER: "Baja Clave (ATA)",
  KEY_INJURY_GOALKEEPER: "Baja Clave (POR)",
  KEY_INJURY_DEFENDER: "Baja Clave (DEF)",
  KEY_INJURY_CLUSTER: "Varias Bajas",
  FRIENDLY_HIGH_VARIANCE: "Amistoso",
  PRE_SEASON: "Pretemporada",
  H2H_HOME_DOMINANT: "Dominio H2H Local",
  H2H_AWAY_DOMINANT: "Dominio H2H Visita",
  H2H_HIGH_SCORING: "H2H Goleador",
  H2H_LOW_SCORING: "H2H Bajo Gol",
  H2H_DRAWISH: "H2H Empates",
  H2H_THIN_SAMPLE: "Poco H2H",
  HOME_WIN_STREAK: "Racha Local",
  AWAY_WIN_STREAK: "Racha Visita",
  HIGH_RISK_DERBY: "Clásico",
  FATIGUE_HOME: "Fatiga Local",
  FATIGUE_AWAY: "Fatiga Visita",
  NEARBY_INTERNATIONAL_MATCH_PRESENT:
    "⚠️ RIESGO DE ROTACIÓN (Filtro Desactivado)",
};

/** Friendlies / pre-season: raise eligibility floor from 80% → 85%. */
export const FRIENDLY_MIN_PROBABILITY = 0.85;
const H2H_DOMINANCE_BOOST = 1.04;
const INJURY_ATTACK_PENALTY = 0.93; // −7% (band −5%…−8%)
const INJURY_GK_PENALTY = 0.94; // −6% defensive rating impact on probs
const INJURY_STRIKER_KEY = 0.92; // −8% when flagged keyAbsence
const INJURY_GK_KEY = 0.93;

/** Canonical high-risk derby / clássico pairs (normalized lowercase names). */
const HIGH_RISK_DERBY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["real madrid", "barcelona"],
  ["real madrid", "atletico madrid"],
  ["barcelona", "espanyol"],
  ["manchester united", "manchester city"],
  ["manchester united", "liverpool"],
  ["liverpool", "everton"],
  ["arsenal", "tottenham"],
  ["arsenal", "chelsea"],
  ["chelsea", "tottenham"],
  ["inter", "milan"],
  ["ac milan", "inter"],
  ["inter milan", "ac milan"],
  ["roma", "lazio"],
  ["juventus", "torino"],
  ["juventus", "inter"],
  ["napoli", "roma"],
  ["boca juniors", "river plate"],
  ["racing club", "independiente"],
  ["flamengo", "fluminense"],
  ["flamengo", "vasco"],
  ["corinthians", "palmeiras"],
  ["sao paulo", "corinthians"],
  ["gremio", "internacional"],
  ["colo colo", "universidad de chile"],
  ["colo-colo", "universidad de chile"],
  ["atletico nacional", "millonarios"],
  ["america", "guadalajara"],
  ["club america", "chivas"],
  ["bayern munich", "borussia dortmund"],
  ["bayern munchen", "borussia dortmund"],
  ["psg", "marseille"],
  ["paris saint germain", "olympique marseille"],
  ["celtic", "rangers"],
  ["ajax", "feyenoord"],
  ["benfica", "porto"],
  ["galatasaray", "fenerbahce"],
];

type Nudge = {
  flag: string;
  factor: number;
  policy?: boolean;
};

function normalizeTeamKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(fc|cf|sc|ac|club|deportivo|de|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  // Avoid "a" matching "america" after stripping generic tokens like "club"
  if (shorter.length < 4) return false;
  return longer.includes(shorter);
}

export function isHighRiskDerby(match: Match): boolean {
  const home = normalizeTeamKey(match.home.name);
  const away = normalizeTeamKey(match.away.name);
  return HIGH_RISK_DERBY_PAIRS.some(([a, b]) => {
    const left = normalizeTeamKey(a);
    const right = normalizeTeamKey(b);
    return (
      (namesMatch(home, left) && namesMatch(away, right)) ||
      (namesMatch(home, right) && namesMatch(away, left))
    );
  });
}

export function hasWinStreak(form: ("W" | "D" | "L")[]): boolean {
  if (!form.length) return false;
  const recent = form.slice(0, 5);
  return recent.filter((r) => r === "W").length >= 3;
}

export function daysSinceLastMatch(
  lastMatchAt: string | null | undefined,
  kickoff: string
): number | null {
  if (!lastMatchAt) return null;
  const prev = Date.parse(lastMatchAt);
  const next = Date.parse(kickoff);
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
  return (next - prev) / (1000 * 60 * 60 * 24);
}

export function isFatigued(
  lastMatchAt: string | null | undefined,
  kickoff: string
): boolean {
  const days = daysSinceLastMatch(lastMatchAt, kickoff);
  return days != null && days >= 0 && days < FATIGUE_MAX_DAYS;
}

export function derbyPreferredMarkets(): Set<MarketType> {
  return new Set<MarketType>(["over_1_5", "home_scores", "away_scores"]);
}

export function isMarketBlockedByDerby(
  match: Match,
  market: MarketType
): boolean {
  return market === "under_3_5" && isHighRiskDerby(match);
}

export function isFriendlyOrPreSeason(match: Match): boolean {
  if (
    match.league === "club-friendlies" ||
    match.league === "international-friendlies"
  ) {
    return true;
  }
  const leagueId = Number(match.leagueId);
  if (leagueId === 666 || leagueId === 667) return true;
  const name = match.leagueName.toLowerCase();
  return /friendly|friendlies|pre[-\s]?season|pretemporada|amistoso/.test(
    name
  );
}

export function isPreSeasonMatch(match: Match): boolean {
  const name = match.leagueName.toLowerCase();
  if (/pre[-\s]?season|pretemporada/.test(name)) return true;
  if (!isFriendlyOrPreSeason(match)) return false;
  const month = new Date(match.kickoff).getUTCMonth() + 1;
  return month === 1 || month === 2 || month === 6 || month === 7 || month === 8;
}

/** Effective min model probability after friendly guardrail. */
export function resolveContextMinProbability(
  baseMin: number,
  match: Match
): number {
  if (isFriendlyOrPreSeason(match) || isPreSeasonMatch(match)) {
    return Math.max(baseMin, FRIENDLY_MIN_PROBABILITY);
  }
  return baseMin;
}

export function contextBadgeLabels(flags: string[] | undefined): string[] {
  if (!flags?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const flag of flags) {
    const label = CONTEXT_BADGE_LABELS[flag] ?? FLAG_NOTES[flag] ?? flag;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * λ multipliers from key absences (attacking / defensive rating).
 * Striker out → attack −5…−8%; starting GK out → defense weakness ↑.
 */
export function injuryLambdaFactors(match: Match): {
  homeAttack: number;
  homeDefense: number;
  awayAttack: number;
  awayDefense: number;
  flags: string[];
} {
  const flags: string[] = [];
  let homeAttack = 1;
  let homeDefense = 1;
  let awayAttack = 1;
  let awayDefense = 1;

  const applySide = (
    injuries: TeamInjury[],
    side: "home" | "away"
  ) => {
    for (const inj of injuries) {
      if (inj.status === "doubtful") continue;
      if (inj.role === "striker") {
        flags.push("KEY_INJURY_STRIKER");
        const pen = inj.keyAbsence ? INJURY_STRIKER_KEY : INJURY_ATTACK_PENALTY;
        if (side === "home") homeAttack *= pen;
        else awayAttack *= pen;
      } else if (inj.role === "goalkeeper") {
        flags.push("KEY_INJURY_GOALKEEPER");
        const pen = inj.keyAbsence ? INJURY_GK_KEY : INJURY_GK_PENALTY;
        // Weaker defense → higher conceded λ (defense weakness multiplies opponent attack path)
        if (side === "home") homeDefense *= 2 - pen; // e.g. 1.06–1.08
        else awayDefense *= 2 - pen;
      } else if (inj.role === "defender") {
        flags.push("KEY_INJURY_DEFENDER");
        if (side === "home") homeDefense *= 1.04;
        else awayDefense *= 1.04;
      }
    }
  };

  applySide(match.home.injuries ?? [], "home");
  applySide(match.away.injuries ?? [], "away");

  return {
    homeAttack: clamp(homeAttack, 0.85, 1.05),
    homeDefense: clamp(homeDefense, 0.95, 1.15),
    awayAttack: clamp(awayAttack, 0.85, 1.05),
    awayDefense: clamp(awayDefense, 0.95, 1.15),
    flags: [...new Set(flags)],
  };
}

export function classifyInjuryRole(
  raw?: string | null
): InjuryRole {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/gk|goalkeeper|arquero|portero/.test(s)) return "goalkeeper";
  if (/def|centre-back|center back|\bcb\b|\blb\b|\brb\b|back/.test(s)) {
    return "defender";
  }
  if (/mid|cm|am|dm|volante/.test(s)) return "midfielder";
  if (/att|st\b|fw|wing|striker|forward|delantero|attacker/.test(s)) {
    return "striker";
  }
  return "unknown";
}

export function notesForFlags(flags: string[]): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const flag of flags) {
    const note = FLAG_NOTES[flag] ?? flag;
    if (seen.has(note)) continue;
    seen.add(note);
    notes.push(note);
  }
  return notes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return clamp(p, 0, 0.99);
}

function hasUsableAttack(team: TeamStats): boolean {
  return (
    team.goalsScoredAvg > 0.15 ||
    (team.homeGoalsScoredAvg ?? 0) > 0.15 ||
    (team.awayGoalsScoredAvg ?? 0) > 0.15
  );
}

function pickFactor(
  market: MarketType | undefined,
  directional: Partial<Record<MarketType, number>>,
  fallback = 1
): number {
  if (!market) return fallback;
  return directional[market] ?? 1;
}

function collectNudges(match: Match, market?: MarketType): Nudge[] {
  const nudges: Nudge[] = [];
  const push = (nudge: Nudge) => {
    if (!nudge.flag) return;
    nudges.push(nudge);
  };

  // --- Venue splits (only when history actually differs from overall) ---
  if (hasUsableAttack(match.home) || hasUsableAttack(match.away)) {
    const homeScoredHome =
      match.home.homeGoalsScoredAvg ?? match.home.goalsScoredAvg;
    const homeOverall = match.home.goalsScoredAvg;
    const homeConcededHome =
      match.home.homeGoalsConcededAvg ?? match.home.goalsConcededAvg;
    const awayScoredAway =
      match.away.awayGoalsScoredAvg ?? match.away.goalsScoredAvg;
    const awayConcededAway =
      match.away.awayGoalsConcededAvg ?? match.away.goalsConcededAvg;

    const homeSplit =
      match.home.homeGoalsScoredAvg != null &&
      homeOverall > 0.15 &&
      homeScoredHome >= 1.45 &&
      homeScoredHome >= homeOverall * 1.12;
    const homeVsAwayAttack =
      homeScoredHome >= 1.55 &&
      awayScoredAway > 0 &&
      homeScoredHome - awayScoredAway >= 0.45;

    if (homeSplit || homeVsAwayAttack) {
      push({
        flag: "HOME_DOMINANT",
        factor: pickFactor(
          market,
          {
            home: 1.04,
            "1x": 1.03,
            dnb_home: 1.03,
            home_scores: 1.03,
            away: 0.97,
            x2: 0.97,
            dnb_away: 0.97,
          },
          1.02
        ),
      });
    }

    if (
      match.home.homeGoalsConcededAvg != null &&
      homeConcededHome <= 0.9 &&
      homeConcededHome + 0.15 <= (match.home.goalsConcededAvg || homeConcededHome)
    ) {
      push({
        flag: "HOME_FORTRESS",
        factor: pickFactor(
          market,
          {
            under_3_5: 1.03,
            under_4_5: 1.02,
            "1x": 1.02,
            home: 1.02,
            over_2_5: 0.97,
            away_scores: 0.97,
          },
          1.01
        ),
      });
    }

    if (
      match.away.awayGoalsConcededAvg != null &&
      awayConcededAway >= 1.5
    ) {
      push({
        flag: "AWAY_LEAKY",
        factor: pickFactor(
          market,
          {
            over_1_5: 1.03,
            over_2_5: 1.03,
            home_scores: 1.03,
            under_3_5: 0.97,
            x2: 0.98,
          },
          1.01
        ),
      });
    }

    if (
      match.away.awayGoalsScoredAvg != null &&
      awayScoredAway <= 0.95 &&
      awayScoredAway + 0.15 <= Math.max(match.away.goalsScoredAvg, 0.2)
    ) {
      push({
        flag: "AWAY_MUTED",
        factor: pickFactor(
          market,
          {
            away: 0.97,
            x2: 0.97,
            dnb_away: 0.97,
            away_scores: 0.96,
            over_2_5: 0.98,
            "1x": 1.02,
          },
          1
        ),
      });
    }
  }

  // --- Injuries ---
  const homeInj = match.home.injuries ?? [];
  const awayInj = match.away.injuries ?? [];
  const injuryFlags = injuryNudges(homeInj, awayInj, market);
  for (const n of injuryFlags) push(n);

  // --- Friendly / pre-season ---
  if (isFriendlyOrPreSeason(match)) {
    push({ flag: "FRIENDLY_HIGH_VARIANCE", factor: 0.94 });
  }
  if (isPreSeasonMatch(match)) {
    push({ flag: "PRE_SEASON", factor: 0.97 });
  }

  // --- H2H (last 4 preference: 3+ wins → +4% on side selections) ---
  const h2h = match.h2h;
  const last4Home = h2h.last4HomeWins;
  const last4Away = h2h.last4AwayWins;
  const last4Draws = h2h.last4Draws;
  const last4N =
    last4Home != null && last4Away != null && last4Draws != null
      ? last4Home + last4Away + last4Draws
      : 0;
  const h2hN = h2h.homeWins + h2h.draws + h2h.awayWins;
  if (h2hN > 0 && h2hN < 3 && last4N < 3) {
    push({ flag: "H2H_THIN_SAMPLE", factor: 0.98 });
  }
  const homeDomLast4 = last4N >= 4 && (last4Home ?? 0) >= 3;
  const awayDomLast4 = last4N >= 4 && (last4Away ?? 0) >= 3;
  const homeDomRate = h2hN >= 4 && h2h.homeWins / h2hN >= 0.6;
  const awayDomRate = h2hN >= 4 && h2h.awayWins / h2hN >= 0.6;

  if (homeDomLast4 || homeDomRate) {
    push({
      flag: "H2H_HOME_DOMINANT",
      factor: pickFactor(
        market,
        {
          home: H2H_DOMINANCE_BOOST,
          "1x": H2H_DOMINANCE_BOOST,
          dnb_home: H2H_DOMINANCE_BOOST,
          away: 0.98,
          x2: 0.98,
        },
        1.01
      ),
    });
  } else if (awayDomLast4 || awayDomRate) {
    push({
      flag: "H2H_AWAY_DOMINANT",
      factor: pickFactor(
        market,
        {
          away: H2H_DOMINANCE_BOOST,
          x2: H2H_DOMINANCE_BOOST,
          dnb_away: H2H_DOMINANCE_BOOST,
          home: 0.98,
          "1x": 0.98,
        },
        1.01
      ),
    });
  }
  if (h2hN >= 4 && h2h.draws / h2hN >= 0.4) {
    push({
      flag: "H2H_DRAWISH",
      factor: pickFactor(
        market,
        { draw: 1.04, "1x": 1.02, x2: 1.02, home: 0.98, away: 0.98 },
        1
      ),
    });
  }
  if (h2hN >= 3 && h2h.avgGoals >= 3.0) {
    push({
      flag: "H2H_HIGH_SCORING",
      factor: pickFactor(
        market,
        {
          over_0_5: 1.03,
          over_1_5: 1.03,
          over_2_5: 1.04,
          under_3_5: 0.96,
          under_4_5: 0.97,
          home_scores: 1.02,
          away_scores: 1.02,
        },
        1.01
      ),
    });
  } else if (h2hN >= 3 && h2h.avgGoals <= 1.9) {
    push({
      flag: "H2H_LOW_SCORING",
      factor: pickFactor(
        market,
        {
          under_3_5: 1.03,
          under_4_5: 1.02,
          over_2_5: 0.96,
          over_1_5: 0.98,
        },
        1.01
      ),
    });
  }

  // --- Form streaks ---
  if (hasWinStreak(match.home.form)) {
    push({
      flag: "HOME_WIN_STREAK",
      factor: pickFactor(
        market,
        { home: WIN_STREAK_PROB_BOOST, "1x": WIN_STREAK_PROB_BOOST, dnb_home: WIN_STREAK_PROB_BOOST },
        1
      ),
    });
  }
  if (hasWinStreak(match.away.form)) {
    push({
      flag: "AWAY_WIN_STREAK",
      factor: pickFactor(
        market,
        { away: WIN_STREAK_PROB_BOOST, x2: WIN_STREAK_PROB_BOOST, dnb_away: WIN_STREAK_PROB_BOOST },
        1
      ),
    });
  }

  // --- Fatigue (informational + mild; λ already penalized in Poisson) ---
  if (isFatigued(match.home.lastMatchAt, match.kickoff)) {
    push({
      flag: "FATIGUE_HOME",
      factor: pickFactor(
        market,
        { home: 0.98, "1x": 0.99, dnb_home: 0.98, over_2_5: 0.99 },
        1
      ),
    });
  }
  if (isFatigued(match.away.lastMatchAt, match.kickoff)) {
    push({
      flag: "FATIGUE_AWAY",
      factor: pickFactor(
        market,
        { away: 0.98, x2: 0.99, dnb_away: 0.98, over_2_5: 0.99 },
        1
      ),
    });
  }

  // --- Derby policy (unders can breach the soft 0.92 band on purpose) ---
  if (isHighRiskDerby(match)) {
    const derbyFactor = !market
      ? 1
      : OVER_MARKETS.has(market)
        ? DERBY_OVER_BOOST
        : market === "home_scores" || market === "away_scores"
          ? DERBY_BTTS_BOOST
          : market === "under_3_5"
            ? DERBY_UNDER35
            : market === "under_4_5"
              ? DERBY_UNDER45
              : 1;
    push({
      flag: "HIGH_RISK_DERBY",
      factor: derbyFactor,
      policy: market === "under_3_5" || market === "under_4_5",
    });
  }

  return dedupeNudges(nudges);
}

function injuryNudges(
  homeInj: TeamInjury[],
  awayInj: TeamInjury[],
  market?: MarketType
): Nudge[] {
  const out: Nudge[] = [];
  const homeRoles = rolesOf(homeInj);
  const awayRoles = rolesOf(awayInj);
  const total = homeInj.filter((i) => i.status !== "doubtful").length +
    awayInj.filter((i) => i.status !== "doubtful").length;

  const homeKeyStriker = homeInj.some(
    (i) => i.role === "striker" && i.status !== "doubtful" && i.keyAbsence
  );
  const awayKeyStriker = awayInj.some(
    (i) => i.role === "striker" && i.status !== "doubtful" && i.keyAbsence
  );
  const homeKeyGk = homeInj.some(
    (i) => i.role === "goalkeeper" && i.status !== "doubtful"
  );
  const awayKeyGk = awayInj.some(
    (i) => i.role === "goalkeeper" && i.status !== "doubtful"
  );

  if (homeRoles.has("striker") || awayRoles.has("striker")) {
    const homeStriker = homeRoles.has("striker");
    const awayStriker = awayRoles.has("striker");
    const homePen = homeKeyStriker ? INJURY_STRIKER_KEY : INJURY_ATTACK_PENALTY;
    const awayPen = awayKeyStriker ? INJURY_STRIKER_KEY : INJURY_ATTACK_PENALTY;
    let factor = 1;
    if (!market) factor = Math.min(homePen, awayPen);
    else if (homeStriker && (market === "home_scores" || HOME_WIN_MARKETS.has(market))) {
      factor = homePen;
    } else if (awayStriker && (market === "away_scores" || AWAY_WIN_MARKETS.has(market))) {
      factor = awayPen;
    } else if (OVER_MARKETS.has(market)) {
      factor = 0.95;
    } else if (UNDER_MARKETS.has(market)) {
      factor = 1.02;
    }
    out.push({ flag: "KEY_INJURY_STRIKER", factor });
  }

  if (homeKeyGk || awayKeyGk) {
    let factor = 1;
    if (!market) factor = INJURY_GK_PENALTY;
    else if (OVER_MARKETS.has(market)) factor = 1.04;
    else if (homeKeyGk && (market === "away_scores" || AWAY_WIN_MARKETS.has(market))) {
      factor = 1.05;
    } else if (awayKeyGk && (market === "home_scores" || HOME_WIN_MARKETS.has(market))) {
      factor = 1.05;
    } else if (homeKeyGk && HOME_WIN_MARKETS.has(market)) {
      factor = INJURY_GK_PENALTY;
    } else if (awayKeyGk && AWAY_WIN_MARKETS.has(market)) {
      factor = INJURY_GK_PENALTY;
    } else if (UNDER_MARKETS.has(market)) {
      factor = 0.97;
    }
    out.push({ flag: "KEY_INJURY_GOALKEEPER", factor });
  }

  if (homeRoles.has("defender") || awayRoles.has("defender")) {
    const homeDef = homeRoles.has("defender");
    const awayDef = awayRoles.has("defender");
    let factor = 1;
    if (!market) factor = 1.01;
    else if (OVER_MARKETS.has(market)) factor = 1.02;
    else if (homeDef && market === "away_scores") factor = 1.03;
    else if (awayDef && market === "home_scores") factor = 1.03;
    out.push({ flag: "KEY_INJURY_DEFENDER", factor });
  }

  if (total >= 3) {
    out.push({ flag: "KEY_INJURY_CLUSTER", factor: 0.97 });
  }

  return out;
}

function rolesOf(injuries: TeamInjury[]): Set<InjuryRole> {
  const roles = new Set<InjuryRole>();
  for (const inj of injuries) {
    if (inj.status === "doubtful") continue;
    roles.add(inj.role);
  }
  return roles;
}

function dedupeNudges(nudges: Nudge[]): Nudge[] {
  const byFlag = new Map<string, Nudge>();
  for (const n of nudges) {
    const prev = byFlag.get(n.flag);
    if (!prev) {
      byFlag.set(n.flag, n);
      continue;
    }
    byFlag.set(n.flag, {
      flag: n.flag,
      factor: prev.factor * n.factor,
      policy: Boolean(prev.policy || n.policy),
    });
  }
  return [...byFlag.values()];
}

function combineModifier(nudges: Nudge[]): number {
  let soft = 1;
  let policy = 1;
  for (const n of nudges) {
    if (n.policy) policy *= n.factor;
    else soft *= n.factor;
  }
  const softClamped = clamp(soft, SOFT_MOD_MIN, SOFT_MOD_MAX);
  return clamp(softClamped * policy, POLICY_MOD_MIN, POLICY_MOD_MAX);
}

/**
 * Adjust a raw Poisson probability with match-context multipliers.
 * When `market` is omitted, only match-level (non-directional) factors apply
 * plus a mild average of directional flags.
 */
export function applyContextModifiers(
  baseProbability: number,
  matchData: Match,
  market?: MarketType
): ContextResult {
  const nudges = collectNudges(matchData, market);
  const flags = nudges.map((n) => n.flag);
  const confidenceModifier = Number(combineModifier(nudges).toFixed(4));
  const finalProbability = Number(
    clampProb(baseProbability * confidenceModifier).toFixed(6)
  );

  return {
    finalProbability,
    confidenceModifier,
    contextFlags: flags,
    contextNotes: notesForFlags(flags),
  };
}

/** Apply the engine to a full Poisson market board. */
export function applyContextToMarkets(
  match: Match,
  probs: Record<MarketType, number>
): ContextMarketMap {
  const next = { ...probs } as Record<MarketType, number>;
  const modifiers = {} as Record<MarketType, number>;
  const perMarket = {} as Record<MarketType, ContextResult>;
  const flagSet = new Set<string>();

  for (const market of ALL_MARKETS) {
    const result = applyContextModifiers(probs[market] ?? 0, match, market);
    next[market] = result.finalProbability;
    modifiers[market] = result.confidenceModifier;
    perMarket[market] = result;
    for (const flag of result.contextFlags) flagSet.add(flag);
  }

  const contextFlags = [...flagSet];
  return {
    probs: next,
    modifiers,
    perMarket,
    contextFlags,
    contextNotes: notesForFlags(contextFlags),
  };
}
