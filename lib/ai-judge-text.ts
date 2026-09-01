/**
 * Client-safe AI Judge prose helpers (no Groq / Prisma / Node builtins).
 */
import { humanizeContextFlagsInText } from "./context-engine";

/** Short Spanish phrases for bet markets in AI-judge summaries. */
const AI_JUDGE_MARKET_PHRASES: Record<string, string> = {
  "1x": "doble local (1X)",
  x2: "doble visitante (X2)",
  "12": "doble sin empate (12)",
  home: "victoria local",
  draw: "empate",
  away: "victoria visitante",
  over_0_5: "más de 0.5 goles",
  over_1_5: "más de 1.5 goles",
  over_2_5: "más de 2.5 goles",
  under_3_5: "menos de 3.5 goles",
  under_4_5: "menos de 4.5 goles",
  home_scores: "local marca",
  away_scores: "visitante marca",
  home_over_1_5: "local más de 1.5 goles",
  away_over_1_5: "visitante más de 1.5 goles",
  dnb_home: "local sin empate",
  dnb_away: "visitante sin empate",
  btts_yes: "ambos marcan",
  btts_no: "ambos no marcan",
};

/** Make cached / model prose readable: flags → Spanish, markets → plain bets. */
export function humanizeAiJudgeProse(text: string): string {
  if (!text) return text;
  let out = humanizeContextFlagsInText(text);
  const codes = Object.keys(AI_JUDGE_MARKET_PHRASES).sort(
    (a, b) => b.length - a.length
  );
  for (const code of codes) {
    const phrase = AI_JUDGE_MARKET_PHRASES[code];
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`\\bmercado\\s+${escaped}\\b`, "gi"),
      `apuesta ${phrase}`
    );
  }
  return out
    .replace(/\bflags?\s+de\s+alto\s+riesgo\s*/gi, "factores de alto riesgo: ")
    .replace(/\bflags?\s+de\s*/gi, "")
    .replace(/\bflag\s+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
