/**
 * Qualitative last-pass over Poisson + odds-sanity picks.
 * Uses Groq Llama 3.3 70B (JSON mode); never throws to callers.
 * Batch ≤5 fixtures / call + AiVerdictCache (12h upcoming / permanent FT).
 */
import Groq from "groq-sdk";
import type {
  AIVerdict,
  Match,
  MatchPrediction,
  ParlayLeg,
  TeamInjury,
} from "./types";
import { prisma } from "./db";
import {
  canSpendGroqCall,
  isGroqDailyQuotaError,
  isGroqQuotaError,
  markGroqQuotaExhausted,
  markGroqRateLimitCooldown,
  recordGroqCall,
} from "./groq-quota";
import { chileDateString } from "./utils";
import { contextBadgeLabels } from "./context-engine";
import { humanizeAiJudgeProse } from "./ai-judge-text";

export { humanizeAiJudgeProse } from "./ai-judge-text";
export { passesAiJudgeGate } from "./ai-judge-gate";

/** Official GroqCloud production IDs; first is default. Override with GROQ_MODEL. */
export const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
] as const;

/** Ordered attempt list: env primary first, then fallbacks (deduped). */
export function resolveGroqModelOrder(): string[] {
  const primary = process.env.GROQ_MODEL?.trim();
  const rest = [...GROQ_MODELS];
  if (!primary) return rest;
  return [primary, ...rest.filter((m) => m !== primary)];
}

/** True when the model ID is missing or decommissioned — try next fallback. */
export function isGroqModelNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    const msg = String(err).toLowerCase();
    return (
      msg.includes("model_not_found") ||
      msg.includes("model_decommissioned") ||
      msg.includes("decommissioned") ||
      msg.includes("does not exist") ||
      msg.includes("404")
    );
  }
  const e = err as {
    status?: number;
    code?: string;
    error?: { code?: string; message?: string };
    message?: string;
  };
  const code = (e.code ?? e.error?.code ?? "").toLowerCase();
  const msg = `${e.message ?? ""} ${e.error?.message ?? ""}`.toLowerCase();
  if (code === "model_not_found" || code === "model_decommissioned") {
    return true;
  }
  if (e.status === 404) return true;
  if (e.status === 400 && (msg.includes("decommissioned") || msg.includes("model"))) {
    return true;
  }
  return (
    msg.includes("model_not_found") ||
    msg.includes("model_decommissioned") ||
    msg.includes("decommissioned") ||
    msg.includes("does not exist") ||
    (msg.includes("model") && msg.includes("404"))
  );
}

export function isGroqModelDecommissioned(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : err && typeof err === "object"
        ? `${(err as { message?: string }).message ?? ""} ${(err as { error?: { message?: string; code?: string } }).error?.message ?? ""} ${(err as { code?: string }).code ?? ""}`.toLowerCase()
        : String(err).toLowerCase();
  const code =
    err && typeof err === "object"
      ? String(
          (err as { code?: string }).code ??
            (err as { error?: { code?: string } }).error?.code ??
            ""
        ).toLowerCase()
      : "";
  return code === "model_decommissioned" || msg.includes("decommissioned");
}

let loggedMissingKey = false;

export function isAiJudgeConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

/** Log once and return false when Groq key is absent (quiet bypass). */
export function requireGroqKey(): boolean {
  if (isAiJudgeConfigured()) return true;
  if (!loggedMissingKey) {
    loggedMissingKey = true;
    console.warn("[AI JUDGE] GROQ_API_KEY non-existent — skipping AI audit.");
  }
  return false;
}

/** Fixed batch size: 1 chat completion ≈ up to 5 audits. */
export const AI_JUDGE_BATCH_SIZE = 5;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PERMANENT_EXPIRES = new Date("9999-12-31T00:00:00.000Z");

const SYSTEM_PROMPT = `You are an expert sports prediction judge for football (soccer) bets.
Analyze the provided match data (Poisson xG, market sanity, context factors, known injuries).
Do NOT invent injuries, rotations, or news not present in the input.
If there is no clear high-risk evidence in the data, approved must be true.
Output strictly a JSON object with key "verdicts" containing an array of match evaluation objects.
Each object: {"fixtureId":string,"approved":boolean,"vetoReason":string|null,"confidenceScore":number,"summary":string}
confidenceScore between 0 and 1.
summary and vetoReason in Spanish, 1-2 clear sentences for a bettor (not a developer).
Never use internal codes (KEY_INJURY_CLUSTER, H2H_DRAWISH, FATIGUE_AWAY, etc.).
Explain what each factor means and why it supports or conflicts with the chosen bet (e.g. "doble visitante", not "x2").
Include every listed fixtureId.`;

export type AiJudgeFixtureInput = {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  matchDate: string;
  /** Kickoff ISO; past/FT → permanent cache. */
  kickoffIso?: string;
  xgHome?: number;
  xgAway?: number;
  market?: string;
  modelProbability?: number;
  odds?: number;
  edge?: number;
  contextFlags?: string[];
  injuriesNote?: string;
};

export function splitMatchLabel(label: string): {
  home: string;
  away: string;
} {
  const idx = label.indexOf(" vs ");
  if (idx < 0) return { home: label.trim(), away: "" };
  return {
    home: label.slice(0, idx).trim(),
    away: label.slice(idx + 4).trim(),
  };
}

function clampConfidence(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  const unit = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, unit));
}

function normalizeVerdict(raw: Record<string, unknown>): AIVerdict {
  const approved = raw.approved === true;
  const vetoReason =
    !approved && typeof raw.vetoReason === "string" && raw.vetoReason.trim()
      ? raw.vetoReason.trim()
      : null;
  const summaryRaw =
    typeof raw.summary === "string" && raw.summary.trim()
      ? raw.summary.trim()
      : approved
        ? "Sin alertas cualitativas relevantes."
        : (vetoReason ?? "Riesgo cualitativo detectado por IA.");
  const summary = humanizeAiJudgeProse(summaryRaw);
  return {
    approved,
    vetoReason: approved
      ? null
      : humanizeAiJudgeProse(
          vetoReason ?? "Riesgo cualitativo detectado por IA."
        ),
    confidenceScore: clampConfidence(raw.confidenceScore),
    summary,
  };
}

function injuriesNoteFromMatch(match: Match): string | undefined {
  const parts: string[] = [];
  const fmt = (side: string, list?: TeamInjury[]) => {
    if (!list?.length) return;
    const names = list
      .slice(0, 4)
      .map((i) => `${i.player}${i.role ? ` (${i.role})` : ""}`)
      .join(", ");
    parts.push(`${side}: ${names}`);
  };
  fmt("local", match.home.injuries);
  fmt("visita", match.away.injuries);
  return parts.length ? parts.join("; ") : undefined;
}

export function predictionToJudgeInput(
  p: MatchPrediction
): AiJudgeFixtureInput {
  const pick = p.bestSafePick;
  return {
    fixtureId: p.matchId,
    homeTeam: p.match.home.name,
    awayTeam: p.match.away.name,
    matchDate: chileDateString(p.match.kickoff),
    kickoffIso: p.match.kickoff,
    xgHome: p.expectedGoals.home,
    xgAway: p.expectedGoals.away,
    market: pick?.market,
    modelProbability: pick?.modelProbability,
    odds: pick?.odds,
    edge: pick?.edge,
    contextFlags: p.contextFlags,
    injuriesNote: injuriesNoteFromMatch(p.match),
  };
}

export function legToJudgeInput(leg: ParlayLeg): AiJudgeFixtureInput {
  const { home, away } = splitMatchLabel(leg.matchLabel);
  return {
    fixtureId: leg.matchId,
    homeTeam: home,
    awayTeam: away,
    matchDate: chileDateString(leg.kickoff),
    kickoffIso: leg.kickoff,
    market: leg.market,
    modelProbability: leg.modelProbability,
    odds: leg.odds,
    edge: leg.edge,
    contextFlags: leg.contextFlags,
  };
}

export function parseAiVerdict(text: string): AIVerdict {
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI Judge: respuesta sin JSON");
  }
  const obj = JSON.parse(stripped.slice(start, end + 1)) as Record<
    string,
    unknown
  >;
  // Groq json_object may wrap a single verdict or nest under verdicts[0]
  if (Array.isArray(obj.verdicts) && obj.verdicts[0]) {
    return normalizeVerdict(obj.verdicts[0] as Record<string, unknown>);
  }
  return normalizeVerdict(obj);
}

/** Parse JSON array or {"verdicts":[...]} keyed by fixtureId. */
export function parseAiVerdictBatch(text: string): Map<string, AIVerdict> {
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  let arr: unknown;

  const arrStart = stripped.indexOf("[");
  const objStart = stripped.indexOf("{");

  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    const end = stripped.lastIndexOf("}");
    if (end <= objStart) throw new Error("AI Judge: respuesta sin JSON");
    const obj = JSON.parse(stripped.slice(objStart, end + 1)) as Record<
      string,
      unknown
    >;
    if (Array.isArray(obj.verdicts)) {
      arr = obj.verdicts;
    } else if (typeof obj.fixtureId === "string") {
      arr = [obj];
    } else {
      throw new Error("AI Judge: JSON sin verdicts");
    }
  } else if (arrStart >= 0) {
    const end = stripped.lastIndexOf("]");
    if (end <= arrStart) throw new Error("AI Judge: respuesta sin JSON array");
    arr = JSON.parse(stripped.slice(arrStart, end + 1));
  } else {
    throw new Error("AI Judge: respuesta sin JSON");
  }

  if (!Array.isArray(arr)) {
    throw new Error("AI Judge: JSON no es array");
  }
  const out = new Map<string, AIVerdict>();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id =
      typeof raw.fixtureId === "string" ? raw.fixtureId.trim() : "";
    if (!id) continue;
    out.set(id, normalizeVerdict(raw));
  }
  return out;
}

function expiresAtForKickoff(kickoffIso?: string): Date {
  if (!kickoffIso) return new Date(Date.now() + CACHE_TTL_MS);
  const kick = new Date(kickoffIso).getTime();
  if (!Number.isFinite(kick) || kick <= Date.now()) return PERMANENT_EXPIRES;
  return new Date(Date.now() + CACHE_TTL_MS);
}

export async function getCachedVerdict(
  fixtureId: string
): Promise<AIVerdict | null> {
  try {
    const row = await prisma.aiVerdictCache.findUnique({
      where: { fixtureId },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return {
      approved: row.approved,
      vetoReason: row.vetoReason,
      confidenceScore: row.confidenceScore,
      summary: row.summary,
    };
  } catch (err) {
    console.warn("[AI JUDGE] cache get failed:", err);
    return null;
  }
}

export async function upsertVerdict(
  fixtureId: string,
  verdict: AIVerdict,
  kickoffIso?: string
): Promise<void> {
  if (!verdict.summary) return;
  const data = {
    approved: verdict.approved,
    vetoReason: verdict.vetoReason,
    confidenceScore: verdict.confidenceScore,
    summary: verdict.summary,
    expiresAt: expiresAtForKickoff(kickoffIso),
  };
  try {
    const existing = await prisma.aiVerdictCache.findUnique({
      where: { fixtureId },
    });
    if (existing) {
      await prisma.aiVerdictCache.update({ where: { fixtureId }, data });
    } else {
      await prisma.aiVerdictCache
        .create({ data: { fixtureId, ...data } })
        .catch(async () =>
          prisma.aiVerdictCache.update({ where: { fixtureId }, data })
        );
    }
  } catch (err) {
    console.warn("[AI JUDGE] cache upsert failed:", err);
  }
}

let cachedClient: Groq | null = null;

function getClient(): Groq | null {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return null;
  if (!cachedClient) cachedClient = new Groq({ apiKey: key });
  return cachedClient;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function formatFixtureLine(f: AiJudgeFixtureInput, i: number): string {
  const bits = [
    `${i + 1}. fixtureId=${f.fixtureId}`,
    `${f.homeTeam} vs ${f.awayTeam}`,
    `fecha=${f.matchDate}`,
  ];
  if (f.xgHome != null && f.xgAway != null) {
    bits.push(`xG=${f.xgHome.toFixed(2)}-${f.xgAway.toFixed(2)}`);
  }
  if (f.market) bits.push(`market=${f.market}`);
  if (f.modelProbability != null) {
    bits.push(`modelP=${(f.modelProbability * 100).toFixed(1)}%`);
  }
  if (f.odds != null) bits.push(`odds=${f.odds}`);
  if (f.edge != null) bits.push(`edge=${(f.edge * 100).toFixed(1)}%`);
  if (f.contextFlags?.length) {
    bits.push(`contexto=${contextBadgeLabels(f.contextFlags).join("; ")}`);
  }
  if (f.injuriesNote) bits.push(`injuries=${f.injuriesNote}`);
  return bits.join(" | ");
}

async function callBatchGroq(
  fixtures: AiJudgeFixtureInput[]
): Promise<Map<string, AIVerdict>> {
  const empty = new Map<string, AIVerdict>();
  if (!requireGroqKey() || fixtures.length === 0) return empty;

  const client = getClient();
  if (!client) return empty;

  const promptContent = `Evalúa estos partidos como juez cualitativo final. Solo veto (approved=false) con evidencia clara en los datos.
Escribe summary y vetoReason en español claro para el apostador: explica el porqué con frases completas, sin códigos internos ni abreviaturas de mercado (usa "doble visitante", no "x2").

Partidos:
${fixtures.map(formatFixtureLine).join("\n")}

Responde con JSON: {"verdicts":[{"fixtureId":"...","approved":true|false,"vetoReason":null|string,"confidenceScore":0-1,"summary":"..."},...]}`;

  const models = resolveGroqModelOrder();

  for (const model of models) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: promptContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      });
      await recordGroqCall();
      const text = completion.choices[0]?.message?.content ?? "";
      return parseAiVerdictBatch(text);
    } catch (err) {
      // 400/404 model errors: silent next; quota: stop (same limit on all models).
      if (isGroqQuotaError(err)) {
        markGroqRateLimitCooldown();
        if (isGroqDailyQuotaError(err)) {
          await markGroqQuotaExhausted();
        }
        console.warn(
          "[AI JUDGE] Groq models unavailable — proceeding with raw model scores"
        );
        return empty;
      }
      continue;
    }
  }

  console.warn(
    "[AI JUDGE] Groq models unavailable — proceeding with raw model scores"
  );
  return empty;
}

/**
 * Deduplicate → cache → soft quota → batch Groq (size 5) → upsert.
 * Misses without summary = fail-open (caller skips badge).
 * Cache is always read; Groq only when key + quota allow.
 */
export async function evaluateBatchWithAI(
  fixtures: AiJudgeFixtureInput[]
): Promise<Map<string, AIVerdict>> {
  const byId = new Map<string, AiJudgeFixtureInput>();
  for (const f of fixtures) {
    if (f.fixtureId) byId.set(f.fixtureId, f);
  }
  const unique = [...byId.values()];
  const out = new Map<string, AIVerdict>();
  if (unique.length === 0) return out;

  const misses: AiJudgeFixtureInput[] = [];
  for (const f of unique) {
    const hit = await getCachedVerdict(f.fixtureId);
    if (hit?.summary) {
      out.set(f.fixtureId, hit);
    } else {
      misses.push(f);
    }
  }
  if (misses.length === 0) return out;

  // No live Groq without a key — still return cache hits above.
  if (!isAiJudgeConfigured()) {
    requireGroqKey(); // one-shot warn
    return out;
  }

  if (!(await canSpendGroqCall())) {
    console.warn("[AI JUDGE] soft quota / cool-down — skip Groq");
    return out;
  }

  for (const group of chunk(misses, AI_JUDGE_BATCH_SIZE)) {
    if (!(await canSpendGroqCall())) break;
    const parsed = await callBatchGroq(group);
    for (const f of group) {
      const verdict = parsed.get(f.fixtureId);
      if (!verdict?.summary) continue;
      out.set(f.fixtureId, verdict);
      await upsertVerdict(f.fixtureId, verdict, f.kickoffIso);
    }
  }
  return out;
}

/** Compat wrapper: single-fixture batch. */
export async function evaluateFixtureWithAI(
  homeTeam: string,
  awayTeam: string,
  matchDate: string,
  fixtureId = `adhoc-${homeTeam}-${awayTeam}-${matchDate}`
): Promise<AIVerdict> {
  const map = await evaluateBatchWithAI([
    { fixtureId, homeTeam, awayTeam, matchDate },
  ]);
  return (
    map.get(fixtureId) ?? {
      approved: true,
      vetoReason: null,
      confidenceScore: 0,
      summary: "",
    }
  );
}

/** Keep approved / fail-open legs; drop explicit vetoes. */
export function keepApprovedOrFailOpen(
  rows: Array<{ leg: ParlayLeg; verdict: AIVerdict | null }>
): { kept: ParlayLeg[]; vetoed: ParlayLeg[] } {
  const kept: ParlayLeg[] = [];
  const vetoed: ParlayLeg[] = [];
  for (const { leg, verdict } of rows) {
    if (verdict && !verdict.approved) {
      vetoed.push(leg);
      console.log(
        `[AI VETO] ${leg.matchLabel}: ${verdict.vetoReason ?? verdict.summary}`
      );
      continue;
    }
    kept.push(verdict?.summary ? { ...leg, aiJudge: verdict } : leg);
  }
  return { kept, vetoed };
}

/** Attach verdicts by matchId; keep vetoed visible (dashboard audit). */
export function attachAiJudgeToPredictions(
  predictions: MatchPrediction[],
  verdictsByMatchId: Map<string, AIVerdict>
): MatchPrediction[] {
  return predictions.map((p) => {
    const verdict = verdictsByMatchId.get(p.matchId);
    if (!verdict?.summary) return p;
    if (!verdict.approved) {
      console.log(
        `[AI VETO] ${p.match.home.name} vs ${p.match.away.name}: ${
          verdict.vetoReason ?? verdict.summary
        }`
      );
    }
    return { ...p, aiJudge: verdict };
  });
}

/** Attach AiVerdictCache rows onto predictions that lack aiJudge (no Groq call). */
export async function hydrateAiJudgeFromCache(
  predictions: MatchPrediction[]
): Promise<MatchPrediction[]> {
  if (predictions.length === 0) return predictions;
  const verdicts = new Map<string, AIVerdict>();
  for (const p of predictions) {
    if (p.aiJudge?.summary) {
      verdicts.set(p.matchId, p.aiJudge);
      continue;
    }
    const hit = await getCachedVerdict(p.matchId);
    if (hit?.summary) verdicts.set(p.matchId, hit);
  }
  if (verdicts.size === 0) return predictions;
  return attachAiJudgeToPredictions(predictions, verdicts);
}

/** Same hydrate for SafePickItem rows (by matchId). */
export async function hydrateSafePicksAiJudge<
  T extends { matchId: string; aiJudge?: AIVerdict },
>(picks: T[]): Promise<T[]> {
  if (picks.length === 0) return picks;
  const out: T[] = [];
  for (const p of picks) {
    if (p.aiJudge?.summary) {
      out.push(p);
      continue;
    }
    const hit = await getCachedVerdict(p.matchId);
    out.push(hit?.summary ? { ...p, aiJudge: hit } : p);
  }
  return out;
}

/**
 * Audit high-confidence fixtures (bestSafePick ≥80%) once per matchId.
 * Always rehydrates from AiVerdictCache so badges persist across regenerations.
 * Fail-open / no-key / no quota → keep cached verdicts; never strip them.
 */
export async function auditPredictionsWithAI(
  predictions: MatchPrediction[]
): Promise<MatchPrediction[]> {
  if (predictions.length === 0) return predictions;

  const next = await hydrateAiJudgeFromCache(predictions);

  if (!isAiJudgeConfigured()) {
    requireGroqKey();
    return next;
  }

  const candidates = next.filter(
    (p) =>
      !p.aiJudge?.summary &&
      p.bestSafePick != null &&
      p.bestSafePick.modelProbability >= 0.8
  );
  if (candidates.length === 0) return next;

  const verdicts = await evaluateBatchWithAI(
    candidates.map(predictionToJudgeInput)
  );
  return attachAiJudgeToPredictions(next, verdicts);
}
