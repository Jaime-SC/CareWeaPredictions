/**
 * Client-safe team profile types + pure helpers (no Node/fs/Prisma).
 * Server logic stays in `team-profiler.ts`.
 */

export type TeamProfileSnapshot = {
  teamId: number;
  teamName: string;
  /** Most recent league seen in MatchFixture history (dashboard grouping). */
  leagueName?: string | null;
  totalMatchesAnalyzed: number;
  homeMatchesCount: number;
  awayMatchesCount: number;
  avgGoalsScoredHome: number;
  avgGoalsConcededHome: number;
  avgGoalsScoredAway: number;
  avgGoalsConcededAway: number;
  over15GoalsRate: number;
  over15GoalsRateHome: number;
  over15GoalsRateAway: number;
  over25GoalsRate: number;
  cleanSheetRate: number;
  cleanSheetRateHome: number;
  cleanSheetRateAway: number;
  lastManagerChangeDate?: string | null;
  keyAbsencesCount: number;
  updatedAt?: string;
};

export const MANAGER_CHANGE_COOLDOWN_DAYS = 14;

/** True when coach start is within MANAGER_CHANGE_COOLDOWN_DAYS. */
export function isRecentManagerStart(
  startIso: string,
  nowMs = Date.now()
): boolean {
  const t = Date.parse(startIso);
  if (!Number.isFinite(t)) return false;
  const ageDays = (nowMs - t) / 86_400_000;
  return ageDays >= 0 && ageDays <= MANAGER_CHANGE_COOLDOWN_DAYS;
}

function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Cross-ref injured players vs top scorers (id or normalized name). */
export function countKeyAbsencesFromLists(
  injured: Array<{ id?: number; name?: string }>,
  topPlayers: Array<{ id?: number; name?: string }>
): number {
  if (injured.length === 0 || topPlayers.length === 0) return 0;
  const idSet = new Set(
    topPlayers
      .map((p) => p.id)
      .filter((id): id is number => id != null && id > 0)
  );
  const nameSet = new Set(
    topPlayers.map((p) => normalizePlayerName(p.name ?? "")).filter(Boolean)
  );
  let n = 0;
  const seen = new Set<string>();
  for (const inj of injured) {
    const key =
      inj.id != null && inj.id > 0
        ? `id:${inj.id}`
        : `n:${normalizePlayerName(inj.name ?? "")}`;
    if (seen.has(key) || key === "n:") continue;
    const hitId = inj.id != null && idSet.has(inj.id);
    const hitName = Boolean(
      inj.name && nameSet.has(normalizePlayerName(inj.name))
    );
    if (hitId || hitName) {
      seen.add(key);
      n += 1;
    }
  }
  return n;
}
