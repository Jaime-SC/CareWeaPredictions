import type { AIVerdict } from "./types";

/** Fail-open: sin veredicto → visible; veto explícito → ocultar. */
export function passesAiJudgeGate(verdict?: AIVerdict | null): boolean {
  return !verdict || verdict.approved !== false;
}

export function filterByAiJudgeGate<T extends { aiJudge?: AIVerdict }>(
  items: T[],
  hideVetoes: boolean
): T[] {
  if (!hideVetoes) return items;
  return items.filter((item) => passesAiJudgeGate(item.aiJudge));
}

export function countAiVetoes<T extends { aiJudge?: AIVerdict }>(
  items: T[]
): number {
  return items.filter((item) => item.aiJudge?.approved === false).length;
}
