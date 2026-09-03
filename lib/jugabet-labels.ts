/**
 * Single source for explicit JugaBet market labels (category → selection).
 * Never return raw MarketType keys or shorthand like "O1.5" / "Total → …".
 */
import type { MarketType } from "./types";
import { ALL_PARLAY_MARKETS } from "./phase2-markets";

export type JugaBetLabelParams = {
  homeTeam?: string;
  awayTeam?: string;
};

function team(name: string | undefined, fallback: string): string {
  const t = name?.trim();
  return t || fallback;
}

function mas(line: string): string {
  return `Más de ${line}`;
}
function menos(line: string): string {
  return `Menos de ${line}`;
}

/**
 * Fully-qualified JugaBet slip label for any MarketType.
 */
export function getJugaBetLabel(
  market: MarketType,
  params: JugaBetLabelParams = {}
): string {
  const home = team(params.homeTeam, "Local");
  const away = team(params.awayTeam, "Visitante");

  switch (market) {
    case "home":
      return `Resultado → ${home}`;
    case "draw":
      return "Resultado → Empate";
    case "away":
      return `Resultado → ${away}`;
    case "1x":
      return `Doble oportunidad → Gana o empata ${home}`;
    case "x2":
      return `Doble oportunidad → Gana o empata ${away}`;
    case "over_0_5":
      return `Total de goles → ${mas("0.5")}`;
    case "over_1_5":
      return `Total de goles → ${mas("1.5")}`;
    case "over_2_5":
      return `Total de goles → ${mas("2.5")}`;
    case "under_3_5":
      return `Total de goles → ${menos("3.5")}`;
    case "under_4_5":
      return `Total de goles → ${menos("4.5")}`;
    case "home_scores":
      return `${home} total → ${mas("0.5")} goles`;
    case "away_scores":
      return `${away} total → ${mas("0.5")} goles`;
    case "home_over_1_5":
      return `${home} total → ${mas("1.5")} goles`;
    case "away_over_1_5":
      return `${away} total → ${mas("1.5")} goles`;
    case "dnb_home":
      return `Apuesta sin empate → ${home}`;
    case "dnb_away":
      return `Apuesta sin empate → ${away}`;
    case "btts_yes":
      return "Ambos equipos marcan → Sí";
    case "btts_no":
      return "Ambos equipos marcan → No";

    case "corners_over_7_5":
      return `Córners. Total → ${mas("7.5")}`;
    case "corners_under_7_5":
      return `Córners. Total → ${menos("7.5")}`;
    case "corners_over_8_5":
      return `Córners. Total → ${mas("8.5")}`;
    case "corners_under_8_5":
      return `Córners. Total → ${menos("8.5")}`;
    case "corners_over_9_5":
      return `Córners. Total → ${mas("9.5")}`;
    case "corners_under_9_5":
      return `Córners. Total → ${menos("9.5")}`;
    case "corners_over_10_5":
      return `Córners. Total → ${mas("10.5")}`;
    case "corners_under_10_5":
      return `Córners. Total → ${menos("10.5")}`;
    case "corners_1h_over_3_5":
      return `Córners. Total. 1ª parte → ${mas("3.5")}`;
    case "corners_1h_under_3_5":
      return `Córners. Total. 1ª parte → ${menos("3.5")}`;
    case "corners_1h_over_4_5":
      return `Córners. Total. 1ª parte → ${mas("4.5")}`;
    case "corners_1h_under_4_5":
      return `Córners. Total. 1ª parte → ${menos("4.5")}`;
    case "corners_home_over_3_5":
      return `Córners total ${home} → ${mas("3.5")}`;
    case "corners_home_under_3_5":
      return `Córners total ${home} → ${menos("3.5")}`;
    case "corners_home_over_4_5":
      return `Córners total ${home} → ${mas("4.5")}`;
    case "corners_home_under_4_5":
      return `Córners total ${home} → ${menos("4.5")}`;
    case "corners_away_over_3_5":
      return `Córners total ${away} → ${mas("3.5")}`;
    case "corners_away_under_3_5":
      return `Córners total ${away} → ${menos("3.5")}`;
    case "corners_away_over_4_5":
      return `Córners total ${away} → ${mas("4.5")}`;
    case "corners_away_under_4_5":
      return `Córners total ${away} → ${menos("4.5")}`;

    case "cards_over_3_5":
      return `Tarjetas amarillas. Total → ${mas("3.5")}`;
    case "cards_under_3_5":
      return `Tarjetas amarillas. Total → ${menos("3.5")}`;
    case "cards_over_4_5":
      return `Tarjetas amarillas. Total → ${mas("4.5")}`;
    case "cards_under_4_5":
      return `Tarjetas amarillas. Total → ${menos("4.5")}`;
    case "cards_over_5_5":
      return `Tarjetas amarillas. Total → ${mas("5.5")}`;
    case "cards_under_5_5":
      return `Tarjetas amarillas. Total → ${menos("5.5")}`;
    case "cards_home_over_1_5":
      return `Tarjetas amarillas total ${home} → ${mas("1.5")}`;
    case "cards_home_under_1_5":
      return `Tarjetas amarillas total ${home} → ${menos("1.5")}`;
    case "cards_home_over_2_5":
      return `Tarjetas amarillas total ${home} → ${mas("2.5")}`;
    case "cards_home_under_2_5":
      return `Tarjetas amarillas total ${home} → ${menos("2.5")}`;
    case "cards_away_over_1_5":
      return `Tarjetas amarillas total ${away} → ${mas("1.5")}`;
    case "cards_away_under_1_5":
      return `Tarjetas amarillas total ${away} → ${menos("1.5")}`;
    case "cards_away_over_2_5":
      return `Tarjetas amarillas total ${away} → ${mas("2.5")}`;
    case "cards_away_under_2_5":
      return `Tarjetas amarillas total ${away} → ${menos("2.5")}`;

    case "ht_over_0_5":
      return `Total de goles. 1ª parte → ${mas("0.5")}`;
    case "ht_under_0_5":
      return `Total de goles. 1ª parte → ${menos("0.5")}`;
    case "ht_over_1_5":
      return `Total de goles. 1ª parte → ${mas("1.5")}`;
    case "ht_under_1_5":
      return `Total de goles. 1ª parte → ${menos("1.5")}`;
    case "ht_home":
      return `Resultado 1ª parte → ${home}`;
    case "ht_draw":
      return "Resultado 1ª parte → Empate";
    case "ht_away":
      return `Resultado 1ª parte → ${away}`;
    case "cards_btts":
      return "Ambos equipos reciben tarjeta";

    default: {
      const _exhaustive: never = market;
      return String(_exhaustive);
    }
  }
}

/** Safe wrapper when market may be a free-form / legacy string. */
export function tryGetJugaBetLabel(
  market: string,
  params: JugaBetLabelParams = {}
): string | null {
  const key = String(market ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (key === "12") {
    const home = team(params.homeTeam, "Local");
    const away = team(params.awayTeam, "Visitante");
    return `Doble oportunidad → Gana ${home} o ${away}`;
  }
  if (!ALL_PARLAY_MARKETS.has(key as MarketType)) return null;
  return getJugaBetLabel(key as MarketType, params);
}

/** True when label already looks like JugaBet "Category → Selection". */
export function looksLikeJugaBetLabel(label: string): boolean {
  return /→/.test(label) && label.trim().length > 3;
}
