import {
  getServers,
  setDefaultResultOrder,
  setServers,
} from "node:dns";
import { PrismaClient } from "@prisma/client";
import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import { neon, types as pgTypes } from "@neondatabase/serverless";
import { env } from "./env";

// Neon HTTP → api.<region>.aws.neon.tech. Router DNS (192.168.x.1) often
// returns ENOTFOUND / EAI_AGAIN / connect timeouts; prefer public resolvers.
setDefaultResultOrder("ipv4first");
{
  const publicDns = ["1.1.1.1", "8.8.8.8"];
  const current = getServers();
  setServers([
    ...publicDns,
    ...current.filter((s) => !publicDns.includes(s)),
  ]);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  neonSql: ReturnType<typeof neon> | undefined;
  prismaSchemaId?: string;
};

/** Bump when Prisma schema fields change so a stale singleton is dropped. */
const PRISMA_SCHEMA_ID = "team-profile-advanced-v2";

if (globalForPrisma.prismaSchemaId !== PRISMA_SCHEMA_ID) {
  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaSchemaId = PRISMA_SCHEMA_ID;
}

const databaseUrl = env.DATABASE_URL;

/** Postgres OIDs whose default JS Date parser breaks Prisma (P2023: found {}). */
const PG_DATE = 1082;
const PG_TIME = 1083;
const PG_TIMESTAMP = 1114;
const PG_TIMESTAMPTZ = 1184;
const PG_TIMETZ = 1266;

/**
 * Prisma driver adapters expect DateTime/Date/Time as strings.
 * PrismaNeonHTTP 5.22 does not pass these parsers; Neon then returns Date
 * objects that serialize to `{}`.
 */
const prismaHttpTypes = {
  getTypeParser(oid: number, format?: string) {
    if (format !== "binary") {
      if (oid === PG_TIMESTAMP || oid === PG_DATE || oid === PG_TIME) {
        return (value: string) => value;
      }
      if (oid === PG_TIMESTAMPTZ || oid === PG_TIMETZ) {
        return (value: string) => value.split("+")[0];
      }
    }
    if (format === "binary") {
      return pgTypes.getTypeParser(oid, "binary");
    }
    return pgTypes.getTypeParser(oid, "text");
  },
};

function createNeonHttpClient(url: string): ReturnType<typeof neon> {
  const sql = neon(url);
  const query = ((
    queryText: string,
    params?: unknown[],
    opts?: Record<string, unknown>
  ) =>
    sql(queryText, params as never[], {
      ...opts,
      types: prismaHttpTypes as typeof pgTypes,
    })) as ReturnType<typeof neon>;
  return Object.assign(query, sql);
}

const neonSql =
  globalForPrisma.neonSql ?? createNeonHttpClient(databaseUrl);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaNeonHTTP(neonSql),
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.neonSql = neonSql;
}
