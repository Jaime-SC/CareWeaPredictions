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
  | "mls"
  | "liga-mx"
  | "primera-chile"
  | "primera-colombia"
  | "international-friendlies"
  | "club-friendlies";


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
  | "dnb_home"
  | "dnb_away";

export type StrategyMode = "daily-safe" | "daily-fun";

export type RiskTier = "safe" | "fun";

export interface TeamStats {
  name: string;
  shortName: string;
  form: ("W" | "D" | "L")[];
  goalsScoredAvg: number;
  goalsConcededAvg: number;
  homeAttackStrength?: number;
  homeDefenseStrength?: number;
  awayAttackStrength?: number;
  awayDefenseStrength?: number;
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
  dnbHome: number;
  dnbAway: number;
}

export interface Match {
  id: string;
  league: LeagueId;
  leagueName: string;
  kickoff: string;
  home: TeamStats;
  away: TeamStats;
  h2h: {
    homeWins: number;
    draws: number;
    awayWins: number;
    avgGoals: number;
  };
  odds: MatchOdds;
}

export interface MarketPrediction {
  market: MarketType;
  label: string;
  odds: number;
  modelProbability: number;
  impliedProbability: number;
  edge: number;
  isSafePick: boolean;
  expectedGoals?: { home: number; away: number };
}

export interface MatchPrediction {
  matchId: string;
  match: Match;
  expectedGoals: { home: number; away: number };
  markets: MarketPrediction[];
  bestSafePick: MarketPrediction | null;
}

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
}

export interface ParlayConfig {
  stake: number;
  targetMultiplier: number;
  maxLegs: number;
  minOdds: number;
  maxOdds: number;
  minProbability?: number;
  strategyMode?: StrategyMode;
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
}
