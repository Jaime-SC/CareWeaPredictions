/**
 * Smoke: DNS + Neon HTTP query (no writes).
 * Usage: npx tsx scripts/verify-neon-connectivity.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { neon } from "@neondatabase/serverless";

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("file:")) {
    throw new Error("DATABASE_URL debe ser la cadena PostgreSQL de Neon");
  }

  const poolerHost = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  const regionMatch = poolerHost.match(/\.([a-z0-9-]+)\.aws\.neon\.tech$/i);
  const region = regionMatch?.[1] ?? "sa-east-1";
  const apiHost = `api.${region}.aws.neon.tech`;

  console.log("pooler:", poolerHost);
  const dnsStart = Date.now();
  const addrs = await lookup(apiHost, { all: true });
  console.log(
    `DNS ${apiHost}:`,
    addrs.map((a) => a.address).join(", "),
    `(${Date.now() - dnsStart}ms)`
  );

  const sql = neon(url);
  const t0 = Date.now();
  const rows = await sql`select 1 as ok`;
  console.log("query OK:", rows, `(${Date.now() - t0}ms)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
