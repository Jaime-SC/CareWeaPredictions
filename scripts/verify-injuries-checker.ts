/**
 * Smoke: injuries-checker key-absence counting (role + topscorer cross-ref).
 * Usage: npx tsx scripts/verify-injuries-checker.ts
 */
import {
  countRoleBasedKeyAbsences,
  injuriesFixtureCacheKey,
  type InjuryApiRow,
} from "../lib/injuries-checker";
import { countKeyAbsencesFromLists } from "../lib/team-profile-shared";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  injuriesFixtureCacheKey(123) === "injuries_fixture_123",
  "cache key"
);

const rows: InjuryApiRow[] = [
  {
    team: { id: 1 },
    player: { id: 10, name: "Striker A", type: "Attacker", reason: "Injured" },
  },
  {
    team: { id: 1 },
    player: { id: 11, name: "Mid B", type: "Midfielder", reason: "Injured" },
  },
  {
    team: { id: 1 },
    player: { id: 12, name: "Doubt C", type: "Attacker", reason: "Doubtful" },
  },
  {
    team: { id: 2 },
    player: { id: 20, name: "Away D", type: "Attacker", reason: "Missing" },
  },
];

assert(countRoleBasedKeyAbsences(rows, 1) === 1, "one key striker home");
assert(countRoleBasedKeyAbsences(rows, 2) === 1, "one key away");
assert(countRoleBasedKeyAbsences([], 1) === 0, "empty → 0");

assert(
  countKeyAbsencesFromLists(
    [
      { id: 10, name: "Striker A" },
      { id: 11, name: "Mid B" },
    ],
    [{ id: 10, name: "Striker A" }]
  ) === 1,
  "topscorer cross-ref"
);

console.log(JSON.stringify({ ok: true, cacheKey: injuriesFixtureCacheKey(1) }));
