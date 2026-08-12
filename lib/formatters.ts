import type { MarketType } from "./types";

export type ExplicitPickLabel = {
  /** Short human-readable bet label (team + condition). */
  label: string;
  /** Clear win/lose condition for tooltips or secondary UI. */
  condition: string;
  /** Compact market code when applicable (1X, X2, DNB, etc.). */
  code?: string;
};

/** Parse "Home vs Away" match labels used across the app. */
export function parseTeamsFromMatchLabel(matchLabel: string): {
  homeTeam: string;
  awayTeam: string;
} {
  const parts = matchLabel.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2) {
    return {
      homeTeam: parts[0].trim(),
      awayTeam: parts.slice(1).join(" vs ").trim(),
    };
  }
  return { homeTeam: matchLabel.trim() || "Local", awayTeam: "Visitante" };
}

function resolveMarketKey(
  market: MarketType | string,
  selection?: string
): string {
  const m = String(market ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (m) return m;

  const s = String(selection ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "";

  if (/\b1x\b/.test(s) || (s.includes("doble") && s.includes("1x")))
    return "1x";
  if (/\bx2\b/.test(s) || (s.includes("doble") && s.includes("x2")))
    return "x2";
  if (/\b12\b/.test(s) && s.includes("doble")) return "12";
  if (
    (s.includes("sin empate") || s.includes("dnb") || s.includes("draw no bet")) &&
    (s.includes("(2)") || s.includes("visita") || s.includes("away"))
  ) {
    return "dnb_away";
  }
  if (s.includes("sin empate") || s.includes("dnb") || s.includes("draw no bet"))
    return "dnb_home";
  if (s.includes("over 1.5") || s.includes("más de 1.5") || s.includes("+1.5"))
    return "over_1_5";
  if (s.includes("over 0.5") || s.includes("más de 0.5") || s.includes("+0.5"))
    return "over_0_5";
  if (s.includes("over 2.5") || s.includes("más de 2.5") || s.includes("+2.5"))
    return "over_2_5";
  if (s.includes("under 3.5") || s.includes("menos de 3.5")) return "under_3_5";
  if (s.includes("under 4.5") || s.includes("menos de 4.5")) return "under_4_5";
  if (s.includes("local marca") || s.includes("home scores"))
    return "home_scores";
  if (s.includes("visita marca") || s.includes("visitante marca") || s.includes("away scores"))
    return "away_scores";
  if (s.includes("local gana") || s === "1") return "home";
  if (s.includes("visitante gana") || s.includes("visita gana") || s === "2")
    return "away";
  if (s.includes("empate") || s === "x") return "draw";
  return s;
}

/**
 * Crystal-clear Spanish pick description naming the team and win condition.
 */
export function getExplicitPickLabel(
  market: MarketType | string,
  selection: string | undefined,
  homeTeam: string,
  awayTeam: string
): ExplicitPickLabel {
  const home = homeTeam.trim() || "Local";
  const away = awayTeam.trim() || "Visitante";
  const key = resolveMarketKey(market, selection);

  switch (key) {
    case "1x":
      return {
        label: `Gana o Empata ${home}`,
        condition: `Ganas si ${home} gana o empatan. Pierdes si gana ${away}.`,
        code: "1X",
      };
    case "x2":
      return {
        label: `Gana o Empata ${away}`,
        condition: `Ganas si ${away} gana o empatan. Pierdes si gana ${home}.`,
        code: "X2",
      };
    case "12":
      return {
        label: `Gana ${home} o Gana ${away}`,
        condition: `Ganas si hay un ganador. Pierdes si empatan.`,
        code: "12",
      };
    case "dnb_home":
      return {
        label: `Gana ${home}`,
        condition: `Si empatan, se anula y no pierdes.`,
        code: "DNB 1",
      };
    case "dnb_away":
      return {
        label: `Gana ${away}`,
        condition: `Si empatan, se anula y no pierdes.`,
        code: "DNB 2",
      };
    case "over_0_5":
      return {
        label: "Más de 0.5 goles totales",
        condition: "Se necesita mínimo 1 gol en el partido.",
        code: "O0.5",
      };
    case "over_1_5":
      return {
        label: "Más de 1.5 goles totales",
        condition: "Se necesitan mínimo 2 goles en el partido.",
        code: "O1.5",
      };
    case "over_2_5":
      return {
        label: "Más de 2.5 goles totales",
        condition: "Se necesitan mínimo 3 goles en el partido.",
        code: "O2.5",
      };
    case "under_3_5":
      return {
        label: "Menos de 3.5 goles totales",
        condition: "Máximo 3 goles en el partido.",
        code: "U3.5",
      };
    case "under_4_5":
      return {
        label: "Menos de 4.5 goles totales",
        condition: "Máximo 4 goles en el partido.",
        code: "U4.5",
      };
    case "home_scores":
      return {
        label: `${home} marca al menos 1 gol`,
        condition: `Ganas si ${home} anota; no importa el resultado final.`,
        code: "BTTS-H",
      };
    case "away_scores":
      return {
        label: `${away} marca al menos 1 gol`,
        condition: `Ganas si ${away} anota; no importa el resultado final.`,
        code: "BTTS-A",
      };
    case "home":
      return {
        label: `Gana ${home}`,
        condition: `Pierdes si empatan o gana ${away}.`,
        code: "1",
      };
    case "away":
      return {
        label: `Gana ${away}`,
        condition: `Pierdes si empatan o gana ${home}.`,
        code: "2",
      };
    case "draw":
      return {
        label: "Empate",
        condition: `Ganas solo si ${home} y ${away} empatan.`,
        code: "X",
      };
    default: {
      const fallback = selection?.trim() || String(market || "Mercado");
      return {
        label: fallback,
        condition: "Revisa las reglas del mercado en tu casa de apuestas.",
      };
    }
  }
}

/** Display line: "Gana o Empata Magallanes (1X)". */
export function formatExplicitBetLine(pick: ExplicitPickLabel): string {
  return pick.code ? `${pick.label} (${pick.code})` : pick.label;
}

/** Convenience wrapper for ParlayLeg / SafePick rows. */
export function getExplicitPickFromLeg(leg: {
  matchLabel: string;
  market: MarketType | string;
  marketLabel?: string;
}): ExplicitPickLabel {
  const { homeTeam, awayTeam } = parseTeamsFromMatchLabel(leg.matchLabel);
  return getExplicitPickLabel(
    leg.market,
    leg.marketLabel,
    homeTeam,
    awayTeam
  );
}
