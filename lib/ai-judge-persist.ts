/**
 * Browser persistence for AI Judge verdicts so badges survive regenerate /
 * fail-open responses that omit aiJudge.
 */
import type { AIVerdict } from "./types";

const STORAGE_KEY = "parleylab.aiJudgeByMatch.v1";

type Store = Record<string, AIVerdict>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode */
  }
}

export function rememberAiJudge(
  matchId: string,
  verdict: AIVerdict | undefined | null
): void {
  if (!matchId || !verdict?.summary) return;
  const store = readStore();
  store[matchId] = verdict;
  writeStore(store);
}

/** Merge remembered / incoming aiJudge onto picks; never drop a known verdict. */
export function mergePersistedAiJudge<
  T extends { matchId: string; aiJudge?: AIVerdict },
>(picks: T[]): T[] {
  const store = readStore();
  let dirty = false;
  const out = picks.map((p) => {
    if (p.aiJudge?.summary) {
      if (
        store[p.matchId]?.summary !== p.aiJudge.summary ||
        store[p.matchId]?.approved !== p.aiJudge.approved
      ) {
        store[p.matchId] = p.aiJudge;
        dirty = true;
      }
      return p;
    }
    const remembered = store[p.matchId];
    if (remembered?.summary) return { ...p, aiJudge: remembered };
    return p;
  });
  if (dirty) writeStore(store);
  return out;
}
