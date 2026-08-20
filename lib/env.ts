import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL es requerida.")
    .refine((url) => !url.startsWith("file:"), {
      message:
        "DATABASE_URL debe ser la cadena PostgreSQL de Neon, no SQLite. Copia DATABASE_URL y DIRECT_URL desde https://console.neon.tech a .env y .env.local",
    }),
  DIRECT_URL: z.string().optional(),
  FOOTBALL_API_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  API_FOOTBALL_DAILY_LIMIT: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

function parseEnv(): AppEnv {
  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    FOOTBALL_API_KEY: process.env.FOOTBALL_API_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    API_FOOTBALL_DAILY_LIMIT: process.env.API_FOOTBALL_DAILY_LIMIT,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => issue.message)
      .join("; ");
    throw new Error(`Variables de entorno inválidas: ${detail}`);
  }

  return parsed.data;
}

export const env = parseEnv();
