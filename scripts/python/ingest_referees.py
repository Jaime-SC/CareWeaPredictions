#!/usr/bin/env python3
"""
Ingest referee card/foul stats for all 35 ALLOWED_LEAGUES competitions.

Sync league IDs with config/allowed-leagues.ts (ALLOWED_LEAGUES).
Upserts: RefereeProfile, RefereeLeagueStat, CompetitionCardBaseline,
         RefereeMatchRecord.

Usage:
  python scripts/python/ingest_referees.py --season 2024
  python scripts/python/ingest_referees.py --league 39 140 --season 2023 2024 --max-calls 200
  python scripts/python/ingest_referees.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    psycopg2 = None  # type: ignore

# sync with ALLOWED_LEAGUES in config/allowed-leagues.ts
ALL_WHITELIST_LEAGUE_IDS: list[int] = [
    2, 3, 11, 13, 16, 39, 40, 45, 48, 61, 62, 66, 71, 72, 73, 78, 79, 81,
    128, 129, 130, 135, 136, 137, 140, 141, 143, 253, 262, 265, 266, 267, 779, 848,
]

# AllowedLeagueRegion slug per league id
LEAGUE_REGION: dict[int, str] = {
    39: "europe-top3-and-2nd", 40: "europe-top3-and-2nd", 45: "europe-top3-and-2nd",
    48: "europe-top3-and-2nd", 140: "europe-top3-and-2nd", 141: "europe-top3-and-2nd",
    143: "europe-top3-and-2nd", 135: "europe-top3-and-2nd", 136: "europe-top3-and-2nd",
    137: "europe-top3-and-2nd", 61: "europe-top3-and-2nd", 62: "europe-top3-and-2nd",
    66: "europe-top3-and-2nd", 78: "europe-top3-and-2nd", 79: "europe-top3-and-2nd",
    81: "europe-top3-and-2nd",
    2: "uefa", 3: "uefa", 848: "uefa",
    71: "south-america-eligible-divisions", 72: "south-america-eligible-divisions",
    73: "south-america-eligible-divisions", 128: "south-america-eligible-divisions",
    129: "south-america-eligible-divisions", 130: "south-america-eligible-divisions",
    265: "south-america-eligible-divisions", 266: "south-america-eligible-divisions",
    267: "south-america-eligible-divisions",
    13: "conmebol", 11: "conmebol",
    262: "concacaf", 253: "concacaf", 16: "concacaf", 779: "concacaf",
}

GLOBAL_YELLOW_BASELINE = 3.8
STRICTNESS_MIN = 0.6
STRICTNESS_MAX = 1.6
API_BASE = "https://v3.football.api-sports.io"
DEFAULT_SEASON = 2024


def sanitize_pg_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.query:
        return url
    drop = {"pgbouncer", "connection_limit"}
    qs = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() not in drop]
    return urlunparse(parsed._replace(query=urlencode(qs)))


def clamp_strictness(v: float) -> float:
    return max(STRICTNESS_MIN, min(STRICTNESS_MAX, v))


def api_get(path: str, params: dict[str, Any], api_key: str) -> dict[str, Any]:
    headers = {"x-apisports-key": api_key}
    url = f"{API_BASE}/{path.lstrip('/')}"
    for attempt in range(3):
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        if resp.status_code == 429:
            wait = 10 * (attempt + 1)
            print(f"  [rate-limit] waiting {wait}s...", flush=True)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()  # type: ignore[return-value]
    raise RuntimeError(f"API-Football request failed: {path}")


def fetch_all_fixtures(league: int, season: int, api_key: str) -> list[dict[str, Any]]:
    data = api_get(
        "fixtures",
        {"league": league, "season": season, "status": "FT"},
        api_key,
    )
    results: list[dict[str, Any]] = data.get("response", [])
    errors = data.get("errors", {})
    if errors:
        print(f"  [warn] API errors league {league}/{season}: {errors}", flush=True)
    print(f"  [league {league}/{season}] {len(results)} fixtures", flush=True)
    return results


def fetch_fixture_statistics(fixture_id: int, api_key: str) -> list[dict[str, Any]]:
    data = api_get("fixtures/statistics", {"fixture": fixture_id}, api_key)
    return data.get("response", [])


def parse_fixture_stats(fx: dict[str, Any]) -> dict[str, float | None]:
    stats_arr: list[dict[str, Any]] = fx.get("statistics", [])
    home_yellow = away_yellow = home_red = away_red = home_fouls = away_fouls = None
    home_pen = away_pen = None

    for team_stats in stats_arr:
        stat_list: list[dict[str, Any]] = team_stats.get("statistics", [])
        by_type = {s["type"]: s.get("value") for s in stat_list}

        def safe(v: Any) -> float | None:
            try:
                return float(v) if v is not None else None
            except (TypeError, ValueError):
                return None

        is_home = team_stats.get("team", {}).get("id") == fx.get("teams", {}).get("home", {}).get("id")
        if is_home:
            home_yellow = safe(by_type.get("Yellow Cards"))
            home_red = safe(by_type.get("Red Cards"))
            home_fouls = safe(by_type.get("Fouls"))
            home_pen = safe(by_type.get("Penalty")) or safe(by_type.get("Penalties"))
        else:
            away_yellow = safe(by_type.get("Yellow Cards"))
            away_red = safe(by_type.get("Red Cards"))
            away_fouls = safe(by_type.get("Fouls"))
            away_pen = safe(by_type.get("Penalty")) or safe(by_type.get("Penalties"))

    return {
        "yellow": (home_yellow or 0) + (away_yellow or 0) if (home_yellow is not None or away_yellow is not None) else None,
        "red": (home_red or 0) + (away_red or 0) if (home_red is not None or away_red is not None) else None,
        "fouls": (home_fouls or 0) + (away_fouls or 0) if (home_fouls is not None or away_fouls is not None) else None,
        "penalties": (home_pen or 0) + (away_pen or 0) if (home_pen is not None or away_pen is not None) else None,
    }


@dataclass
class MatchRow:
    referee: str
    league_id: int
    fixture_id: int
    match_date: str
    yellow: float
    red: float
    fouls: float
    penalties: float


@dataclass
class IngestBundle:
    matches: list[MatchRow] = field(default_factory=list)
    league_yellows: dict[int, list[float]] = field(default_factory=lambda: defaultdict(list))
    league_reds: dict[int, list[float]] = field(default_factory=lambda: defaultdict(list))
    league_fouls: dict[int, list[float]] = field(default_factory=lambda: defaultdict(list))
    league_penalties: dict[int, list[float]] = field(default_factory=lambda: defaultdict(list))


def enrich_and_collect(
    fixtures: list[dict[str, Any]],
    api_key: str,
    max_calls: int,
) -> IngestBundle:
    bundle = IngestBundle()
    calls = 0

    for fx in fixtures:
        if calls >= max_calls:
            print(f"  [quota] max_calls={max_calls} reached", flush=True)
            break

        referee_raw: str | None = fx.get("fixture", {}).get("referee")
        if not referee_raw:
            continue
        referee = referee_raw.split(",")[0].strip()
        if not referee:
            continue

        fixture_id = fx.get("fixture", {}).get("id")
        if not fixture_id:
            continue

        league_id = int(fx.get("league", {}).get("id") or 0)
        if league_id not in ALL_WHITELIST_LEAGUE_IDS:
            continue

        stats = fetch_fixture_statistics(fixture_id, api_key)
        calls += 1
        time.sleep(0.25)

        if not stats:
            continue

        fx_copy = dict(fx)
        fx_copy["statistics"] = stats
        parsed = parse_fixture_stats(fx_copy)
        if parsed["yellow"] is None:
            continue

        match_date = fx.get("fixture", {}).get("date") or ""
        bundle.matches.append(
            MatchRow(
                referee=referee,
                league_id=league_id,
                fixture_id=int(fixture_id),
                match_date=match_date,
                yellow=float(parsed["yellow"]),
                red=float(parsed["red"] or 0),
                fouls=float(parsed["fouls"] or 0),
                penalties=float(parsed["penalties"] or 0),
            )
        )
        bundle.league_yellows[league_id].append(float(parsed["yellow"]))
        bundle.league_reds[league_id].append(float(parsed["red"] or 0))
        bundle.league_fouls[league_id].append(float(parsed["fouls"] or 0))
        bundle.league_penalties[league_id].append(float(parsed["penalties"] or 0))

    print(f"  [enrich] {calls} API calls, {len(bundle.matches)} match rows", flush=True)
    return bundle


def build_payload(bundle: IngestBundle) -> dict[str, Any]:
    # Competition baselines
    baselines: list[dict[str, Any]] = []
    league_baseline_yellow: dict[int, float] = {}
    for lid, yellows in bundle.league_yellows.items():
        if not yellows:
            continue
        avg_y = sum(yellows) / len(yellows)
        league_baseline_yellow[lid] = avg_y
        baselines.append({
            "leagueId": lid,
            "region": LEAGUE_REGION.get(lid, "unknown"),
            "avgYellowCards": round(avg_y, 4),
            "avgRedCards": round(sum(bundle.league_reds[lid]) / len(bundle.league_reds[lid]), 4),
            "avgFoulsPerMatch": round(sum(bundle.league_fouls[lid]) / len(bundle.league_fouls[lid]), 4),
            "avgPenalties": round(sum(bundle.league_penalties[lid]) / len(bundle.league_penalties[lid]), 4) if bundle.league_penalties[lid] else 0,
            "matchCount": len(yellows),
        })

    # Per-referee aggregation
    by_ref: dict[str, list[MatchRow]] = defaultdict(list)
    for m in bundle.matches:
        by_ref[m.referee].append(m)

    profiles: list[dict[str, Any]] = []
    league_stats: list[dict[str, Any]] = []
    match_records: list[dict[str, Any]] = []

    for name, rows in by_ref.items():
        avg_y = sum(r.yellow for r in rows) / len(rows)
        avg_r = sum(r.red for r in rows) / len(rows)
        avg_f = sum(r.fouls for r in rows) / len(rows)
        avg_p = sum(r.penalties for r in rows) / len(rows)
        global_strict = clamp_strictness(avg_y / GLOBAL_YELLOW_BASELINE)

        profiles.append({
            "name": name,
            "avgYellowCards": round(avg_y, 4),
            "avgRedCards": round(avg_r, 4),
            "avgFoulsPerMatch": round(avg_f, 4),
            "avgPenalties": round(avg_p, 4),
            "strictnessIndex": round(global_strict, 4),
            "matchCount": len(rows),
        })

        by_league: dict[int, list[MatchRow]] = defaultdict(list)
        for r in rows:
            by_league[r.league_id].append(r)

        for lid, lrows in by_league.items():
            l_avg_y = sum(r.yellow for r in lrows) / len(lrows)
            baseline = league_baseline_yellow.get(lid, GLOBAL_YELLOW_BASELINE)
            league_stats.append({
                "refereeName": name,
                "leagueId": lid,
                "region": LEAGUE_REGION.get(lid, "unknown"),
                "avgYellowCards": round(l_avg_y, 4),
                "avgRedCards": round(sum(r.red for r in lrows) / len(lrows), 4),
                "avgFoulsPerMatch": round(sum(r.fouls for r in lrows) / len(lrows), 4),
                "avgPenalties": round(sum(r.penalties for r in lrows) / len(lrows), 4),
                "matchCount": len(lrows),
                "strictnessIndex": round(clamp_strictness(l_avg_y / baseline), 4),
            })

        for r in rows:
            match_records.append({
                "refereeName": name,
                "leagueId": r.league_id,
                "apiFixtureId": r.fixture_id,
                "matchDate": r.match_date,
                "yellowCards": r.yellow,
                "redCards": r.red,
                "fouls": r.fouls,
                "penalties": r.penalties,
            })

        print(
            f"  {name}: n={len(rows)} yellow={avg_y:.2f} strictness={global_strict:.3f}",
            flush=True,
        )

    return {
        "profiles": profiles,
        "leagueStats": league_stats,
        "baselines": baselines,
        "matchRecords": match_records,
    }


def upsert_via_neon_http(payload: dict[str, Any], pooled_url: str) -> None:
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    tmp_path = os.path.join(project_root, "_referee_upsert_v2.cjs")
    node_code = """
const { neon } = require('@neondatabase/serverless');
const payload = JSON.parse(process.argv[2]);
async function main() {
  const sql = neon(process.env.DATABASE_URL);
  for (const p of payload.profiles) {
    const rows = await sql`
      INSERT INTO "RefereeProfile"
        (id, name, "avgYellowCards", "avgRedCards", "avgFoulsPerMatch", "avgPenalties",
         "strictnessIndex", "matchCount", "updatedAt")
      VALUES
        (gen_random_uuid()::text, ${p.name}, ${p.avgYellowCards}, ${p.avgRedCards},
         ${p.avgFoulsPerMatch}, ${p.avgPenalties}, ${p.strictnessIndex}, ${p.matchCount}, NOW())
      ON CONFLICT (name) DO UPDATE SET
        "avgYellowCards" = EXCLUDED."avgYellowCards",
        "avgRedCards" = EXCLUDED."avgRedCards",
        "avgFoulsPerMatch" = EXCLUDED."avgFoulsPerMatch",
        "avgPenalties" = EXCLUDED."avgPenalties",
        "strictnessIndex" = EXCLUDED."strictnessIndex",
        "matchCount" = EXCLUDED."matchCount",
        "updatedAt" = NOW()
      RETURNING id, name
    `;
    const refereeId = rows[0].id;
    const leagueRows = payload.leagueStats.filter((ls) => ls.refereeName === p.name);
    for (const ls of leagueRows) {
      await sql`
        INSERT INTO "RefereeLeagueStat"
          (id, "refereeId", "leagueId", region, "avgYellowCards", "avgRedCards",
           "avgFoulsPerMatch", "avgPenalties", "matchCount", "strictnessIndex", "updatedAt")
        VALUES
          (gen_random_uuid()::text, ${refereeId}, ${ls.leagueId}, ${ls.region},
           ${ls.avgYellowCards}, ${ls.avgRedCards}, ${ls.avgFoulsPerMatch}, ${ls.avgPenalties},
           ${ls.matchCount}, ${ls.strictnessIndex}, NOW())
        ON CONFLICT ("refereeId", "leagueId") DO UPDATE SET
          region = EXCLUDED.region,
          "avgYellowCards" = EXCLUDED."avgYellowCards",
          "avgRedCards" = EXCLUDED."avgRedCards",
          "avgFoulsPerMatch" = EXCLUDED."avgFoulsPerMatch",
          "avgPenalties" = EXCLUDED."avgPenalties",
          "matchCount" = EXCLUDED."matchCount",
          "strictnessIndex" = EXCLUDED."strictnessIndex",
          "updatedAt" = NOW()
      `;
    }
    const matchRows = payload.matchRecords.filter((m) => m.refereeName === p.name);
    for (const m of matchRows) {
      await sql`
        INSERT INTO "RefereeMatchRecord"
          (id, "refereeId", "leagueId", "apiFixtureId", "matchDate",
           "yellowCards", "redCards", fouls, penalties)
        VALUES
          (gen_random_uuid()::text, ${refereeId}, ${m.leagueId}, ${m.apiFixtureId},
           ${m.matchDate}::timestamptz, ${m.yellowCards}, ${m.redCards}, ${m.fouls}, ${m.penalties})
        ON CONFLICT ("apiFixtureId") DO UPDATE SET
          "yellowCards" = EXCLUDED."yellowCards",
          "redCards" = EXCLUDED."redCards",
          fouls = EXCLUDED.fouls,
          penalties = EXCLUDED.penalties,
          "matchDate" = EXCLUDED."matchDate"
      `;
    }
  }
  for (const b of payload.baselines) {
    await sql`
      INSERT INTO "CompetitionCardBaseline"
        ("leagueId", region, "avgYellowCards", "avgRedCards", "avgFoulsPerMatch",
         "avgPenalties", "matchCount", "updatedAt")
      VALUES
        (${b.leagueId}, ${b.region}, ${b.avgYellowCards}, ${b.avgRedCards},
         ${b.avgFoulsPerMatch}, ${b.avgPenalties}, ${b.matchCount}, NOW())
      ON CONFLICT ("leagueId") DO UPDATE SET
        region = EXCLUDED.region,
        "avgYellowCards" = EXCLUDED."avgYellowCards",
        "avgRedCards" = EXCLUDED."avgRedCards",
        "avgFoulsPerMatch" = EXCLUDED."avgFoulsPerMatch",
        "avgPenalties" = EXCLUDED."avgPenalties",
        "matchCount" = EXCLUDED."matchCount",
        "updatedAt" = NOW()
    `;
  }
  console.log('upserted', payload.profiles.length, 'referees,',
    payload.baselines.length, 'baselines,', payload.matchRecords.length, 'match records');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
"""
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(node_code)
    try:
        env = os.environ.copy()
        env["DATABASE_URL"] = pooled_url
        result = subprocess.run(
            ["node", "_referee_upsert_v2.cjs", json.dumps(payload)],
            capture_output=True,
            text=True,
            env=env,
            timeout=300,
            cwd=project_root,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip())
        print(f"  {result.stdout.strip()}", flush=True)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest referee stats for all whitelist leagues")
    parser.add_argument(
        "--league", type=int, nargs="*",
        help="League ID(s); default = all 35 whitelist leagues",
    )
    parser.add_argument("--season", type=int, nargs="+", default=[DEFAULT_SEASON])
    parser.add_argument("--max-calls", type=int, default=120,
                        help="Max API-Football statistics calls per run")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    leagues = args.league if args.league else ALL_WHITELIST_LEAGUE_IDS

    api_key = (
        os.environ.get("FOOTBALL_API_KEY")
        or os.environ.get("API_FOOTBALL_KEY")
        or os.environ.get("APIFOOTBALL_KEY")
    )
    if not api_key:
        print("ERROR: FOOTBALL_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    database_url = os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL")
    if not database_url and not args.dry_run:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    all_fixtures: list[dict[str, Any]] = []
    for league in leagues:
        for season in args.season:
            print(f"\n[fetch] league={league} season={season}", flush=True)
            all_fixtures.extend(fetch_all_fixtures(league, season, api_key))

    print(f"\n[enrich] up to {args.max_calls} statistics calls across {len(all_fixtures)} fixtures", flush=True)
    bundle = enrich_and_collect(all_fixtures, api_key, args.max_calls)

    print(f"\n[aggregate] {len(bundle.matches)} matches with card data", flush=True)
    payload = build_payload(bundle)
    print(
        f"[aggregate] {len(payload['profiles'])} referees, "
        f"{len(payload['baselines'])} league baselines",
        flush=True,
    )

    if not payload["profiles"]:
        print("[warn] no referee data extracted", flush=True)
        return

    if args.dry_run:
        print("[dry-run] sample profile:", payload["profiles"][0])
        return

    pooled = os.environ.get("DATABASE_URL") or database_url or ""
    upsert_via_neon_http(payload, pooled)


if __name__ == "__main__":
    main()
