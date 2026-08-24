import { NextRequest, NextResponse } from "next/server";
import { errorMessage, jsonError } from "@/lib/api-response";
import {
  searchTeamProfiles,
  updateTeamProfileFlags,
  updateTeamProfilesFromSettledMatches,
} from "@/lib/team-profiler";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/teams/profiles?q=madrid&limit=300
 * Optional POST rebuilds profiles from settled MatchFixture history.
 * PATCH { teamId, teamName?, keyAbsencesCount?, lastManagerChangeDate?, clearManager? }
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? 300);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 300;
    const profiles = await searchTeamProfiles(q, limit);
    const leagues = [
      ...new Set(
        profiles
          .map((p) => p.leagueName?.trim())
          .filter((n): n is string => Boolean(n) && n !== "Otros")
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));
    if (profiles.some((p) => (p.leagueName ?? "Otros") === "Otros")) {
      leagues.push("Otros");
    }
    return NextResponse.json({
      success: true,
      profiles,
      leagues,
      count: profiles.length,
    });
  } catch (error) {
    console.error("[api/teams/profiles]", error);
    return jsonError(
      errorMessage(error, "No se pudieron cargar los perfiles."),
      500
    );
  }
}

export async function POST() {
  try {
    const result = await updateTeamProfilesFromSettledMatches();
    const profiles = await searchTeamProfiles("", 300);
    const leagues = [
      ...new Set(
        profiles
          .map((p) => p.leagueName?.trim())
          .filter((n): n is string => Boolean(n) && n !== "Otros")
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));
    if (profiles.some((p) => (p.leagueName ?? "Otros") === "Otros")) {
      leagues.push("Otros");
    }
    return NextResponse.json({
      success: true,
      ...result,
      profiles,
      leagues,
      count: profiles.length,
    });
  } catch (error) {
    console.error("[api/teams/profiles] rebuild", error);
    return jsonError(
      errorMessage(error, "No se pudieron recalcular los perfiles."),
      500
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      teamId?: number;
      teamName?: string;
      keyAbsencesCount?: number;
      lastManagerChangeDate?: string | null;
      clearManager?: boolean;
    };
    const teamId = Number(body.teamId);
    if (!Number.isFinite(teamId) || teamId <= 0) {
      return jsonError("teamId inválido.", 400);
    }
    const patch: {
      lastManagerChangeDate?: string | null;
      keyAbsencesCount?: number;
    } = {};
    if (body.clearManager) patch.lastManagerChangeDate = null;
    else if (body.lastManagerChangeDate !== undefined) {
      patch.lastManagerChangeDate = body.lastManagerChangeDate;
    }
    if (
      body.keyAbsencesCount !== undefined &&
      Number.isFinite(body.keyAbsencesCount)
    ) {
      patch.keyAbsencesCount = Math.max(
        0,
        Math.min(20, Math.floor(body.keyAbsencesCount))
      );
    }
    const profile = await updateTeamProfileFlags(
      teamId,
      body.teamName?.trim() || `Team ${teamId}`,
      patch
    );
    return NextResponse.json({ success: true, profile });
  } catch (error) {
    console.error("[api/teams/profiles] patch", error);
    return jsonError(
      errorMessage(error, "No se pudo actualizar el perfil."),
      500
    );
  }
}
