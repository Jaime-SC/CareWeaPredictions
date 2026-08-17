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
  { id: 239, name: "Primera A", allow: true, why: "Colombia A" },
  { id: 240, name: "Copa Colombia", allow: true, why: "Copa Colombia" },
  { id: 240, name: "Copa DIMAYOR", allow: true, why: "Copa DIMAYOR alias" },
  { id: 71, name: "Serie A", allow: true, why: "Brazil Serie A" },
  { id: 135, name: "Serie A", allow: true, why: "Italy Serie A" },
  { id: 2, name: "UEFA Champions League", allow: true, why: "UCL" },
  { id: 848, name: "UEFA Europa Conference League", allow: true, why: "UECL" },
  { id: 253, name: "Major League Soccer", allow: true, why: "MLS" },

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
  { id: 40, name: "Championship", allow: false, why: "EFL Championship" },
  { name: "Championship", allow: false, why: "Championship by name" },
  { id: 141, name: "Segunda División", allow: false, why: "LaLiga 2" },
  { name: "LaLiga 2", allow: false, why: "LaLiga 2 name" },
  { id: 79, name: "2. Bundesliga", allow: false, why: "2. Bundesliga" },
  { name: "Bundesliga", allow: true, why: "Bundesliga 1 by name" },
  { id: 62, name: "Ligue 2", allow: false, why: "Ligue 2" },
  { id: 136, name: "Serie B", allow: false, why: "Italy Serie B" },
  { id: 72, name: "Serie B", allow: false, why: "Brazil Serie B" },
  { name: "Serie B", allow: false, why: "Serie B by name" },
  { id: 129, name: "Primera Nacional", allow: false, why: "Argentina 2nd" },
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
