import type { AIVerdict } from "./types";

/** Fail-open: sin veredicto → visible; veto explícito → ocultar. */
export function passesAiJudgeGate(verdict?: AIVerdict | null): boolean {
  return !verdict || verdict.approved !== false;
}
