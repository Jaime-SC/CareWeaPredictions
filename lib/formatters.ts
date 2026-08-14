import type { MarketType } from "./types";

/**
 * Bookmaker-facing copy so the user opens the correct tab
 * on Betano / JugaBet / Coolbet and does not pick a similar-looking market.
 */
export interface MarketGuide {
  /** Team + condition, e.g. "Gana Craiova (Empate protege)". */
  explicitLabel: string;
  /** Where to find it in Chilean books. */
  bookmakerTab: string;
  /** What NOT to pick / how it can lose. */
  warningNote: string;
  /** Extra-time / knockout equivalent when it exists. */
  cupEquivalent?: string;
}

export type ExplicitPickLabel = MarketGuide & {
  /** Alias of explicitLabel (kept for existing UI callers). */
  label: string;
  /** Win/lose condition in plain Spanish. */
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
  if (
    (s.includes("local") || s.includes("home") || s.includes("team total")) &&
    (s.includes("más de 1.5") || s.includes("over 1.5"))
  ) {
    return "home_over_1_5";
  }
  if (
    (s.includes("visita") || s.includes("away") || s.includes("visitante")) &&
    (s.includes("más de 1.5") || s.includes("over 1.5"))
  ) {
    return "away_over_1_5";
  }
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

function pack(
  guide: MarketGuide,
  condition: string,
  code?: string
): ExplicitPickLabel {
  return {
    ...guide,
    label: guide.explicitLabel,
    condition,
    code,
  };
}

/**
 * Crystal-clear Spanish pick + Chilean bookmaker tab mapping
 * (Betano, JugaBet, Coolbet) so the user does not pick a lookalike market.
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
      return pack(
        {
          explicitLabel: `Gana o Empata ${home}`,
          bookmakerTab:
            "Buscar en la casa como: pestaña «Doble Oportunidad» → «1X» / «Local o Empate» (Betano, JugaBet, Coolbet).",
          warningNote:
            "NO apostar a «Resultado 1X2» ni a «Gana Local». Eso paga más, pero pierdes si empatan. Tampoco es «Empate No Válido».",
          cupEquivalent:
            "En copas/mano a mano esto sigue siendo Doble Oportunidad 1X a 90 min. No uses «Se clasifica».",
        },
        `Ganas si ${home} gana o empatan. Pierdes solo si gana ${away}.`,
        "1X"
      );
    case "x2":
      return pack(
        {
          explicitLabel: `Gana o Empata ${away}`,
          bookmakerTab:
            "Buscar en la casa como: pestaña «Doble Oportunidad» → «X2» / «Visitante o Empate» (Betano, JugaBet, Coolbet).",
          warningNote:
            "NO apostar a «Resultado 1X2» ni a «Gana Visitante». Eso paga más, pero pierdes si empatan. Tampoco es «Empate No Válido».",
          cupEquivalent:
            "En copas/mano a mano esto sigue siendo Doble Oportunidad X2 a 90 min. No uses «Se clasifica».",
        },
        `Ganas si ${away} gana o empatan. Pierdes solo si gana ${home}.`,
        "X2"
      );
    case "12":
      return pack(
        {
          explicitLabel: `Gana ${home} o Gana ${away}`,
          bookmakerTab:
            "Buscar en la casa como: pestaña «Doble Oportunidad» → «12» / «Local o Visitante» (sin empate).",
          warningNote:
            "NO es 1X2 ni Empate No Válido. Aquí pierdes si empatan a 90 min.",
          cupEquivalent:
            "En copas, si hay alargue, el empate a 90' igual pierde este mercado (se juega a tiempo reglamentario).",
        },
        "Ganas si hay un ganador a 90 min. Pierdes si empatan.",
        "12"
      );
    case "dnb_home":
      return pack(
        {
          explicitLabel: `Gana ${home} (Empate protege)`,
          bookmakerTab:
            "Buscar en la casa como: «Empate No Válido» o «Apuesta Sin Empate» / Draw No Bet — Local (Betano, JugaBet, Coolbet).",
          warningNote:
            "NO apostar a «Resultado 1X2» (esa paga más pero pierdes si empatan). Tampoco uses «Doble Oportunidad 1X»: esa gana con empate; aquí el empate se anula (cuota 1.00).",
          cupEquivalent:
            "En mano a mano/copas equivale a: «Se Clasifica» / «To Qualify» (pasa de ronda, incluye alargue y penales).",
        },
        `Ganas si ${home} gana. Si empatan, se anula (PUSH) y no pierdes.`,
        "DNB 1"
      );
    case "dnb_away":
      return pack(
        {
          explicitLabel: `Gana ${away} (Empate protege)`,
          bookmakerTab:
            "Buscar en la casa como: «Empate No Válido» o «Apuesta Sin Empate» / Draw No Bet — Visitante (Betano, JugaBet, Coolbet).",
          warningNote:
            "NO apostar a «Resultado 1X2» (esa paga más pero pierdes si empatan). Tampoco uses «Doble Oportunidad X2»: esa gana con empate; aquí el empate se anula (cuota 1.00).",
          cupEquivalent:
            "En mano a mano/copas equivale a: «Se Clasifica» / «To Qualify» (pasa de ronda, incluye alargue y penales).",
        },
        `Ganas si ${away} gana. Si empatan, se anula (PUSH) y no pierdes.`,
        "DNB 2"
      );
    case "over_0_5":
      return pack(
        {
          explicitLabel: "Más de 0.5 goles totales",
          bookmakerTab:
            "Buscar en la casa como: «Total de goles» / «Más/Menos» → Over 0.5 (partido completo, 90 min).",
          warningNote:
            "NO uses «Goles del local» ni «Goles 1er tiempo». Tiene que ser el total del partido a 90 min.",
        },
        "Se necesita mínimo 1 gol en el partido (90 min).",
        "O0.5"
      );
    case "over_1_5":
      return pack(
        {
          explicitLabel: "Más de 1.5 goles totales",
          bookmakerTab:
            "Buscar en la casa como: «Total de goles» / «Más/Menos» → Over 1.5 (partido completo, 90 min).",
          warningNote:
            "NO uses Over 1.5 del 1er tiempo ni goles de un solo equipo. Es el total del partido.",
        },
        "Se necesitan mínimo 2 goles en el partido (90 min).",
        "O1.5"
      );
    case "over_2_5":
      return pack(
        {
          explicitLabel: "Más de 2.5 goles totales",
          bookmakerTab:
            "Buscar en la casa como: «Total de goles» / «Más/Menos» → Over 2.5 (partido completo, 90 min).",
          warningNote:
            "NO confundir con Over 2.5 del 1er tiempo. El alargue en copas no cuenta para este mercado.",
        },
        "Se necesitan mínimo 3 goles en el partido (90 min).",
        "O2.5"
      );
    case "under_3_5":
      return pack(
        {
          explicitLabel: "Menos de 3.5 goles totales",
          bookmakerTab:
            "Buscar en la casa como: «Total de goles» / «Más/Menos» → Under 3.5 (partido completo, 90 min).",
          warningNote:
            "NO uses Under del 1er tiempo. Máximo 3 goles a 90 min; el 4º gol pierde.",
        },
        "Máximo 3 goles en el partido (90 min).",
        "U3.5"
      );
    case "under_4_5":
      return pack(
        {
          explicitLabel: "Menos de 4.5 goles totales",
          bookmakerTab:
            "Buscar en la casa como: «Total de goles» / «Más/Menos» → Under 4.5 (partido completo, 90 min).",
          warningNote:
            "NO uses Under del 1er tiempo. Máximo 4 goles a 90 min; el 5º gol pierde.",
        },
        "Máximo 4 goles en el partido (90 min).",
        "U4.5"
      );
    case "home_scores":
      return pack(
        {
          explicitLabel: `${home} marca al menos 1 gol`,
          bookmakerTab:
            "Buscar en la casa como: «Local marca» / «Goles del equipo» / «To Score» — Local (no es Ambos marcan).",
          warningNote:
            `NO es «Ambos equipos marcan» (BTTS) ni Over 0.5 del partido. Da igual si ${home} pierde, siempre que anote.`,
        },
        `Ganas si ${home} anota; no importa el resultado final.`,
        "BTTS-H"
      );
    case "away_scores":
      return pack(
        {
          explicitLabel: `${away} marca al menos 1 gol`,
          bookmakerTab:
            "Buscar en la casa como: «Visitante marca» / «Goles del equipo» / «To Score» — Visitante (no es Ambos marcan).",
          warningNote:
            `NO es «Ambos equipos marcan» (BTTS) ni Over 0.5 del partido. Da igual si ${away} pierde, siempre que anote.`,
        },
        `Ganas si ${away} anota; no importa el resultado final.`,
        "BTTS-A"
      );
    case "home_over_1_5":
      return pack(
        {
          explicitLabel: `${home} más de 1.5 goles`,
          bookmakerTab:
            "Buscar en la casa como: «Goles del equipo» / «Team Totals» → Local Over 1.5 (no es el total del partido).",
          warningNote:
            `NO es Over 1.5 del partido. Solo cuentan los goles de ${home}. Empate o derrota no importan si anota 2+.`,
        },
        `Ganas si ${home} marca al menos 2 goles (90 min).`,
        "TT O1.5 H"
      );
    case "away_over_1_5":
      return pack(
        {
          explicitLabel: `${away} más de 1.5 goles`,
          bookmakerTab:
            "Buscar en la casa como: «Goles del equipo» / «Team Totals» → Visitante Over 1.5 (no es el total del partido).",
          warningNote:
            `NO es Over 1.5 del partido. Solo cuentan los goles de ${away}. Empate o derrota no importan si anota 2+.`,
        },
        `Ganas si ${away} marca al menos 2 goles (90 min).`,
        "TT O1.5 A"
      );
    case "home":
      return pack(
        {
          explicitLabel: `Gana ${home} (90 min)`,
          bookmakerTab:
            "Buscar en la casa como: pestaña «Resultado 1X2» / «Ganador del partido» → 1 (Local). Tiempo reglamentario.",
          warningNote:
            "Si empatan, PIERDES. Si quieres proteger el empate usa «Empate No Válido» (DNB) o «Doble Oportunidad 1X».",
          cupEquivalent:
            "En copas NO uses «Se clasifica»: esa incluye alargue y penales. Esto es solo 90 min.",
        },
        `Pierdes si empatan o gana ${away}.`,
        "1"
      );
    case "away":
      return pack(
        {
          explicitLabel: `Gana ${away} (90 min)`,
          bookmakerTab:
            "Buscar en la casa como: pestaña «Resultado 1X2» / «Ganador del partido» → 2 (Visitante). Tiempo reglamentario.",
          warningNote:
            "Si empatan, PIERDES. Si quieres proteger el empate usa «Empate No Válido» (DNB) o «Doble Oportunidad X2».",
          cupEquivalent:
            "En copas NO uses «Se clasifica»: esa incluye alargue y penales. Esto es solo 90 min.",
        },
        `Pierdes si empatan o gana ${home}.`,
        "2"
      );
    case "draw":
      return pack(
        {
          explicitLabel: "Empate (90 min)",
          bookmakerTab:
            "Buscar en la casa como: pestaña «Resultado 1X2» / «Ganador del partido» → X (Empate).",
          warningNote:
            "NO es Doble Oportunidad ni Empate No Válido. Ganas SOLO si empatan a 90 min.",
          cupEquivalent:
            "En copas el empate a 90' puede ir a alargue: este mercado igual gana si empatan en tiempo reglamentario.",
        },
        `Ganas solo si ${home} y ${away} empatan a 90 min.`,
        "X"
      );
    default: {
      const fallback = selection?.trim() || String(market || "Mercado");
      return pack(
        {
          explicitLabel: fallback,
          bookmakerTab:
            "Buscar en la casa el nombre exacto del mercado (Betano, JugaBet, Coolbet).",
          warningNote:
            "Confirma que el mercado sea a 90 min y no un lookalike (1er tiempo, alargue o clasifica).",
        },
        "Revisa las reglas del mercado en tu casa de apuestas."
      );
    }
  }
}

/** Display line: "Gana o Empata Magallanes (1X)". */
export function formatExplicitBetLine(pick: ExplicitPickLabel): string {
  return pick.code ? `${pick.explicitLabel} (${pick.code})` : pick.explicitLabel;
}

/** Extra bookmaker-mapping lines for slips / WhatsApp export. */
export function formatMarketGuideLines(pick: ExplicitPickLabel): string[] {
  const lines = [`   Guía: ${pick.bookmakerTab}`, `   ${pick.warningNote}`];
  if (pick.cupEquivalent) lines.push(`   ${pick.cupEquivalent}`);
  return lines;
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

/** Alias kept for UI that wants the MarketGuide shape by name. */
export function getMarketGuide(
  market: MarketType | string,
  selection: string | undefined,
  homeTeam: string,
  awayTeam: string
): MarketGuide {
  return getExplicitPickLabel(market, selection, homeTeam, awayTeam);
}
