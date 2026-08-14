export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { purgeStaleOddsAndFixtureCache } = await import("./lib/cache");
  await purgeStaleOddsAndFixtureCache();
}
