/**
 * Whitelist / deny-list regression for league filtering.
 * Usage: npx tsx scripts/verify-allowed-leagues.ts
 */
import {
  isAllowedCompetition,
  isAllowedLeagueName,
} from "../config/allowed-leagues";

type Case = {
  id?: string | number;
  name: string;
  allow: boolean;
  why: string;
};

const cases: Case[] = [
  // Allowed IDs with typical API-Football short names
  { id: 39, name: "Premier League", allow: true, why: "PL" },
  { id: 267, name: "Primera B", allow: true, why: "Chile B by id + short name" },
  { id: 267, name: "Primera B Chile", allow: true, why: "Chile B explicit" },
  { id: 265, name: "Primera División", allow: true, why: "Chile A short name" },
  { id: 128, name: "Liga Profesional", allow: true, why: "Argentina" },
  { id: 71, name: "Serie A", allow: true, why: "Brazil Serie A" },
  { id: 135, name: "Serie A", allow: true, why: "Italy Serie A" },
  { id: 2, name: "UEFA Champions League", allow: true, why: "UCL" },
  { id: 848, name: "UEFA Europa Conference League", allow: true, why: "UECL" },
  { id: 253, name: "Major League Soccer", allow: true, why: "MLS" },

  // Removed: Colombia / Ecuador / club friendlies
  { id: 239, name: "Liga BetPlay", allow: false, why: "Colombia A removed" },
  { id: 239, name: "Primera A", allow: false, why: "Colombia A alias" },
  { id: 240, name: "Copa Colombia", allow: false, why: "Copa Colombia removed" },
  { id: 240, name: "Copa DIMAYOR", allow: false, why: "Copa DIMAYOR removed" },
  { id: 242, name: "LigaPro Ecuador", allow: false, why: "Ecuador A removed" },
  { id: 1050, name: "Copa Ecuador", allow: false, why: "Copa Ecuador removed" },
  { id: 666, name: "Friendlies Clubs", allow: false, why: "club friendlies 666" },
  { id: 667, name: "Friendlies Clubs", allow: false, why: "club friendlies 667" },
  { name: "Friendlies Clubs", allow: false, why: "friendlies by name" },
  { name: "Liga BetPlay", allow: false, why: "BetPlay by name" },
  { name: "Copa Colombia", allow: false, why: "Copa Colombia by name" },

  // The original leak: Colombia Primera B
  { id: 241, name: "Primera B", allow: false, why: "Colombia B id 241" },
  {
    id: 241,
    name: "Primera B Colombia",
    allow: false,
    why: "Colombia B explicit",
  },
  { name: "Primera B", allow: false, why: "ambiguous Primera B, no id" },
  { name: "Primera B Colombia", allow: false, why: "Colombia B by name" },
  { name: "Torneo BetPlay", allow: false, why: "Torneo BetPlay" },
  { name: "Torneo DIMAYOR", allow: false, why: "Torneo DIMAYOR" },
  {
    id: 239,
    name: "Primera B",
    allow: false,
    why: "mis-tagged Colombia B under Liga BetPlay id",
  },
  {
    id: 240,
    name: "Primera B",
    allow: false,
    why: "mis-tagged Colombia B under Copa Colombia id",
  },

  // Same class of substring collisions
  { name: "Primera B Chile", allow: true, why: "Chile B by name only" },
  { name: "Primera División", allow: false, why: "ambiguous Primera División" },
  { id: 268, name: "Primera División", allow: false, why: "Uruguay / Chile Segunda" },
  { id: 40, name: "Championship", allow: true, why: "EFL Championship id" },
  { name: "Championship", allow: false, why: "Championship by name ambiguous" },
  { name: "EFL Championship", allow: true, why: "EFL Championship by name" },
  { id: 141, name: "LaLiga 2", allow: true, why: "Spain 2nd" },
  { name: "LaLiga 2", allow: true, why: "LaLiga 2 by name" },
  { id: 61, name: "Ligue 1", allow: false, why: "France removed" },
  { id: 78, name: "Bundesliga", allow: false, why: "Germany removed" },
  { id: 66, name: "Coupe de France", allow: false, why: "France cup removed" },
  { id: 81, name: "DFB Pokal", allow: false, why: "Germany cup removed" },
  { id: 79, name: "2. Bundesliga", allow: false, why: "2. Bundesliga" },
  { name: "Bundesliga", allow: false, why: "Bundesliga by name" },
  { id: 62, name: "Ligue 2", allow: false, why: "Ligue 2" },
  { id: 136, name: "Serie B", allow: true, why: "Italy Serie B" },
  { id: 72, name: "Serie B", allow: true, why: "Brazil Serie B short name" },
  { id: 72, name: "Brasileirão Serie B", allow: true, why: "Brazil Serie B" },
  { name: "Serie B", allow: false, why: "Serie B by name ambiguous" },
  { name: "Brasileirão Serie B", allow: true, why: "Brazil Serie B by name" },
  { id: 129, name: "Primera Nacional", allow: true, why: "Argentina 2nd" },
  { name: "Primera Nacional", allow: true, why: "Primera Nacional by name" },
  { id: 243, name: "Liga Pro Serie B", allow: false, why: "Ecuador B" },
  { id: 264, name: "Liga de Expansión MX", allow: false, why: "Mexico 2nd" },
  { name: "Liga MX Femenil", allow: false, why: "women's Liga MX" },
  { name: "Premier League 2", allow: false, why: "PL2" },
  { name: "MLS Next Pro", allow: false, why: "MLS Next Pro" },
  { id: 255, name: "USL Championship", allow: false, why: "USL" },
  { name: "UEFA Champions League", allow: true, why: "UCL by name" },
  { name: "CONCACAF Champions Cup", allow: true, why: "not Championship" },
];

function run(): void {
  let failed = 0;
  for (const c of cases) {
    const got = isAllowedCompetition(c.id, c.name);
    if (got !== c.allow) {
      failed += 1;
      console.error(
        `FAIL ${c.why}: id=${c.id ?? "—"} name="${c.name}" expected ${c.allow} got ${got}`
      );
    }
  }

  const substringLeak = isAllowedLeagueName("Primera B");
  if (substringLeak) {
    failed += 1;
    console.error('FAIL substring: "Primera B" must not match "Primera B Chile"');
  }

  if (failed > 0) {
    console.error(`${failed} check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok ${cases.length + 1} checks`);
}

run();
