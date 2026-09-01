"""Map API-Football league ids to soccerdata Understat league codes."""

# Big 5 + common Understat coverage (ponytail: extend when soccerdata adds leagues)
API_FOOTBALL_TO_UNDERSTAT: dict[int, str] = {
    39: "ENG-Premier League",
    40: "ENG-Championship",
    140: "ESP-La Liga",
    141: "ESP-La Liga",
    135: "ITA-Serie A",
    136: "ITA-Serie A",
    78: "GER-Bundesliga",
    79: "GER-Bundesliga",
    61: "FRA-Ligue 1",
    62: "FRA-Ligue 1",
    88: "NED-Eredivisie",
    94: "POR-Primeira Liga",
    144: "BEL-Jupiler Pro League",
    203: "TUR-Super Lig",
    253: "USA-MLS",
}

SUPPORTED_LEAGUE_IDS = frozenset(API_FOOTBALL_TO_UNDERSTAT.keys())

def understat_league(api_league_id: int | None) -> str | None:
    if api_league_id is None:
        return None
    return API_FOOTBALL_TO_UNDERSTAT.get(int(api_league_id))
