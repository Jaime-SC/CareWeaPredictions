export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./lib/env");
  const {
    purgeStaleOddsAndFixtureCache,
    purgePlanLimitNegativeCache,
  } = await import("./lib/api-cache");
  await purgeStaleOddsAndFixtureCache();
  await purgePlanLimitNegativeCache();
}
