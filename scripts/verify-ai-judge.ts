/**
 * Smoke: AI Judge JSON parse + veto/fail-open assembly (no Gemini call).
 * Usage: npx tsx scripts/verify-ai-judge.ts
 */
import {
  isAiJudgeConfigured,
  keepApprovedOrFailOpen,
  parseAiVerdict,
  splitMatchLabel,
} from "../lib/ai-judge";
import type { AIVerdict, ParlayLeg } from "../lib/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const stub = (id: string): ParlayLeg => ({
  matchId: id,
  matchLabel: `Home${id} vs Away${id}`,
  leagueName: "Premier League",
  kickoff: "2026-08-24T20:00:00.000Z",
  market: "over_1_5",
  marketLabel: "Over 1.5",
  odds: 1.22,
  modelProbability: 0.84,
  edge: 0.06,
});

const fenced = parseAiVerdict(`\`\`\`json
{"approved":false,"vetoReason":"Portero titular lesionado","confidenceScore":0.86,"summary":"Baja crítica en portería."}
\`\`\``);
assert(fenced.approved === false, "veto approved");
assert(fenced.vetoReason === "Portero titular lesionado", "veto reason");
assert(fenced.confidenceScore === 0.86, "confidence 0-1");

const percent = parseAiVerdict(
  '{"approved":true,"vetoReason":null,"confidenceScore":80,"summary":"Sin bajas."}'
);
assert(percent.approved === true, "approve");
assert(percent.vetoReason === null, "null veto on approve");
assert(percent.confidenceScore === 0.8, "80 → 0.8");

const teams = splitMatchLabel("Colo Colo vs Universidad de Chile");
assert(teams.home === "Colo Colo" && teams.away === "Universidad de Chile", "split");

const veto: AIVerdict = {
  approved: false,
  vetoReason: "Rotación UEFA",
  confidenceScore: 0.9,
  summary: "Once de reservas.",
};
const ok: AIVerdict = {
  approved: true,
  vetoReason: null,
  confidenceScore: 0.7,
  summary: "Plantel completo.",
};

const assembled = keepApprovedOrFailOpen([
  { leg: stub("1"), verdict: ok },
  { leg: stub("2"), verdict: veto },
  { leg: stub("3"), verdict: null },
  { leg: stub("4"), verdict: { ...ok, summary: "" } },
]);
assert(assembled.kept.length === 3, `kept 3 got ${assembled.kept.length}`);
assert(assembled.vetoed.length === 1 && assembled.vetoed[0].matchId === "2", "veto dropped");
assert(assembled.kept[0].aiJudge?.approved === true, "approved tagged");
assert(assembled.kept[1].aiJudge === undefined, "fail-open untagged");
assert(assembled.kept[2].aiJudge === undefined, "empty summary untagged");

void isAiJudgeConfigured();

console.log(JSON.stringify({ ok: true, parsed: fenced.approved === false }));
