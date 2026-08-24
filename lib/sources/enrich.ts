/**
 * Multi-source enrich orchestrator (ESPN absences, Open-Meteo, Odds API gaps).
 * Soft-fail + live budget. Does not replace clean API-Football injuries/odds.
 */
import type { Match } from "../types";
import { chileDateString } from "../utils";
import { peekTeamProfile, updateTeamProfileFlags } from "../team-profiler";
import { getEspnTeamContext } from "./espn";
import {
  getFixtureWeather,
  resolveVenueCoords,
  type FixtureWeather,
} from "./weather";
import {
  DEFAULT_SOCCER_SPORT_KEY,
  fetchMatchOdds,
  fillOddsGaps,
  oddsPartialForFixture,
} from "./odds-api";
import type { MatchOdds } from "../types";
import { attachStandingsToMatches } from "../standings";

function hasUsable1x2(odds: MatchOdds): boolean {
  return odds.home > 1 && odds.draw > 1 && odds.away > 1;
}

/** Max uncached ESPN live lookups per enrich pass. */
const ESPN_LIVE_BUDGET = 4;
/** Max Open-Meteo live lookups per enrich pass. */
const WEATHER_LIVE_BUDGET = 6;

function hasKeyInjuryAlready(match: Match, side: "home" | "away"): boolean {
  const team = match[side];
  const fromInjuries = (team.injuries ?? []).some(
    (i) => i.keyAbsence && i.status !== "doubtful"
  );
  if (fromInjuries) return true;
  const id = team.id;
  if (id == null || id <= 0) return false;
  return (peekTeamProfile(id)?.keyAbsencesCount ?? 0) >= 1;
}

function kickoffDateYmd(kickoff: string): string {
  const t = Date.parse(kickoff);
  if (!Number.isFinite(t)) return chileDateString();
  return new Date(t).toISOString().slice(0, 10);
}

async function applyEspnAbsences(
  match: Match,
  side: "home" | "away",
  budget: { left: number }
): Promise<void> {
  if (budget.left <= 0) return;
  if (hasKeyInjuryAlready(match, side)) return;
  const team = match[side];
  const teamId = team.id;
  if (teamId == null || teamId <= 0) return;

  budget.left -= 1;
  const ctx = await getEspnTeamContext(team.name);
  if (ctx.keyAbsences.length === 0) return;

  await updateTeamProfileFlags(
    teamId,
    team.name,
    {
      keyAbsencesCount: Math.min(20, ctx.keyAbsences.length),
    },
    { leagueId: match.leagueId }
  );
}

/**
 * Attach weather / fill odds gaps / ESPN → keyAbsencesCount when API-Football
 * did not already mark key absences.
 */
export async function enrichMatchesFromExternalSources(
  matches: Match[]
): Promise<Match[]> {
  if (matches.length === 0) return matches;

  const espnBudget = { left: ESPN_LIVE_BUDGET };
  let weatherBudget = WEATHER_LIVE_BUDGET;

  let oddsEvents: Awaited<ReturnType<typeof fetchMatchOdds>> = [];
  const anyMissingOdds = matches.some((m) => !hasUsable1x2(m.odds));
  if (anyMissingOdds) {
    oddsEvents = await fetchMatchOdds(DEFAULT_SOCCER_SPORT_KEY, "eu");
  }

  const out: Match[] = [];
  for (const match of matches) {
    let next: Match = { ...match, home: { ...match.home }, away: { ...match.away } };

    // Weather (static coords only)
    if (weatherBudget > 0 && !next.weather) {
      const coords = resolveVenueCoords(next.venue, null);
      if (coords) {
        weatherBudget -= 1;
        const weather: FixtureWeather | null = await getFixtureWeather(
          coords.lat,
          coords.lon,
          kickoffDateYmd(next.kickoff)
        );
        if (weather) next = { ...next, weather };
      }
    }

    // Odds API fill-gaps
    if (!hasUsable1x2(next.odds) && oddsEvents.length > 0) {
      const partial = oddsPartialForFixture(
        oddsEvents,
        next.home.name,
        next.away.name
      );
      if (partial) {
        next = { ...next, odds: fillOddsGaps(next.odds, partial) };
      }
    }

    // ESPN absences → TeamProfile (skip if already key-injured)
    await applyEspnAbsences(next, "home", espnBudget);
    await applyEspnAbsences(next, "away", espnBudget);

    out.push(next);
  }

  // League standings ranks (cache-first) for Away gap penalty
  return attachStandingsToMatches(out);
}
