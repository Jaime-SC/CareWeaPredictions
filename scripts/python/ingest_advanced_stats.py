#!/usr/bin/env python3
"""
Ingest advanced team metrics (npxG, PPDA, corners, cards) into TeamProfile.

Default: POST /api/teams/profiles/bulk-update (CRON_SECRET + BASE_URL).
Optional: --direct-db writes via DATABASE_URL.

Usage:
  python scripts/python/ingest_advanced_stats.py [--dry-run] [--direct-db]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from typing import Any

import pandas as pd
import requests

from league_map import SUPPORTED_LEAGUE_IDS, understat_league

try:
    import soccerdata as sd
except ImportError:
    sd = None  # type: ignore

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    psycopg2 = None  # type: ignore


from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


def sanitize_pg_url(url: str) -> str:
    """Strip query params psycopg2 rejects (e.g. Neon pgbouncer=true)."""
    parsed = urlparse(url)
    if not parsed.query:
        return url
    drop = {"pgbouncer", "connection_limit"}
    qs = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() not in drop]
    return urlunparse(parsed._replace(query=urlencode(qs)))


def normalize_name(name: str) -> str:
    text = unicodedata.normalize("NFD", name or "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
    return text


def load_teams_direct_db(database_url: str) -> list[dict[str, Any]]:
    if psycopg2 is None:
        raise RuntimeError("psycopg2 required for --direct-db")
    conn = psycopg2.connect(sanitize_pg_url(database_url))
    try:
        with conn.cursor() as cur:
            cur.execute(
                '''
                SELECT "teamId", "teamName", "primaryLeagueId"
                FROM "TeamProfile"
                WHERE "primaryLeagueId" IS NOT NULL
                '''
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [
        {"teamId": r[0], "teamName": r[1], "primaryLeagueId": r[2]}
        for r in rows
    ]


def load_teams_api(base_url: str, cron_secret: str) -> list[dict[str, Any]]:
    url = f"{base_url.rstrip('/')}/api/teams/profiles?limit=500"
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    profiles = data.get("profiles", data) if isinstance(data, dict) else data
    if not isinstance(profiles, list):
        raise RuntimeError("unexpected profiles response shape")
    return [
        {
            "teamId": p["teamId"],
            "teamName": p.get("teamName", ""),
            "primaryLeagueId": p.get("primaryLeagueId"),
        }
        for p in profiles
        if p.get("primaryLeagueId") in SUPPORTED_LEAGUE_IDS
    ]


def fetch_understat_team_stats(league_code: str) -> pd.DataFrame:
    if sd is None:
        raise RuntimeError("soccerdata not installed; pip install -r scripts/python/requirements.txt")
    us = sd.Understat(leagues=league_code)
    df = us.read_team_match_stats()
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.index, pd.MultiIndex):
        df = df.reset_index()
    return df


def aggregate_team_row(group: pd.DataFrame) -> dict[str, float | None]:
    def mean_col(col: str) -> float | None:
        if col not in group.columns:
            return None
        s = pd.to_numeric(group[col], errors="coerce").dropna()
        return float(s.mean()) if len(s) else None

    scored = mean_col("npxG") or mean_col("xG")
    conceded = mean_col("npxGA") or mean_col("xGA")
    ppda = mean_col("ppda") or mean_col("PPDA")
    corners_for = mean_col("corners") or mean_col("Corners")
    cards_for = mean_col("yellow_cards") or mean_col("Yellow cards")

    out: dict[str, float | None] = {}
    if scored is not None:
        out["avgNpxGScored"] = round(scored, 4)
    if conceded is not None:
        out["avgNpxGConceded"] = round(conceded, 4)
    if ppda is not None:
        out["avgPPDA"] = round(ppda, 4)
    if corners_for is not None:
        out["avgCornersFor"] = round(corners_for, 4)
        out["avgCornersAgainst"] = round(corners_for, 4)
    if cards_for is not None:
        out["avgCardsFor"] = round(cards_for, 4)
        out["avgCardsAgainst"] = round(cards_for, 4)
    return out


def match_stats_to_teams(
    teams: list[dict[str, Any]], stats_by_league: dict[str, pd.DataFrame]
) -> list[dict[str, Any]]:
    updates: list[dict[str, Any]] = []
    name_index: dict[str, dict[str, Any]] = {}
    for t in teams:
        key = normalize_name(t["teamName"])
        if key:
            name_index[key] = t

    for league_id, df in stats_by_league.items():
        if df.empty:
            continue
        team_col = None
        for c in ("team", "Team", "team_name", "home_team"):
            if c in df.columns:
                team_col = c
                break
        if team_col is None:
            continue
        for team_name, group in df.groupby(team_col):
            key = normalize_name(str(team_name))
            target = name_index.get(key)
            if target is None:
                for k, row in name_index.items():
                    if key in k or k in key:
                        target = row
                        break
            if target is None:
                continue
            metrics = aggregate_team_row(group)
            if not metrics:
                continue
            updates.append(
                {
                    "teamId": target["teamId"],
                    "teamName": target["teamName"],
                    "primaryLeagueId": target.get("primaryLeagueId"),
                    **metrics,
                }
            )
    return updates


def _match_date_series(df: pd.DataFrame) -> pd.Series | None:
    for col in ("date", "Date", "datetime", "match_date"):
        if col in df.columns:
            return pd.to_datetime(df[col], errors="coerce")
    return None


def snapshot_updates_from_df(
    teams: list[dict[str, Any]], stats_by_league: dict[str, pd.DataFrame]
) -> list[dict[str, Any]]:
    """Point-in-time advanced metrics: one row per team per unique match date."""
    snapshots: list[dict[str, Any]] = []
    name_index: dict[str, dict[str, Any]] = {}
    for t in teams:
        key = normalize_name(t["teamName"])
        if key:
            name_index[key] = t

    for _league_id, df in stats_by_league.items():
        if df.empty:
            continue
        team_col = None
        for c in ("team", "Team", "team_name", "home_team"):
            if c in df.columns:
                team_col = c
                break
        dates = _match_date_series(df)
        if team_col is None or dates is None:
            continue
        work = df.copy()
        work["_asof"] = dates.dt.normalize()
        unique_dates = sorted(work["_asof"].dropna().unique())
        for as_of in unique_dates:
            prior = work[work["_asof"] < as_of]
            if prior.empty:
                continue
            as_of_str = pd.Timestamp(as_of).strftime("%Y-%m-%d")
            for team_name, group in prior.groupby(team_col):
                key = normalize_name(str(team_name))
                target = name_index.get(key)
                if target is None:
                    for k, row in name_index.items():
                        if key in k or k in key:
                            target = row
                            break
                if target is None:
                    continue
                metrics = aggregate_team_row(group)
                if not metrics:
                    continue
                snapshots.append(
                    {
                        "teamId": target["teamId"],
                        "asOfDate": as_of_str,
                        "teamName": target["teamName"],
                        "primaryLeagueId": target.get("primaryLeagueId"),
                        **metrics,
                    }
                )
    return snapshots


def post_snapshot_bulk(
    base_url: str, cron_secret: str, updates: list[dict[str, Any]]
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/api/teams/profiles/snapshot-bulk"
    headers = {
        "Authorization": f"Bearer {cron_secret}",
        "Content-Type": "application/json",
    }
    resp = requests.post(
        url, headers=headers, json={"updates": updates}, timeout=300
    )
    resp.raise_for_status()
    return resp.json()


def direct_db_snapshot_update(
    database_url: str, updates: list[dict[str, Any]]
) -> int:
    if psycopg2 is None:
        raise RuntimeError("psycopg2 required for --direct-db")
    fields = [
        "teamName",
        "primaryLeagueId",
        "avgNpxGScored",
        "avgNpxGConceded",
        "avgPPDA",
        "avgCornersFor",
        "avgCornersAgainst",
        "avgCardsFor",
        "avgCardsAgainst",
    ]
    conn = psycopg2.connect(sanitize_pg_url(database_url))
    upserted = 0
    try:
        with conn.cursor() as cur:
            for row in updates:
                team_id = row["teamId"]
                as_of = row["asOfDate"]
                cols = ["teamId", "asOfDate"]
                vals: list[Any] = [team_id, as_of]
                sets = []
                for f in fields:
                    if f in row and row[f] is not None:
                        cols.append(f)
                        vals.append(row[f])
                        sets.append(f'"{f}" = EXCLUDED."{f}"')
                if len(vals) <= 2:
                    continue
                placeholders = ", ".join(["%s"] * len(cols))
                col_names = ", ".join(f'"{c}"' for c in cols)
                set_clause = ", ".join(sets) if sets else '"teamId" = EXCLUDED."teamId"'
                cur.execute(
                    f'''
                    INSERT INTO "TeamProfileSnapshot" ({col_names})
                    VALUES ({placeholders})
                    ON CONFLICT ("teamId", "asOfDate") DO UPDATE SET {set_clause}
                    ''',
                    vals,
                )
                upserted += 1
        conn.commit()
    finally:
        conn.close()
    return upserted


def post_bulk_update(
    base_url: str, cron_secret: str, updates: list[dict[str, Any]]
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/api/teams/profiles/bulk-update"
    headers = {
        "Authorization": f"Bearer {cron_secret}",
        "Content-Type": "application/json",
    }
    resp = requests.post(
        url, headers=headers, json={"updates": updates}, timeout=120
    )
    resp.raise_for_status()
    return resp.json()


def direct_db_update(database_url: str, updates: list[dict[str, Any]]) -> int:
    if psycopg2 is None:
        raise RuntimeError("psycopg2 required for --direct-db")
    fields = [
        "avgNpxGScored",
        "avgNpxGConceded",
        "avgPPDA",
        "avgCornersFor",
        "avgCornersAgainst",
        "avgCardsFor",
        "avgCardsAgainst",
    ]
    conn = psycopg2.connect(sanitize_pg_url(database_url))
    updated = 0
    try:
        with conn.cursor() as cur:
            for row in updates:
                team_id = row["teamId"]
                sets = []
                vals: list[Any] = []
                for f in fields:
                    if f in row and row[f] is not None:
                        sets.append(f'"{f}" = %s')
                        vals.append(row[f])
                if not sets:
                    continue
                vals.append(team_id)
                cur.execute(
                    f'UPDATE "TeamProfile" SET {", ".join(sets)} WHERE "teamId" = %s',
                    vals,
                )
                if cur.rowcount:
                    updated += 1
        conn.commit()
    finally:
        conn.close()
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest advanced team metrics")
    parser.add_argument("--dry-run", action="store_true", help="fetch only, no write")
    parser.add_argument("--direct-db", action="store_true", help="write via DATABASE_URL")
    args = parser.parse_args()

    database_url = os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL", "").strip()
    base_url = os.environ.get("BASE_URL", "http://localhost:3000").strip()
    cron_secret = os.environ.get("CRON_SECRET", "").strip()

    if args.direct_db:
        if not database_url:
            print("DATABASE_URL required for --direct-db", file=sys.stderr)
            return 1
        teams = load_teams_direct_db(database_url)
    else:
        teams = load_teams_api(base_url, cron_secret)

    teams = [t for t in teams if t.get("primaryLeagueId") in SUPPORTED_LEAGUE_IDS]
    if not teams:
        print("No teams with supported leagues found")
        return 0

    league_codes = {
        lid: code
        for lid in {t["primaryLeagueId"] for t in teams}
        if (code := understat_league(lid))
    }

    stats_by_league: dict[str, pd.DataFrame] = {}
    for lid, code in league_codes.items():
        if code is None:
            continue
        try:
            stats_by_league[str(lid)] = fetch_understat_team_stats(code)
            print(f"Fetched Understat stats for league {lid} ({code})")
        except Exception as exc:
            print(f"WARN league {lid}: {exc}", file=sys.stderr)

    updates = match_stats_to_teams(teams, stats_by_league)
    snapshots = snapshot_updates_from_df(teams, stats_by_league)
    print(f"Prepared {len(updates)} team updates, {len(snapshots)} snapshots")

    if args.dry_run:
        print(json.dumps(updates[:5], indent=2))
        if snapshots:
            print(json.dumps(snapshots[:3], indent=2))
        return 0

    if not updates and not snapshots:
        print("Nothing to update")
        return 0

    if args.direct_db:
        n = direct_db_update(database_url, updates) if updates else 0
        sn = direct_db_snapshot_update(database_url, snapshots) if snapshots else 0
        print(f"Direct DB updated: {n}, snapshots: {sn}")
        return 0 if (n > 0 or sn > 0) else 1

    if not cron_secret:
        print("CRON_SECRET required for API mode", file=sys.stderr)
        return 1

    if updates:
        result = post_bulk_update(base_url, cron_secret, updates)
        print(json.dumps(result, indent=2))
    if snapshots:
        snap_result = post_snapshot_bulk(base_url, cron_secret, snapshots)
        print(json.dumps(snap_result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
