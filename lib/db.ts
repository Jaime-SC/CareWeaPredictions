import { PrismaClient } from "@prisma/client";
import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import { neon } from "@neondatabase/serverless";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  neonSql: ReturnType<typeof neon> | undefined;
};

function assertPostgresUrl(url: string | undefined): asserts url is string {
  if (!url || url.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL debe ser la cadena PostgreSQL de Neon, no SQLite. Copia DATABASE_URL y DIRECT_URL desde https://console.neon.tech a .env y .env.local"
    );
  }
}

assertPostgresUrl(process.env.DATABASE_URL);

const neonSql =
  globalForPrisma.neonSql ?? neon(process.env.DATABASE_URL);

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
