# CareWeaPredictions — Motor de Predicción Deportiva & Análisis Estadístico

![Next.js](https://img.shields.io/badge/Next.js-16-App%20Router-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-38B2AC?style=flat-square&logo=tailwind-css)
![Neon](https://img.shields.io/badge/Neon-PostgreSQL-00E699?style=flat-square&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-000?style=flat-square&logo=vercel)

Plataforma full-stack de predicción de fútbol que combina **modelos Poisson / Dixon-Coles**, datos de mercado en vivo (API-Football) y una capa opcional de **auditoría con IA (Groq Llama)** antes de registrar picks. Pensada como portfolio de ingeniería de datos aplicada al betting analytics: calibración, liquidación automática, métricas de readiness y despliegue serverless.

> **Disclaimer:** Proyecto con fines educativos y de portfolio. El juego puede ser adictivo. +18.

---

## Descripción general

CareWeaPredictions ingiere fixtures, cuotas, lesiones y contexto (clima, standings, ESPN) para estimar probabilidades por mercado. Sobre ese núcleo estadístico construye dos flujos de producto:

- **Modo Seguro** — picks individuales de alta probabilidad (≥ 80 %) con cuotas controladas.
- **Modo Diversión** — generador automático de parlays (combinadas de alta cuota).

Cada predicción puede pasar por **AI Judge** (Groq Llama 3.3 70B) que valida coherencia cualitativa antes del registro. El historial, bankroll y perfiles viven en **Neon PostgreSQL**; la liquidación corre en background vía **Vercel Cron**.

Catálogo técnico ampliado: [`docs/FEATURES.md`](./docs/FEATURES.md) · Base de datos: [`docs/NEON.md`](./docs/NEON.md).

---

## Features clave

| Área | Descripción |
|------|-------------|
| **Poisson + contexto** | Distribución de goles con ajuste dinámico por ausencias, clima, forma y splits local/visita (`lib/poisson.ts`, `lib/context-enrichment.ts`). |
| **AI Judge (opcional)** | Auditoría en tiempo real con Groq Llama 3.3 70B + caché de veredictos (`lib/ai-judge.ts`). |
| **Parlays automáticos** | Generador de combinadas con ranking, diversidad de ligas y modos configurables (`lib/parlay-generator.ts`, `/builder`). |
| **Picks de valor** | Detección cuando Value% = (Cuota / FairOdds − 1) × 100 ≥ **5 %** (`lib/poisson.ts`, `VALUE_MARGIN_THRESHOLD_PCT`). |
| **Readiness Metrics** | Panel de salud: CLV, Yield, Profit Factor, p-value y drawdown (`lib/readiness.ts`, `/stats`, `/health`). |
| **Liquidación automática** | FT / AET / PEN → WON/LOST; POSTP/CANC/SUSP → VOID (`lib/settlement.ts`). |
| **Vercel Cron** | `/api/cron/settle` cada 2 h (`vercel.json`). |
| **Brier learning** | Calibración continua por error de probabilidad (liga / mercado / equipo). |
| **Bankroll Kelly** | Stakes sugeridos y sync en Neon. |
| **Guía casas Chile** | Labels Betano / JugaBet / Coolbet en slip e historial. |

---

## Tech stack

| Tecnología | Uso |
|------------|-----|
| **Next.js 16** (App Router) | Frontend + API Routes |
| **TypeScript** | Tipado estricto en todo el monorepo |
| **Tailwind CSS 4** | Estilos utilitarios |
| **shadcn/ui** | Componentes (`components/ui/*`) |
| **Recharts** | Gráficos en stats y health |
| **Neon PostgreSQL** | Persistencia serverless |
| **Prisma** | ORM + migraciones |
| **Groq SDK** | AI Judge (Llama 3.3 70B) |
| **Zod** | Validación de entorno (`lib/env.ts`) |
| **Vercel** | Hosting + Cron Jobs |

---

## Instalación y configuración

### 1. Clonar el repositorio

```bash
git clone https://github.com/Jaime-SC/CareWeaPredictions.git
cd CareWeaPredictions
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Variables de entorno

Copia la plantilla y rellena credenciales reales solo en local:

```bash
cp .env.example .env
cp .env.example .env.local
```

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `DATABASE_URL` | Sí | URL pooled de Neon (host con `-pooler`) |
| `DIRECT_URL` | Sí | URL directa para migraciones Prisma |
| `FOOTBALL_API_KEY` | Sí* | API-Football — fixtures, odds, resultados |
| `CRON_SECRET` | Prod | Bearer token para cron y mutaciones sensibles |
| `GROQ_API_KEY` | No | AI Judge |
| `ODDS_API_KEY` | No | The Odds API (fill-gaps) |
| `FOOTBALL_DATA_API_KEY` | No | Football-Data.org (`/api/backtest`) |

\* Sin `FOOTBALL_API_KEY` la app arranca pero no hay datos live.

### 4. Base de datos

```bash
npx prisma generate
npm run db:migrate
```

Si el puerto 5432 está bloqueado (red corporativa):

```bash
npm run db:migrate:http
```

Migración desde SQLite local (opcional):

```bash
npm run db:import-sqlite
```

### 5. Servidor de desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

---

## Despliegue en Vercel

1. Importa el repo en [vercel.com](https://vercel.com) (framework: **Next.js**).
2. Configura las variables de entorno del proyecto (mismas que `.env.example`).
3. Añade `CRON_SECRET` — Vercel Cron envía `Authorization: Bearer <CRON_SECRET>`.
4. Deploy. El cron definido en `vercel.json` ejecutará `/api/cron/settle` cada 2 horas.

Build command (por defecto): `npm run build` → incluye `prisma generate`.

---

## Rutas principales

| Ruta | Descripción |
|------|-------------|
| `/` | Landing |
| `/dashboard` | Safe picks sobre fixtures live |
| `/builder` | Generador de combinada |
| `/stats` | Analytics, readiness, historial |
| `/teams` | Perfiles de equipo |
| `/health` | Salud del algoritmo |
| `/api/predict` | Predicciones Poisson |
| `/api/parlay` | Generar acumulador |
| `/api/settle` | Liquidar tickets PENDING |
| `/api/cron/settle` | Cron de liquidación |

---

## Scripts

```bash
npm run dev              # Desarrollo
npm run build            # Build producción
npm run start            # Servidor producción
npm run lint             # ESLint
npm run smoke            # Smoke tests
npm run db:migrate       # Migraciones Neon (TCP 5432)
npm run db:migrate:http  # Migraciones vía HTTPS
npm run db:import-sqlite # Importar historial SQLite → Neon
```

Scripts de verificación (`scripts/verify-*.ts`) cubren Poisson, ligas, AI Judge, backtest, etc. Ejemplo:

```bash
npx tsx scripts/verify-poisson.ts
```

---

## Criterios Modo Seguro

- Probabilidad del modelo **≥ 80 %**
- Cuotas típicamente entre **1.15** y **1.35**

Win Rate y ROI se calculan **solo** sobre boletos `WON` / `LOST` (excluye `PENDING` y `VOID`).

---

## Estructura del proyecto

```
app/           # App Router (páginas + API routes)
components/    # UI (shadcn + componentes de dominio)
lib/           # Motor Poisson, settlement, AI Judge, sources…
config/        # Ligas permitidas, pesos del modelo
prisma/        # Schema + migraciones Neon
scripts/       # Verificaciones y utilidades de mantenimiento
docs/          # FEATURES.md, NEON.md
```

---

## Contribuir

Estándares YAGNI (Ponytail): [`RULES.md`](./RULES.md) · [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Licencia

Proyecto de portfolio / uso educativo. Todos los derechos reservados salvo indicación contraria.

**Autor:** [Jaime-SC](https://github.com/Jaime-SC)
