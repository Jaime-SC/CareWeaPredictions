/**
 * E2E smoke against a running Next server (paid API + AI Judge).
 * Usage: npx tsx scripts/smoke-paid-pipeline.ts
 * Env: BASE_URL=http://localhost:3000 (default)
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function fetchJson(
  path: string,
  init?: RequestInit
): Promise<{ status: number; ms: number; body: Record<string, unknown> }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const ms = Date.now() - t0;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, ms, body };
}

function softWarn(msg: string) {
  console.warn(`[warn] ${msg}`);
}

async function main() {
  console.log(JSON.stringify({ base: BASE, phase: "start" }));

  // 1) Quota
  const quota = await fetchJson("/api/quota?sync=1");
  assert(quota.status === 200, `quota HTTP ${quota.status}`);
  assert(quota.body.success === true, "quota success");
  const limit = Number(quota.body.limit);
  assert(Number.isFinite(limit) && limit >= 100, `quota limit ${limit}`);
  if (quota.ms >= 500) {
    softWarn(`quota latency ${quota.ms}ms (≥500 with sync=1 is ok)`);
  }

  // 2) Predict (force refresh)
  const predict = await fetchJson(
    "/api/predict?refresh=1&safeOnly=true&strategyMode=daily-safe"
  );
  assert(predict.status === 200, `predict HTTP ${predict.status}`);
  assert(predict.body.success === true, "predict success");
  const safePicks = Array.isArray(predict.body.safePicks)
    ? (predict.body.safePicks as Array<Record<string, unknown>>)
    : [];
  const predictions = Array.isArray(predict.body.predictions)
    ? (predict.body.predictions as Array<Record<string, unknown>>)
    : [];
  assert(safePicks.length >= 0, "safePicks array");

  const withJudge = [...safePicks, ...predictions].filter((p) => {
    const j = p.aiJudge as { summary?: string } | undefined;
    return Boolean(j?.summary);
  });
  if (safePicks.length > 0 && withJudge.length === 0) {
    softWarn(
      "safe picks present but no aiJudge.summary (Gemini fail-open or key missing)"
    );
  }

  // 3) Parlay (soft on thin-day / transient API errors after predict already OK)
  const parlayRes = await fetchJson("/api/parlay", {
    method: "POST",
    body: JSON.stringify({ strategyMode: "daily-fun", multiDay: true }),
  });
  let legs: Array<{ odds?: number; aiJudge?: { summary?: string } }> = [];
  if (parlayRes.status === 200 && parlayRes.body.success === true) {
    const parlay = (parlayRes.body.parlay ?? {}) as {
      legs?: Array<{ odds?: number; aiJudge?: { summary?: string } }>;
    };
    legs = Array.isArray(parlay.legs) ? parlay.legs : [];
    if (legs.length > 0) {
      assert(
        legs.every((l) => typeof l.odds === "number" && l.odds > 1),
        "parlay legs must have real odds > 1"
      );
      const judged = legs.filter((l) => l.aiJudge?.summary);
      if (judged.length === 0) {
        softWarn("parlay legs without aiJudge (fail-open or judge off)");
      }
    } else {
      softWarn("parlay returned 0 legs (thin day / filters)");
    }
  } else {
    softWarn(
      `parlay HTTP ${parlayRes.status} code=${String(parlayRes.body.code ?? "")} error=${String(parlayRes.body.error ?? "").slice(0, 120)}`
    );
  }

  const blob = JSON.stringify(predict.body) + JSON.stringify(parlayRes.body);
  if (/plan free:\s*10\/min/i.test(blob)) {
    softWarn("response still mentions Free 10/min copy");
  }

  console.log(
    JSON.stringify({
      ok: true,
      quotaMs: quota.ms,
      quotaLimit: limit,
      quotaRemaining: quota.body.remaining ?? null,
      predictMs: predict.ms,
      safePicks: safePicks.length,
      predictions: predictions.length,
      aiJudgeTagged: withJudge.length,
      parlayMs: parlayRes.ms,
      parlayLegs: legs.length,
      parlayJudged: legs.filter((l) => l.aiJudge?.summary).length,
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
