import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { ALLOWED_LEAGUES } from "../config/allowed-leagues";

/** Maximum ±5% impact on base Poisson probability. */
export const MIN_TUNING_MULTIPLIER = 0.95;
export const MAX_TUNING_MULTIPLIER = 1.05;
export const NEUTRAL_TUNING_MULTIPLIER = 1.0;

export interface TuningConfig {
  lastCalibratedAt: string;
  totalBetsAnalyzed: number;
  leagueMultipliers: Record<string, number>; // e.g. { "39": 0.97, "140": 1.03 }
  marketMultipliers: Record<string, number>; // e.g. { "OVER_1_5": 1.02 }
}

export const DEFAULT_TUNING_CONFIG: TuningConfig = {
  lastCalibratedAt: "",
  totalBetsAnalyzed: 0,
  leagueMultipliers: {},
  marketMultipliers: {},
};

const CONFIG_RELATIVE = path.join("data", "tuning-config.json");

let cached: TuningConfig | null = null;
let cachedMtimeMs = 0;

export function getTuningConfigPath(): string {
  return path.join(process.cwd(), CONFIG_RELATIVE);
}

/** Clamp a multiplier into the safe zone. Non-finite values become 1.0. */
export function clampTuningMultiplier(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return NEUTRAL_TUNING_MULTIPLIER;
  return Math.min(
    MAX_TUNING_MULTIPLIER,
    Math.max(MIN_TUNING_MULTIPLIER, n)
  );
}

function factoryConfig(overrides?: Partial<TuningConfig>): TuningConfig {
  return {
    lastCalibratedAt:
      typeof overrides?.lastCalibratedAt === "string"
        ? overrides.lastCalibratedAt
        : "",
    totalBetsAnalyzed:
      typeof overrides?.totalBetsAnalyzed === "number" &&
      Number.isFinite(overrides.totalBetsAnalyzed)
        ? Math.max(0, Math.floor(overrides.totalBetsAnalyzed))
        : 0,
    leagueMultipliers: sanitizeMultiplierMap(overrides?.leagueMultipliers),
    marketMultipliers: sanitizeMultiplierMap(overrides?.marketMultipliers),
  };
}

function sanitizeMultiplierMap(
  raw: Record<string, number> | undefined
): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    out[key] = clampTuningMultiplier(value);
  }
  return out;
}

function normalizeLookupKey(key: string): string {
  return key.trim().toLowerCase().replace(/-/g, "_");
}

function lookupMultiplier(
  map: Record<string, number>,
  candidates: Array<string | number | undefined | null>
): number {
  const index = new Map<string, number>();
  for (const [key, value] of Object.entries(map)) {
    const clamped = clampTuningMultiplier(value);
    index.set(key, clamped);
    index.set(normalizeLookupKey(key), clamped);
  }

  for (const candidate of candidates) {
    if (candidate == null) continue;
    const raw = String(candidate).trim();
    if (!raw || raw.toLowerCase() === "unknown") continue;
    const hit = index.get(raw) ?? index.get(normalizeLookupKey(raw));
    if (hit != null) return hit;
  }

  return NEUTRAL_TUNING_MULTIPLIER;
}

export type TuningMatchRef = {
  league?: string;
  leagueName?: string;
  leagueId?: string | number;
};

function leagueIdCandidatesFromName(leagueName: string | undefined): string[] {
  const name = leagueName?.trim().toLowerCase();
  if (!name) return [];
  const ids: string[] = [];
  for (const entry of ALLOWED_LEAGUES) {
    if (entry.name.toLowerCase() === name) {
      ids.push(String(entry.id));
    }
  }
  return ids;
}

export function getLeagueTuningMultiplier(
  config: TuningConfig,
  match: TuningMatchRef
): number {
  return lookupMultiplier(config.leagueMultipliers, [
    match.leagueId,
    ...leagueIdCandidatesFromName(match.leagueName),
    match.leagueName,
    match.league,
  ]);
}

export function getMarketTuningMultiplier(
  config: TuningConfig,
  market: string | undefined
): number {
  return lookupMultiplier(config.marketMultipliers, [market]);
}

/**
 * Scale a raw Poisson probability by league × market multipliers.
 * The combined factor is also clamped to [0.95, 1.05] so total impact
 * never exceeds ±5% of the base probability.
 */
export function applyTuningToProbability(
  rawPoissonProb: number,
  match: TuningMatchRef,
  market: string,
  config: TuningConfig = getTuningConfig()
): number {
  const raw = Number.isFinite(rawPoissonProb) ? rawPoissonProb : 0;
  const combined = clampTuningMultiplier(
    getLeagueTuningMultiplier(config, match) *
      getMarketTuningMultiplier(config, market)
  );
  return raw * combined;
}

/**
 * Read persisted multipliers. Missing, corrupt, or unreadable files
 * fall back to a fully neutral (1.0) config — never throws.
 */
export function getTuningConfig(): TuningConfig {
  const filePath = getTuningConfigPath();

  try {
    if (!existsSync(filePath)) {
      cached = factoryConfig();
      cachedMtimeMs = 0;
      return cached;
    }

    const stat = statSync(filePath);
    if (cached && stat.mtimeMs === cachedMtimeMs) {
      return cached;
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      cached = factoryConfig();
      cachedMtimeMs = stat.mtimeMs;
      return cached;
    }

    cached = factoryConfig(parsed as Partial<TuningConfig>);
    cachedMtimeMs = stat.mtimeMs;
    return cached;
  } catch (err) {
    console.warn("[tuning-config] Failed to load, using neutral 1.0:", err);
    cached = factoryConfig();
    cachedMtimeMs = 0;
    return cached;
  }
}

/** Persist multipliers (always clamped) and refresh the in-memory cache. */
export function saveTuningConfig(config: TuningConfig): TuningConfig {
  const payload = factoryConfig(config);
  const filePath = getTuningConfigPath();
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  cached = payload;
  try {
    cachedMtimeMs = statSync(filePath).mtimeMs;
  } catch {
    cachedMtimeMs = Date.now();
  }
  return payload;
}

/** Emergency wipe: restore factory-neutral 1.0 multipliers. */
export function resetTuningConfig(): TuningConfig {
  const config = factoryConfig({
    lastCalibratedAt: new Date().toISOString(),
    totalBetsAnalyzed: 0,
    leagueMultipliers: {},
    marketMultipliers: {},
  });

  try {
    return saveTuningConfig(config);
  } catch (err) {
    console.warn("[tuning-config] reset write failed; in-memory defaults:", err);
    cached = config;
    cachedMtimeMs = 0;
    return config;
  }
}

export function invalidateTuningConfigCache(): void {
  cached = null;
  cachedMtimeMs = 0;
}
