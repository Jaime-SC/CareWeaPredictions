export type LeagueId =
  | "premier-league"
  | "laliga"
  | "champions-league"
  | "europa-league"
  | "conference-league"
  | "copa-libertadores"
  | "copa-sudamericana"
  | "serie-a"
  | "bundesliga"
  | "ligue-1"
  | "brasileirao"
  | "liga-profesional"
  | "liga-pro-ecuador"
  | "mls"
  | "liga-mx"
  | "concacaf-champions-cup"
  | "leagues-cup"
  | "primera-chile"
  | "primera-colombia"
  | "international-friendlies"
  | "club-friendlies"
  | "other-domestic";

/**
 * Goal / 1X2 + Phase 2 (corners, yellow cards, 1st-half).
 * Path: probs → oddsForMarket → evaluateMarket → JugaBet label.
 */
export type MarketType =
  | "home"
  | "draw"
  | "away"
  | "1x"
  | "x2"
  | "over_0_5"
  | "over_1_5"
  | "over_2_5"
  | "under_3_5"
  | "under_4_5"
  | "home_scores"
  | "away_scores"
  | "home_over_1_5"
  | "away_over_1_5"
  | "dnb_home"
  | "dnb_away"
  | "btts_yes"
  | "btts_no"
  // Corners FT
  | "corners_over_7_5"
  | "corners_under_7_5"
  | "corners_over_8_5"
  | "corners_under_8_5"
  | "corners_over_9_5"
  | "corners_under_9_5"
  | "corners_over_10_5"
  | "corners_under_10_5"
  // Corners 1H
  | "corners_1h_over_3_5"
  | "corners_1h_under_3_5"
  | "corners_1h_over_4_5"
  | "corners_1h_under_4_5"
  // Corners by team
  | "corners_home_over_3_5"
  | "corners_home_under_3_5"
  | "corners_home_over_4_5"
  | "corners_home_under_4_5"
  | "corners_away_over_3_5"
  | "corners_away_under_3_5"
  | "corners_away_over_4_5"
  | "corners_away_under_4_5"
  // Yellow cards FT
  | "cards_over_3_5"
  | "cards_under_3_5"
  | "cards_over_4_5"
  | "cards_under_4_5"
  | "cards_over_5_5"
  | "cards_under_5_5"
  // Both teams to receive a card
  | "cards_btts"
  // Yellow cards by team
  | "cards_home_over_1_5"
  | "cards_home_under_1_5"
  | "cards_home_over_2_5"
  | "cards_home_under_2_5"
  | "cards_away_over_1_5"
  | "cards_away_under_1_5"
  | "cards_away_over_2_5"
  | "cards_away_under_2_5"
  // Half-time goals
  | "ht_over_0_5"
  | "ht_under_0_5"
  | "ht_over_1_5"
  | "ht_under_1_5"
  | "ht_home"
  | "ht_draw"
  | "ht_away";

export type StrategyMode = "daily-safe" | "daily-fun" | "monopoly-asymmetry";

export type RiskTier = "safe" | "fun" | "monopoly";

export type ParlayStatus = "OK" | "INSUFFICIENT_MATCHES";

export type InjuryRole =
  | "striker"
  | "midfielder"
  | "defender"
  | "goalkeeper"
  | "unknown";

export interface TeamInjury {
  player: string;
  role: InjuryRole;
  reason?: string;
  status?: "out" | "doubtful";
  /** True when the absence is a top scorer / starting GK (stronger λ penalty). */
  keyAbsence?: boolean;
}

export interface TeamStats {
  /** API-Football team id when known. */
  id?: number;
  name: string;
  shortName: string;
  /** Most recent first (max ~5). Built from local fixture history when available. */
  form: ("W" | "D" | "L")[];
  goalsScoredAvg: number;
  goalsConcededAvg: number;
  /** Venue-specific scoring averages (preferred over overall for Poisson λ). */
  homeGoalsScoredAvg?: number;
  homeGoalsConcededAvg?: number;
  awayGoalsScoredAvg?: number;
  awayGoalsConcededAvg?: number;
  /** Pre-normalized strengths; when set they override raw averages. */
  homeAttackStrength?: number;
  homeDefenseStrength?: number;
  awayAttackStrength?: number;
  awayDefenseStrength?: number;
  /** ISO kickoff of the team's previous finished match (fatigue rule). */
  lastMatchAt?: string | null;
  /** Known absences (cache / optional feed). Empty when unknown. */
  injuries?: TeamInjury[];
  /** Avg corners for (FT); from recent fixture stats or prior. */
  cornersForAvg?: number;
  /** Avg corners against (FT). */
  cornersAgainstAvg?: number;
  /** Venue-specific corner for averages. */
  homeCornersForAvg?: number;
  awayCornersForAvg?: number;
  /** Avg yellow cards received per match. */
  yellowCardsAvg?: number;
  homeYellowCardsAvg?: number;
  awayYellowCardsAvg?: number;
}

export interface MatchOdds {
  home: number;
  draw: number;
  away: number;
  doubleChance1X: number;
  doubleChanceX2: number;
  over05: number;
  over15: number;
  over25: number;
  under35: number;
  under45: number;
  homeScores: number;
  awayScores: number;
  /** Team total over 1.5 (home). Optional — exotic books often omit it. */
  homeOver15?: number;
  /** Team total over 1.5 (away). Optional — exotic books often omit it. */
  awayOver15?: number;
  dnbHome: number;
  dnbAway: number;
  /** Both teams to score — Yes (optional book line). */
  bttsYes?: number;
  /** Both teams to score — No (optional book line). */
  bttsNo?: number;
  /** Phase 2 book lines (optional — omit / ≤1 excludes from pool). */
  cornersOver75?: number;
  cornersUnder75?: number;
  cornersOver85?: number;
  cornersUnder85?: number;
  cornersOver95?: number;
  cornersUnder95?: number;
  cornersOver105?: number;
  cornersUnder105?: number;
  corners1hOver35?: number;
  corners1hUnder35?: number;
  corners1hOver45?: number;
  corners1hUnder45?: number;
  cornersHomeOver35?: number;
  cornersHomeUnder35?: number;
  cornersHomeOver45?: number;
  cornersHomeUnder45?: number;
  cornersAwayOver35?: number;
  cornersAwayUnder35?: number;
  cornersAwayOver45?: number;
  cornersAwayUnder45?: number;
  cardsOver35?: number;
  cardsUnder35?: number;
  cardsOver45?: number;
  cardsUnder45?: number;
  cardsOver55?: number;
  cardsUnder55?: number;
  cardsHomeOver15?: number;
  cardsHomeUnder15?: number;
  cardsHomeOver25?: number;
  cardsHomeUnder25?: number;
  cardsAwayOver15?: number;
  cardsAwayUnder15?: number;
  cardsAwayOver25?: number;
  cardsAwayUnder25?: number;
  htOver05?: number;
  htUnder05?: number;
  htOver15?: number;
  htUnder15?: number;
  htHome?: number;
  htDraw?: number;
  htAway?: number;
}

/** Facts needed to settle Phase 1 + Phase 2 markets. */
export type SettlementFacts = {
  homeGoals: number;
  awayGoals: number;
  htHomeGoals?: number | null;
  htAwayGoals?: number | null;
  cornersHome?: number | null;
  cornersAway?: number | null;
  /** 1H corner total when available; null → void 1H corner markets. */
  corners1hTotal?: number | null;
  yellowHome?: number | null;
  yellowAway?: number | null;
};

/** Compact fixture card used by monopoly anti-rotation (±4 days). */
export interface NearbyTeamFixture {
  id: number;
  date: string;
  league: { id: number; name: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
}

/** Two-legged / single-elimination status used by the knockout engine. */
export type KnockoutLegStatus = "LEG_1" | "LEG_2" | "SINGLE_KNOCKOUT";

/** Human-readable leg tag attached to generated selections. */
export type KnockoutLegLabel = "1st Leg" | "2nd Leg" | "Single";

/**
 * Structural knockout metadata. All model markets are 90-minute regular time
 * (never extra time, pens, or "to qualify").
 */
export interface KnockoutContext {
  isKnockout: boolean;
  leg: KnockoutLegLabel | null;
  note: string;
  status?: KnockoutLegStatus | null;
  comebackRequired?: boolean;
  firstLegScore?: { currentHome: number; currentAway: number } | null;
}

export interface Match {
  id: string;
  league: LeagueId;
  leagueName: string;
  /** API-Football league id when known (e.g. "39"). */
  leagueId?: string;
  /** API-Football `league.round` / stage, e.g. "Play-offs - 1st Leg". */
  round?: string | null;
  /**
   * First-leg goals from the current fixture's sides (2nd-leg home/away).
   * Used to detect comeback pressure on the return leg.
   */
  firstLegScore?: { currentHome: number; currentAway: number } | null;
  kickoff: string;
  home: TeamStats;
  away: TeamStats;
  /** Monopoly mode: team's fixtures within ±4 days of kickoff. */
  nearbyTeamFixtures?: NearbyTeamFixture[];
  h2h: {
    homeWins: number;
    draws: number;
    awayWins: number;
    avgGoals: number;
    /** Wins for the listed home side in the last ≤4 direct meetings. */
    last4HomeWins?: number;
    last4AwayWins?: number;
    last4Draws?: number;
  };
  odds: MatchOdds;
  /** Fixture referee (API-Football), shown in match detail. */
  referee?: string | null;
  /** Venue name (API-Football). */
  venue?: string | null;
  /** Open-Meteo matchday weather (optional enrichment). */
  weather?: {
    precipMmH: number;
    factor: number;
    alert?: string;
    lat?: number;
    lon?: number;
    date?: string;
  };
  /** League table ranks (API-Football /standings). */
  standings?: {
    homeRank: number | null;
    awayRank: number | null;
    awayRankGap: number | null;
  };
}

/** Canonical alias used by persistence / API-Football fixture rows. */
export type Fixture = Match;

export interface MarketPrediction {
  market: MarketType;
  label: string;
  odds: number;
  modelProbability: number;
  impliedProbability: number;
  edge: number;
  /**
   * Spec value: FairOdds=1/P, Value%=(Book/Fair−1)×100 ≥ 5.
   * Coexists with `edge` (P_model − 1/odds).
   */
  isValueBet?: boolean;
  /** Value margin percent from FairOdds (spec). */
  valueMarginPercent?: number;
  isSafePick: boolean;
  expectedGoals?: { home: number; away: number };
  /** Context-engine multiplier applied to the raw Poisson probability. */
  confidenceModifier?: number;
  contextFlags?: string[];
  /** Present on cup / two-legged ties; markets are always 90-minute FT. */
  knockoutContext?: KnockoutContext;
}

/** Groq Llama qualitative audit of a fixture. */
export interface AIVerdict {
  approved: boolean;
  vetoReason: string | null;
  confidenceScore: number;
  summary: string;
}

export interface MatchPrediction {
  matchId: string;
  match: Match;
  expectedGoals: { home: number; away: number };
  markets: MarketPrediction[];
  bestSafePick: MarketPrediction | null;
  contextFlags?: string[];
  contextNotes?: string[];
  knockoutContext?: KnockoutContext;
  /** Present when Groq AI Judge audited this fixture. */
  aiJudge?: AIVerdict;
}

/** Canonical alias for a scored match + markets bundle. */
export type Prediction = MatchPrediction;

export interface ParlayLeg {
  matchId: string;
  matchLabel: string;
  leagueName: string;
  kickoff: string;
  market: MarketType;
  marketLabel: string;
  odds: number;
  modelProbability: number;
  edge: number;
  /** Context-engine flags for UI badges (HOME_DOMINANT, KEY_INJURY_*, …). */
  contextFlags?: string[];
  contextNotes?: string[];
  referee?: string | null;
  venue?: string | null;
  /** Set when monopoly anti-rotation was bypassed and a continental fixture is nearby. */
  warning?: "NEARBY_INTERNATIONAL_MATCH_PRESENT";
  knockoutContext?: KnockoutContext;
  /** Groq AI Judge audit — only attached when the judge actually ran. */
  aiJudge?: AIVerdict;
}

/** Same-game parlay: primary + secondary leg from one fixture. */
export interface SameGameBetBuilder {
  matchId: string;
  matchLabel: string;
  legs: [ParlayLeg, ParlayLeg];
  combinedOdds: number;
  jointProbability: number;
  valueMarginPercent: number;
}

export interface SafePickItem {
  matchId: string;
  matchLabel: string;
  leagueName: string;
  kickoff: string;
  market: MarketType;
  marketLabel: string;
  odds: number;
  modelProbability: number;
  edge: number;
  isValueBet?: boolean;
  valueMarginPercent?: number;
  contextFlags?: string[];
  contextNotes?: string[];
  confidenceModifier?: number;
  referee?: string | null;
  venue?: string | null;
  knockoutContext?: KnockoutContext;
  expectedGoals?: { home: number; away: number };
  impliedProbability?: number;
  isSafePick?: boolean;
  label?: string;
  /** Groq AI Judge audit — only attached when the judge actually ran. */
  aiJudge?: AIVerdict;
  /** Stake already saved in historial (CLP). */
  stakeCLP?: number;
  registered?: boolean;
}

export interface ParlayConfig {
  stake: number;
  targetMultiplier: number;
  maxLegs: number;
  minOdds: number;
  maxOdds: number;
  minProbability?: number;
  /**
   * Exact number of selections the generator should produce.
   * When the strict probability filter yields fewer picks, lower-probability
   * candidates are backfilled until this count is reached (if matches exist).
   * Defaults to 15 for fun / accumulator modes.
   */
  targetLegCount?: number;
  strategyMode?: StrategyMode;
  /** Monopoly: skip ±4 day continental rotation check when true. */
  ignoreRotationFilter?: boolean;
}

export interface GeneratedParlay {
  legs: ParlayLeg[];
  totalOdds: number;
  stake: number;
  potentialPayout: number;
  jointProbability: number;
  riskLevel: "low" | "medium" | "high" | "extreme";
  riskLabel: string;
  averageEdge: number;
  hitTarget: boolean;
  strategyMode?: StrategyMode;
  strategyLabel?: string;
  riskTier?: RiskTier;
  successProbabilityLabel?: string;
  /** Shown when fewer qualifying matches than requested were available */
  fillNotice?: string;
  /** Structured builder status (monopoly mode uses INSUFFICIENT_MATCHES). */
  status?: ParlayStatus;
  /** Monopoly: whether the ticket was generated with the rotation filter off. */
  ignoreRotationFilter?: boolean;
  /** Same-game combined picks (primary + secondary leg). */
  betBuilders?: SameGameBetBuilder[];
}

/** Canonical alias for a generated accumulator ticket. */
export type Parlay = GeneratedParlay;

export interface BankrollSettings {
  totalBankroll: number;
  currency: string;
  minBookmakerStake: number;
  maxRiskSingle: number;
  maxRiskParlay: number;
}

/** Snapshot of self-calibration (weights live in `config/model-weights.json`). */
export interface CalibrationWeights {
  version: number;
  calibratedAt: string | null;
  sampleSize: number;
  leaguesAdjusted: number;
  marketsAdjusted: number;
  message: string;
}
