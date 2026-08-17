import monopolyTeamsJson from "../data/monopoly-teams.json";

export type MonopolyRosterTeam = {
  teamId: number;
  teamName: string;
  leagueId: number;
  leagueName: string;
  country: string;
};

export type MonopolyRosterLeague = {
  leagueId: number;
  leagueName: string;
  country: string;
  teams: MonopolyRosterTeam[];
};

export function getMonopolyRosterByLeague(): MonopolyRosterLeague[] {
  const teams = monopolyTeamsJson as MonopolyRosterTeam[];
  const byLeague = new Map<number, MonopolyRosterLeague>();

  for (const team of teams) {
    const existing = byLeague.get(team.leagueId);
    if (existing) {
      existing.teams.push(team);
      continue;
    }
    byLeague.set(team.leagueId, {
      leagueId: team.leagueId,
      leagueName: team.leagueName,
      country: team.country,
      teams: [team],
    });
  }

  return [...byLeague.values()].sort((a, b) =>
    a.country.localeCompare(b.country, "es", { sensitivity: "base" })
  );
}
