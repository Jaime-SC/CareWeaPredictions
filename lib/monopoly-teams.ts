import monopolyTeamsJson from "../data/monopoly-teams.json";

export type MonopolyTeam = {
  teamId: number;
  teamName: string;
  leagueId: number;
  leagueName: string;
  country: string;
};

const TEAMS: MonopolyTeam[] = (monopolyTeamsJson as MonopolyTeam[]).map(
  (row) => ({
    teamId: Number(row.teamId),
    teamName: String(row.teamName),
    leagueId: Number(row.leagueId),
    leagueName: String(row.leagueName ?? ""),
    country: String(row.country),
  })
);

const TEAM_BY_ID = new Map(TEAMS.map((t) => [t.teamId, t]));

export function getMonopolyTeams(): MonopolyTeam[] {
  return TEAMS;
}

export function getMonopolyTeam(teamId: number): MonopolyTeam | undefined {
  return TEAM_BY_ID.get(teamId);
}

export function getMonopolyTeamIds(): Set<number> {
  return new Set(TEAM_BY_ID.keys());
}
