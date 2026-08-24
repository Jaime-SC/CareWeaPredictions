/**
 * Competition category labels (UI + filters).
 * Source of truth for region keys lives in `config/allowed-leagues.ts`.
 */
export type {
  AllowedLeagueEntry,
  AllowedLeagueRegion,
} from "../config/allowed-leagues";

export {
  REGION_DISPLAY_LABELS,
  competitionCategoryLabel,
  resolveLeagueRegion,
  restrictedCompetitionBadge,
} from "../config/allowed-leagues";
