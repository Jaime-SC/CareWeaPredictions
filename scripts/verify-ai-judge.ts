/**
 * Smoke: AI Judge JSON parse + veto/fail-open + prediction attach (no Groq call).
 * Usage: npx tsx scripts/verify-ai-judge.ts
 */
import {
  attachAiJudgeToPredictions,
  auditPredictionsWithAI,
  GROQ_MODELS,
  isAiJudgeConfigured,
  isGroqModelNotFound,
  keepApprovedOrFailOpen,
  parseAiVerdict,
  parseAiVerdictBatch,
  resolveGroqModelOrder,
  splitMatchLabel,
} from "../lib/ai-judge";
import { passesAiJudgeGate } from "../lib/ai-judge-gate";
import {
  resolveGroqDailyLimit,
  resolveGroqSoftCallLimit,
} from "../lib/groq-quota";
import type { AIVerdict, MatchPrediction, ParlayLeg } from "../lib/types";

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

function stubPrediction(
  id: string,
  withSafe: boolean
): MatchPrediction {
  const pick = withSafe
    ? {
        market: "over_1_5" as const,
        label: "Over 1.5",
        odds: 1.22,
        modelProbability: 0.88,
        impliedProbability: 0.82,
        edge: 0.06,
        isSafePick: true,
      }
    : null;
  return {
    matchId: id,
    match: {
      id,
      league: "premier-league",
      leagueName: "Premier League",
      kickoff: "2026-08-24T20:00:00.000Z",
      home: {
        name: `Home${id}`,
        shortName: `H${id}`,
        form: [],
        goalsScoredAvg: 1.5,
        goalsConcededAvg: 1,
      },
      away: {
        name: `Away${id}`,
        shortName: `A${id}`,
        form: [],
        goalsScoredAvg: 1,
        goalsConcededAvg: 1.5,
      },
      h2h: { homeWins: 1, draws: 1, awayWins: 1, avgGoals: 2.2 },
      odds: {
        home: 1.8,
        draw: 3.4,
        away: 4.2,
        doubleChance1X: 1.22,
        doubleChanceX2: 1.55,
        over05: 1.08,
        over15: 1.25,
        over25: 1.9,
        under35: 1.4,
        under45: 1.15,
        bttsYes: 1.75,
        bttsNo: 2.0,
        dnbHome: 1.55,
        dnbAway: 2.2,
        homeScores: 1.35,
        awayScores: 1.42,
      },
    },
    expectedGoals: { home: 1.4, away: 1.0 },
    markets: pick ? [pick] : [],
    bestSafePick: pick,
  };
}

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

const batch = parseAiVerdictBatch(`\`\`\`json
[
  {"fixtureId":"f1","approved":true,"vetoReason":null,"confidenceScore":0.7,"summary":"OK."},
  {"fixtureId":"f2","approved":false,"vetoReason":"Lesión 9","confidenceScore":92,"summary":"Baja goleador."}
]
\`\`\``);
assert(batch.size === 2, "batch size 2");
assert(batch.get("f1")?.approved === true, "batch f1 approved");
assert(batch.get("f2")?.approved === false, "batch f2 veto");
assert(batch.get("f2")?.confidenceScore === 0.92, "batch clamp 92→0.92");

const wrapped = parseAiVerdictBatch(
  '{"verdicts":[{"fixtureId":"g1","approved":true,"vetoReason":null,"confidenceScore":0.65,"summary":"Datos estables."},{"fixtureId":"g2","approved":false,"vetoReason":"KEY_INJURY","confidenceScore":0.9,"summary":"Baja crítica."}]}'
);
assert(wrapped.size === 2, "groq wrapper size 2");
assert(wrapped.get("g1")?.approved === true, "g1 approved");
assert(wrapped.get("g2")?.approved === false, "g2 veto");

const soft = resolveGroqSoftCallLimit();
const hard = resolveGroqDailyLimit();
assert(soft === Math.max(1, hard - 5), `soft=${soft} hard=${hard}`);

assert(GROQ_MODELS.length >= 2, "fallback list");
assert(
  GROQ_MODELS[0] === "llama-3.3-70b-versatile",
  "primary 3.3-70b"
);
assert(
  !GROQ_MODELS.some(
    (m) =>
      m.startsWith("llama3-") ||
      m.includes("llama-3.1-70b") ||
      m.includes("mixtral") ||
      m.includes("gemma2")
  ),
  "no decommissioned model ids"
);
assert(
  GROQ_MODELS.includes("openai/gpt-oss-120b") &&
    GROQ_MODELS.includes("openai/gpt-oss-20b"),
  "gpt-oss fallbacks present"
);
assert(
  resolveGroqModelOrder()[0] === (process.env.GROQ_MODEL?.trim() || GROQ_MODELS[0]),
  "primary model order"
);
assert(
  isGroqModelNotFound({ status: 404, code: "model_not_found" }),
  "404 model_not_found"
);
assert(
  isGroqModelNotFound({
    status: 400,
    code: "model_decommissioned",
    message: "model has been decommissioned",
  }),
  "400 model_decommissioned"
);
assert(
  isGroqModelNotFound(new Error("The model `foo` does not exist")),
  "does not exist"
);
assert(!isGroqModelNotFound(new Error("network timeout")), "not model error");

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

assert(passesAiJudgeGate(ok) === true, "gate approved");
assert(passesAiJudgeGate(veto) === false, "gate veto");
assert(passesAiJudgeGate(null) === true, "gate fail-open");
assert(passesAiJudgeGate(undefined) === true, "gate no verdict");

const preds = [
  stubPrediction("a", true),
  stubPrediction("b", true),
  stubPrediction("c", false),
];
const attached = attachAiJudgeToPredictions(
  preds,
  new Map([
    ["a", ok],
    ["b", veto],
    ["c", { ...ok, summary: "" }],
  ])
);
assert(attached[0].aiJudge?.approved === true, "pred a tagged");
assert(attached[1].aiJudge?.approved === false, "pred b veto kept visible");
assert(attached[2].aiJudge === undefined, "pred c empty summary");
assert(attached.length === 3, "no drop on predict attach");

const configured = isAiJudgeConfigured();

async function main() {
  if (!configured) {
    const passthrough = await auditPredictionsWithAI(preds);
    assert(passthrough === preds, "no-key audit is identity");
  }

  console.log(
    JSON.stringify({
      ok: true,
      parsed: fenced.approved === false,
      batchParse: batch.size === 2,
      groqWrapper: wrapped.size === 2,
      softQuota: soft,
      models: resolveGroqModelOrder(),
      predictAttach: true,
      groqConfigured: configured,
    })
  );
}

void main();
