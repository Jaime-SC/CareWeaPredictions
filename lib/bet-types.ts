/** Shared analytics / bet persistence types (safe for client imports). */

export type PredictionOutcome = "WON" | "LOST" | "PENDING" | "VOID";
export type TicketStatus = "PENDING" | "WON" | "LOST" | "VOID";

export interface LeagueStatsRow {
  leagueName: string;
  total: number;
  won: number;
  lost: number;
  winRate: number;
  /** Net ROI % attributing equal stake share per evaluated leg */
  netRoi: number;
}

export interface DateMarketStatsRow {
  date: string;
  market: string;
  marketLabel: string;
  total: number;
  won: number;
  lost: number;
  winRate: number;
}

export interface TrainingFeatureRow {
  league: string;
  market: string;
  selection: string;
  modelProbability: number;
  odds: number;
  outcome: PredictionOutcome;
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
}

export interface StatsSummaryMeta {
  totalTickets: number;
  pending: number;
  won: number;
  lost: number;
  voided: number;
  totalStaked: number;
  netProfit: number;
  roi: number;
  legsWon: number;
  legsEvaluated: number;
  legAccuracy: number;
}
