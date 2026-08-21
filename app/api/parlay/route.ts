import { NextRequest, NextResponse } from "next/server";
import {
  fetchUpcomingMatches,
  fetchMonopolyMatchPool,
  filterMatchesOnChileDate,
  FootballApiError,
  EMPTY_MATCHES_MESSAGE,
  toErrorResponse,
} from "@/lib/api-football";
import {
  FUN_MAX_DAYS_AHEAD,
  getStrategyPreset,
  isFunStrategy,
  isMonopolyStrategy,
  resolveStrategyMode,
} from "@/lib/parlay-defaults";
import { enrichMatchesFromLocalData } from "@/lib/fixture-context";
import {
  DEFAULT_TARGET_LEG_COUNT,
  filterEliteWhitelistMatches,
  formatParlayClipboard,
  generateParlay,
  singleDayShortfallNotice,
} from "@/lib/parlay-generator";
import {
  syncAutomatedTeamProfileFlags,
  warmTeamProfileCache,
} from "@/lib/team-profiler";
import type { Match } from "@/lib/types";
import { chileDateOffset, chileDateString } from "@/lib/utils";
import {
  getWeeklyDateRange,
  INSUFFICIENT_MATCHES_MESSAGE,
} from "@/lib/monopoly-engine";

/** Cache-first DT/absences → TeamProfile before Poisson in generateParlay. */
async function withAutomatedTeamProfiles(matches: Match[]): Promise<Match[]> {
  if (matches.length === 0) return matches;
  await syncAutomatedTeamProfileFlags(matches);
  await warmTeamProfileCache(matches.flatMap((m) => [m.home.id, m.away.id]));
  return matches;
}

/**
 * Body/query: { strategyMode, date, multiDay?: boolean }
 *
 * Default: STRICT single-date mode (no tomorrow leakage).
 * Opt-in: multiDay=true expands through +FUN_MAX_DAYS_AHEAD.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return buildAutoParlayResponse(
    body?.strategyMode,
    body?.date,
    body?.multiDay === true || body?.allowMultiDay === true,
    body?.ignoreRotationFilter === true
  );
}

export async function GET(request: NextRequest) {
  const strategyMode = request.nextUrl.searchParams.get("strategyMode");
  const date = request.nextUrl.searchParams.get("date");
  const multiDay =
    request.nextUrl.searchParams.get("multiDay") === "true" ||
    request.nextUrl.searchParams.get("allowMultiDay") === "true";
  const ignoreRotationFilter =
    request.nextUrl.searchParams.get("ignoreRotationFilter") === "true";
  return buildAutoParlayResponse(
    strategyMode,
    date,
    multiDay,
    ignoreRotationFilter
  );
}

async function fetchWideDay(date: string): Promise<{
  matches: Match[];
  daysFetched: number;
  poolMode: "core" | "expanded" | "wide" | null;
}> {
  const result = await fetchUpcomingMatches({
    date,
    poolMode: "expanded",
    includeOdds: true,
    requireOdds: true,
  });
  const scoped = filterMatchesOnChileDate(result.matches, date);
  const enriched = await enrichMatchesFromLocalData(scoped);
  return {
    matches: filterMatchesOnChileDate(enriched, date),
    daysFetched: result.daysFetched ?? 0,
    poolMode: result.poolMode ?? "expanded",
  };
}

/**
 * Single-date (default): only `primaryDate`, elite whitelist leagues/cups.
 * Multi-day (opt-in): primaryDate … +FUN_MAX_DAYS_AHEAD.
 */
async function loadParlayMatchPool(
  primaryDate: string,
  targetLegCount: number,
  allowMultiDay: boolean
): Promise<{
  matches: Match[];
  daysFetched: number;
  poolMode: "core" | "expanded" | "wide" | null;
  datesUsed: string[];
  source: "live";
  singleDayLocked: boolean;
}> {
  if (!allowMultiDay) {
    try {
      const day = await fetchWideDay(primaryDate);
      if (day.matches.length === 0) {
        throw new FootballApiError(
          EMPTY_MATCHES_MESSAGE,
          "EMPTY",
          404
        );
      }
      const matches = await withAutomatedTeamProfiles(
        day.matches.sort(
          (a, b) =>
            new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
        )
      );
      return {
        matches,
        daysFetched: day.daysFetched,
        poolMode: day.poolMode,
        datesUsed: [primaryDate],
        source: "live",
        singleDayLocked: true,
      };
    } catch (err) {
      if (err instanceof FootballApiError) throw err;
      throw err;
    }
  }

  const datesToTry = Array.from({ length: FUN_MAX_DAYS_AHEAD + 1 }, (_, i) =>
    chileDateOffset(i, primaryDate)
  );
  const seen = new Set<string>();
  const matches: Match[] = [];
  let daysFetched = 0;
  let poolMode: "core" | "expanded" | "wide" | null = null;
  const datesUsed: string[] = [];
  let lastError: unknown = null;
  const minPool = Math.max(targetLegCount, 15);

  for (const date of datesToTry) {
    if (matches.length >= minPool) break;
    try {
      const day = await fetchWideDay(date);
      daysFetched += day.daysFetched;
      poolMode = day.poolMode ?? poolMode;
      let added = 0;
      for (const m of day.matches) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        matches.push(m);
        added += 1;
      }
      if (added > 0) datesUsed.push(date);
    } catch (err) {
      if (err instanceof FootballApiError && err.code === "AUTH") throw err;
      lastError = err;
      console.warn(
        `[parlay] día ${date} omitido en ventana multi-día — se continúa`
      );
    }
  }

  if (matches.length === 0) {
    if (lastError) throw lastError;
    throw new FootballApiError(
      "Sin partidos con cuotas en la ventana multi-día.",
      "EMPTY",
      404
    );
  }

  matches.sort(
    (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
  );

  return {
    matches: await withAutomatedTeamProfiles(matches),
    daysFetched,
    poolMode,
    datesUsed,
    source: "live",
    singleDayLocked: false,
  };
}

async function buildMonopolyParlayResponse(ignoreRotationFilter: boolean) {
  const week = getWeeklyDateRange();
  const strategyMode = "monopoly-asymmetry" as const;
  const preset = getStrategyPreset(strategyMode);
  const { matches: rawMatches, daysFetched } = await fetchMonopolyMatchPool();
  const matches = await withAutomatedTeamProfiles(
    await enrichMatchesFromLocalData(rawMatches)
  );

  const parlay = generateParlay(matches, { ...preset, ignoreRotationFilter });
  const clipboard = formatParlayClipboard(parlay, "CLP", week.fromYmd);
  const insufficient =
    parlay.status === "INSUFFICIENT_MATCHES" ||
    parlay.legs.length < (preset.minLegs ?? 2);
  return NextResponse.json({
    success: true,
    status: insufficient ? "INSUFFICIENT_MATCHES" : "OK",
    source: "live",
    date: week.fromYmd,
    datesUsed: week.dates,
    week: {
      from: week.from,
      to: week.to,
      fromYmd: week.fromYmd,
      toYmd: week.toYmd,
    },
    singleDayLocked: false,
    dateSelectionMode: "FULL_WEEK_AUTO",
    config: { ...preset, ignoreRotationFilter },
    daysAhead: 6,
    daysFetched: daysFetched ?? null,
    poolMode: "monopoly",
    matchPoolSize: matches.length,
    error: insufficient ? INSUFFICIENT_MATCHES_MESSAGE : undefined,
    parlay: {
      ...parlay,
      fillNotice: insufficient
        ? INSUFFICIENT_MATCHES_MESSAGE
        : parlay.fillNotice,
    },
    clipboard: insufficient ? "" : clipboard,
  });
}

async function buildAutoParlayResponse(
  strategyModeRaw: unknown,
  dateRaw: unknown,
  allowMultiDay: boolean,
  ignoreRotationFilter: boolean
) {
  try {
    const strategyMode = resolveStrategyMode(strategyModeRaw);
    if (isMonopolyStrategy(strategyMode)) {
      return buildMonopolyParlayResponse(ignoreRotationFilter);
    }
    if (!isFunStrategy(strategyMode)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Modo Segura usa picks individuales. Consulta /api/predict?safeOnly=true.",
          code: "SAFE_MODE_SINGLES",
        },
        { status: 400 }
      );
    }

    const date =
      typeof dateRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
        ? dateRaw
        : chileDateString();

    const preset = getStrategyPreset(strategyMode);
    const config = { ...preset };
    const targetLegCount = config.targetLegCount ?? DEFAULT_TARGET_LEG_COUNT;

    const { matches, source, daysFetched, poolMode, datesUsed, singleDayLocked } =
      await loadParlayMatchPool(date, targetLegCount, allowMultiDay);

    // Final hard clamp — never leak another Chile day in single-date mode
    const scopedMatches = filterEliteWhitelistMatches(
      singleDayLocked
        ? filterMatchesOnChileDate(matches, date)
        : matches
    );

    const parlay = generateParlay(scopedMatches, {
      ...config,
      // Soften exact-15 pressure when single-day supply is thin
      maxLegs: Math.max(
        config.maxLegs ?? targetLegCount,
        Math.min(targetLegCount, Math.max(scopedMatches.length, 1))
      ),
    });
    const clipboard = formatParlayClipboard(parlay, "CLP", date);

    const shortNotice = singleDayShortfallNotice(
      parlay.legs.length,
      targetLegCount,
      scopedMatches.length,
      singleDayLocked
    );

    const multiDay =
      !singleDayLocked && datesUsed.length > 1
        ? `Ventana ${datesUsed[0]} → ${datesUsed[datesUsed.length - 1]} · ${scopedMatches.length} fixtures`
        : undefined;

    return NextResponse.json({
      success: true,
      source,
      date,
      datesUsed: singleDayLocked ? [date] : datesUsed,
      singleDayLocked,
      config,
      daysAhead: singleDayLocked ? 0 : Math.max(0, datesUsed.length - 1),
      daysFetched: daysFetched ?? null,
      poolMode: poolMode ?? null,
      matchPoolSize: scopedMatches.length,
      multiDayNote: multiDay,
      parlay: {
        ...parlay,
        fillNotice: [parlay.fillNotice, shortNotice, multiDay]
          .filter(Boolean)
          .join(" · "),
      },
      clipboard,
    });
  } catch (error) {
    const { body, status } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
