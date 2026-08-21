# Base de datos: Neon PostgreSQL

CareWeaPredictions usa **[Neon](https://neon.tech)** como PostgreSQL serverless en la nube.

## Resumen

| Aspecto | Detalle |
|---------|---------|
| Motor | PostgreSQL (Neon Free) |
| ORM | Prisma (`prisma/schema.prisma`) |
| Cliente | `@prisma/client` + `@prisma/adapter-neon` (`lib/db.ts`) |
| Migraciones | `prisma/migrations/` |

SQLite (`prisma/dev.db`) solo sirve como origen opcional para importar historial antiguo (`npm run db:import-sqlite`). La fuente de verdad es Neon.

## Setup rápido

1. Crea un proyecto en [console.neon.tech](https://console.neon.tech).
2. En **Connect**, copia:
   - **Pooled** → `DATABASE_URL` (el host incluye `-pooler`).
   - **Direct** → `DIRECT_URL` (sin `-pooler`).
3. Pega ambas en `.env` y `.env.local` (misma pareja en trabajo y casa).
4. Aplica el schema:

```bash
npx prisma generate
npm run db:migrate
```

Si la red bloquea el puerto **5432** (oficinas / firewall):

```bash
npm run db:migrate:http
```

## Qué datos viven en Neon

- Fixtures y marcadores (`MatchFixture`)
- Predicciones / legs (`Prediction`), incluyendo closing odds
- Tickets registrados (`AccumulatorTicket`)
- Caché de respuestas API-Football y cuota diaria
- Configuración de bankroll (`BankrollSettings`)
- Perfiles de equipo (`TeamProfile`: forma, venue splits, guards)

Así, stats, liquidación, banca y perfiles quedan alineados entre PCs.

## Scripts útiles

```bash
npm run db:generate      # prisma generate
npm run db:migrate       # migrate deploy (5432)
npm run db:migrate:http  # migraciones vía HTTPS (Neon serverless)
npm run db:studio        # Prisma Studio
npm run db:import-sqlite # one-shot: SQLite local → Neon
```

## Seguridad

- No commits de `.env` / `.env.local`.
- Usa solo placeholders en `.env.example`.
- Si una URL se filtró, rótala en el dashboard de Neon.
