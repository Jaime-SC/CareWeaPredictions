/**
 * Qualitative last-pass over Poisson + odds-sanity picks.
 * Uses Gemini + Google Search Grounding; never throws to callers.
 */
import { GoogleGenerativeAI, type Tool } from "@google/generative-ai";
import type { AIVerdict, ParlayLeg } from "./types";

// ponytail: 1.5/2.0 Flash shut down Jun 2026; 2.5-flash is the search-grounded successor.
const GEMINI_MODEL = "gemini-2.5-flash";

const SEARCH_TOOL = { googleSearch: {} } as Tool;

export function isAiJudgeConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

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

export function parseAiVerdict(text: string): AIVerdict {
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI Judge: respuesta sin JSON");
  }
  const raw = JSON.parse(stripped.slice(start, end + 1)) as Record<
    string,
    unknown
  >;
  const approved = raw.approved === true;
  const vetoReason =
    !approved && typeof raw.vetoReason === "string" && raw.vetoReason.trim()
      ? raw.vetoReason.trim()
      : null;
  const summary =
    typeof raw.summary === "string" && raw.summary.trim()
      ? raw.summary.trim()
      : approved
        ? "Sin alertas cualitativas relevantes."
        : (vetoReason ?? "Riesgo cualitativo detectado por IA.");
  return {
    approved,
    vetoReason: approved
      ? null
      : (vetoReason ?? "Riesgo cualitativo detectado por IA."),
    confidenceScore: clampConfidence(raw.confidenceScore),
    summary,
  };
}

let cachedModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null =
  null;

function getModel() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  if (!cachedModel) {
    cachedModel = new GoogleGenerativeAI(key).getGenerativeModel({
      model: GEMINI_MODEL,
      tools: [SEARCH_TOOL],
      generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
      systemInstruction:
        "Eres un auditor cualitativo de apuestas de fútbol. No inventes lesiones ni rotaciones. Si no hay evidencia clara de riesgo alto, approved debe ser true.",
    });
  }
  return cachedModel;
}

export async function evaluateFixtureWithAI(
  homeTeam: string,
  awayTeam: string,
  matchDate: string
): Promise<AIVerdict> {
  const model = getModel();
  if (!model) {
    return {
      approved: true,
      vetoReason: null,
      confidenceScore: 0,
      summary: "IA Judge no configurado.",
    };
  }

  const query = `${homeTeam} vs ${awayTeam} noticias lesiones alineaciones confirmadas baja ${matchDate}`;
  const prompt = `Busca resultados actuales de Google para: "${query}"

Evalúa solo factores cualitativos de alto riesgo: bajas críticas (goleadores, arquero titular), rotación fuerte por copas continentales, clima extremo o falta de motivación competitiva.

Responde ÚNICAMENTE con JSON (sin markdown):
{"approved":boolean,"vetoReason":string|null,"confidenceScore":number,"summary":string}

approved=false solo con evidencia clara. confidenceScore entre 0 y 1. summary en español, 1-2 frases.`;

  try {
    const result = await model.generateContent(prompt);
    return parseAiVerdict(result.response.text());
  } catch (err) {
    console.warn("[AI JUDGE] fail-open", err);
    return {
      approved: true,
      vetoReason: null,
      confidenceScore: 0,
      summary: "",
    };
  }
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
