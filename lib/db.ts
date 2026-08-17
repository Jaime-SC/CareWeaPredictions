import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;
// Queries go over HTTPS (port 443). Needed on networks that block Postgres 5432.
neonConfig.poolQueryViaFetch = true;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  neonPool: Pool | undefined;
};

function assertPostgresUrl(url: string | undefined): asserts url is string {
  if (!url || url.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL debe ser la cadena PostgreSQL de Neon, no SQLite. Copia DATABASE_URL y DIRECT_URL desde https://console.neon.tech a .env y .env.local"
    );
  }
}

assertPostgresUrl(process.env.DATABASE_URL);

const pool =
  globalForPrisma.neonPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaNeon(pool),
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.neonPool = pool;
}
