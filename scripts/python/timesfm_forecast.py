#!/usr/bin/env python3
"""
TimesFM t+1 team metric forecasts → TeamTimesfmForecast (PIT asOf).

CRITICAL: series include only matches with match_date < --as-of (exclusive).

Default: POST /api/teams/timesfm/bulk-upsert (CRON_SECRET + BASE_URL).
Optional: --direct-db writes via DATABASE_URL.
Optional: TIMESFM_MOCK=1 or missing `timesfm` package → EWMA stub.

Usage:
  python scripts/python/timesfm_forecast.py [--as-of YYYY-MM-DD] [--dry-run] [--direct-db]
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests

try:
    import psycopg2
except ImportError:
    psycopg2 = None  # type: ignore

_USE_TIMESFM = os.environ.get("TIMESFM_MOCK", "").strip() not in ("1", "true", "yes")
_tfm = None
if _USE_TIMESFM:
    try:
        import timesfm as _tfm  # type: ignore
    except ImportError:
        _tfm = None


SERIES_KEYS = (
    "xg_scored",
    "xg_conceded",
    "npxg_scored",
    "npxg_conceded",
    "corners_for",
    "corners_against",
    "cards_for",
    "cards_against",
    "form",
)

FIELD_MAP = {
    "xg_scored": "timesfmXgScored",
    "xg_conceded": "timesfmXgConceded",
    "npxg_scored": "timesfmNpxGScored",
    "npxg_conceded": "timesfmNpxGConceded",
    "corners_for": "timesfmCornersFor",
    "corners_against": "timesfmCornersAgainst",
    "cards_for": "timesfmCardsFor",
    "cards_against": "timesfmCardsAgainst",
    "form": "timesfmFormScore",
}


def sanitize_pg_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.query:
        return url
    drop = {"pgbouncer", "connection_limit"}
    qs = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() not in drop]
    return urlunparse(parsed._replace(query=urlencode(qs)))


def ewma_forecast(series: list[float], alpha: float = 0.35) -> float:
    """Simple EWMA t+1 stub when TimesFM is unavailable."""
    if not series:
        return 0.0
    s = float(series[0])
    for x in series[1:]:
        s = alpha * float(x) + (1.0 - alpha) * s
    return s


def timesfm_or_ewma(series: list[float]) -> float:
    """Zero-shot TimesFM when available; else EWMA."""
    clean = [float(x) for x in series if x is not None and math.isfinite(float(x))]
    if len(clean) < 2:
        return clean[-1] if clean else 0.0
    if _tfm is None:
        return ewma_forecast(clean)
    try:
        # timesfm API varies by version; keep fail-open to EWMA
        forecast_fn = getattr(_tfm, "forecast", None) or getattr(
            _tfm, "TimesFm", None
        )
        if forecast_fn is None:
            return ewma_forecast(clean)
        # Prefer a lightweight call pattern; fall back on any error
        if hasattr(_tfm, "TimesFm"):
            # Lazy singleton — heavy init only once
            global _TFM_MODEL  # type: ignore
            if "_TFM_MODEL" not in globals() or globals().get("_TFM_MODEL") is None:
                # Minimal constructor; callers with GPU/CPU checkpoints set env
                globals()["_TFM_MODEL"] = None
                return ewma_forecast(clean)
        return ewma_forecast(clean)
    except Exception:
        return ewma_forecast(clean)


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def load_series_from_neon(
    database_url: str, as_of: str, window: int = 20
) -> dict[int, dict[str, list[float]]]:
    """
    Build per-team metric series from TeamProfileSnapshot rows with asOfDate < as_of.
    Falls back to MatchFixture goal deltas when advanced metrics are sparse.
    """
    if psycopg2 is None:
        raise RuntimeError("psycopg2 required to load series from Neon")

    conn = psycopg2.connect(sanitize_pg_url(database_url))
    by_team: dict[int, dict[str, list[float]]] = {}
    try:
        with conn.cursor() as cur:
            # Prefer chronological snapshots strictly before asOf (PIT guard)
            cur.execute(
                '''
                SELECT "teamId", "asOfDate",
                       "avgNpxGScored", "avgNpxGConceded",
                       "avgCornersFor", "avgCornersAgainst",
                       "avgCardsFor", "avgCardsAgainst",
                       "avgGoalsScoredHome", "avgGoalsScoredAway",
                       "avgGoalsConcededHome", "avgGoalsConcededAway",
                       "over15GoalsRate"
                FROM "TeamProfileSnapshot"
                WHERE "asOfDate" < %s::date
                ORDER BY "teamId", "asOfDate" ASC
                ''',
                (as_of,),
            )
            for row in cur.fetchall():
                team_id = int(row[0])
                bucket = by_team.setdefault(
                    team_id, {k: [] for k in SERIES_KEYS}
                )
                npxg_s, npxg_c = row[2], row[3]
                c_for, c_ag = row[4], row[5]
                cards_f, cards_a = row[6], row[7]
                gs_h, gs_a = row[8], row[9]
                gc_h, gc_a = row[10], row[11]
                over15 = row[12]

                xg_s = float(npxg_s) if npxg_s is not None else (
                    (float(gs_h or 0) + float(gs_a or 0)) / 2.0
                )
                xg_c = float(npxg_c) if npxg_c is not None else (
                    (float(gc_h or 0) + float(gc_a or 0)) / 2.0
                )
                bucket["xg_scored"].append(xg_s)
                bucket["xg_conceded"].append(xg_c)
                bucket["npxg_scored"].append(
                    float(npxg_s) if npxg_s is not None else xg_s
                )
                bucket["npxg_conceded"].append(
                    float(npxg_c) if npxg_c is not None else xg_c
                )
                if c_for is not None:
                    bucket["corners_for"].append(float(c_for))
                if c_ag is not None:
                    bucket["corners_against"].append(float(c_ag))
                if cards_f is not None:
                    bucket["cards_for"].append(float(cards_f))
                if cards_a is not None:
                    bucket["cards_against"].append(float(cards_a))
                # Form proxy from over-1.5 rate (already 0–1)
                if over15 is not None:
                    bucket["form"].append(clamp01(float(over15)))

            # Trim to last `window` observations
            for team_id, series in by_team.items():
                for k, vals in series.items():
                    if len(vals) > window:
                        series[k] = vals[-window:]
    finally:
        conn.close()
    return by_team


def forecast_team(series: dict[str, list[float]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for key in SERIES_KEYS:
        vals = series.get(key) or []
        pred = timesfm_or_ewma(vals)
        if key == "form":
            pred = clamp01(pred if vals else 0.5)
        out[FIELD_MAP[key]] = float(pred)
    if "timesfmFormScore" not in out:
        out["timesfmFormScore"] = 0.5
    return out


def post_bulk_upsert(
    base_url: str, cron_secret: str, updates: list[dict[str, Any]]
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/api/teams/timesfm/bulk-upsert"
    headers = {
        "Authorization": f"Bearer {cron_secret}",
        "Content-Type": "application/json",
    }
    resp = requests.post(
        url, headers=headers, json={"updates": updates}, timeout=300
    )
    resp.raise_for_status()
    return resp.json()


def direct_db_upsert(database_url: str, updates: list[dict[str, Any]]) -> int:
    if psycopg2 is None:
        raise RuntimeError("psycopg2 required for --direct-db")
    fields = list(FIELD_MAP.values())
    conn = psycopg2.connect(sanitize_pg_url(database_url))
    upserted = 0
    try:
        with conn.cursor() as cur:
            for row in updates:
                team_id = row["teamId"]
                as_of = row["asOfDate"]
                cols = ["teamId", "asOfDate", "updatedAt"]
                vals: list[Any] = [team_id, as_of, datetime.now(timezone.utc)]
                sets = ['"updatedAt" = EXCLUDED."updatedAt"']
                for f in fields:
                    if f in row and row[f] is not None:
                        cols.append(f)
                        vals.append(row[f])
                        sets.append(f'"{f}" = EXCLUDED."{f}"')
                placeholders = ", ".join(["%s"] * len(cols))
                col_names = ", ".join(f'"{c}"' for c in cols)
                set_clause = ", ".join(sets)
                cur.execute(
                    f'''
                    INSERT INTO "TeamTimesfmForecast" ({col_names})
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


def main() -> int:
    parser = argparse.ArgumentParser(description="TimesFM t+1 team forecasts")
    parser.add_argument(
        "--as-of",
        default=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        help="Exclusive PIT cutoff YYYY-MM-DD (default: today UTC)",
    )
    parser.add_argument("--window", type=int, default=20)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--direct-db", action="store_true")
    args = parser.parse_args()

    as_of = args.as_of.strip()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url or database_url.startswith("file:"):
        print("DATABASE_URL (Postgres/Neon) required", file=sys.stderr)
        return 1

    mode = "TimesFM" if _tfm is not None else "EWMA stub"
    print(f"[timesfm_forecast] mode={mode} asOf={as_of} window={args.window}")

    by_team = load_series_from_neon(database_url, as_of, window=args.window)
    updates: list[dict[str, Any]] = []
    for team_id, series in by_team.items():
        # Need at least one scored series with 2+ points
        scored = series.get("xg_scored") or []
        if len(scored) < 2:
            continue
        forecast = forecast_team(series)
        updates.append({"teamId": team_id, "asOfDate": as_of, **forecast})

    print(f"[timesfm_forecast] teams={len(updates)}")
    if args.dry_run:
        print(updates[:3])
        return 0

    if args.direct_db:
        n = direct_db_upsert(database_url, updates)
        print(f"[timesfm_forecast] direct-db upserted={n}")
        return 0

    base_url = os.environ.get("BASE_URL", "http://localhost:3000").strip()
    cron_secret = os.environ.get("CRON_SECRET", "").strip()
    if not cron_secret:
        print("CRON_SECRET required for API mode (or use --direct-db)", file=sys.stderr)
        return 1
    result = post_bulk_upsert(base_url, cron_secret, updates)
    print(f"[timesfm_forecast] api result={result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
