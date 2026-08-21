# ⚽ CareWeaPredictions - Sports Analytics & Betting Prediction Engine

![Next.js](https://img.shields.io/badge/Next.js-App%20Router-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-38B2AC?style=flat-square&logo=tailwind-css)
![Neon](https://img.shields.io/badge/Neon-PostgreSQL-00E699?style=flat-square&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma)
![License](https://img.shields.io/badge/license-Private-lightgrey?style=flat-square)

Motor de predicción basado en modelos de **Poisson** y análisis estadístico para fútbol. CareWeaPredictions combina datos en vivo de API-Football con probabilidades modeladas para generar picks de alta confianza y combinadas de alta cuota.

> ⚠️ **Disclaimer:** Solo fines educativos. El juego puede ser adictivo. +18.

---

## ✨ Features Clave

- 🔴 **Integración en tiempo real con API-Football** — fixtures live sin datos mock.
- 🎲 **Generador de combinadas de alta cuota (Modo Diversión)** — parlays automáticos en un clic.
- 🛡️ **Selección de Picks Individuales de Alta Probabilidad (Modo Seguro)** — mercados con probabilidad elevada y cuotas controladas.
- 📊 **Panel de estadísticas dinámico** — liquidación automática (FT/AET/PEN) y métricas solo sobre liquidados.
- 💾 **Persistencia en Neon (PostgreSQL)** — historial, stats, bankroll y perfiles se comparten entre PCs.
- 👥 **Perfiles de equipo** — forma rolling, splits local/visita, lesiones y guards contextuales (`/teams`).
- 💰 **Bankroll + Kelly** — stake sugerido, débito/reembolso y sync en Neon.
- 🛰️ **Enrich multi-fuente (opcional)** — ESPN, clima, Odds API y standings sin sustituir API-Football.
- 🧭 **Guía de casas chilenas** — pestaña exacta (Betano / JugaBet / Coolbet) y warnings anti-error.

Catálogo completo: [`docs/FEATURES.md`](./docs/FEATURES.md).

---

## 🧰 Tech Stack

| Tecnología | Uso |
|------------|-----|
| **Next.js** (App Router) | Framework full-stack |
| **TypeScript** | Tipado estricto |
| **Tailwind CSS** | Estilos utilitarios |
| **shadcn/ui** | Componentes de interfaz |
| **Recharts** | Visualización de estadísticas |
| **Neon** (PostgreSQL serverless) | Base de datos en la nube (plan Free) |
| **Prisma** | ORM + migraciones (`prisma/schema.prisma`) |
| **Poisson / Dixon-Coles** | Modelo de predicción (`lib/poisson.ts`) |
| **Zod** | Validación de entorno (`lib/env.ts`) |
| **Vercel Cron** | Auto-settlement cada 2 h (`vercel.json`) |

---

## 🗄️ Base de datos: Neon (PostgreSQL)

La app **ya no usa SQLite local** como fuente de verdad. Persistimos analytics, tickets y bankroll en **[Neon](https://neon.tech)** — PostgreSQL serverless — para que el historial sea el mismo en el PC del trabajo y en casa.

### Por qué Neon

- Misma base para todos los entornos (sin copiar `dev.db` a mano).
- Plan Free suficiente para desarrollo / portfolio.
- Compatible con Prisma (`DATABASE_URL` pooled + `DIRECT_URL` directa).
- Migraciones versionadas en `prisma/migrations/`.

### Qué se guarda

| Modelo / área | Contenido |
|---------------|-----------|
| `MatchFixture` | Snapshots de partidos y marcadores |
| `Prediction` | Legs / picks (cuotas, probabilidad, closing odds, outcome) |
| `AccumulatorTicket` | Combinadas y picks individuales registrados |
| `CachedApiResponse` / cuota API | Caché HTTP y contadores de rate-limit |
| `BankrollSettings` | Banca y límites de riesgo sincronizados |
| `TeamProfile` | Forma, splits local/visita, lesiones y guards |

Conexión en código: Prisma + adapter Neon (`lib/db.ts`). Plantilla de URLs: [`.env.example`](./.env.example). Guías: [`docs/NEON.md`](./docs/NEON.md) · [`docs/FEATURES.md`](./docs/FEATURES.md).

### Variables requeridas

```env
# Pooled (host con -pooler) → app Next.js
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15"

# Directa (sin -pooler) → prisma migrate / db push
DIRECT_URL="postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

> ⚠️ Nunca subas `.env` / `.env.local` con credenciales reales. Solo el ejemplo con placeholders.

---

## 🚀 Instalación y Configuración

### 1. Clonar el repositorio

```bash
git clone https://github.com/Jaime-SC/CareWeaPredictions.git
cd CareWeaPredictions
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Copia el ejemplo a `.env` (Prisma CLI) y `.env.local` (Next.js):

```bash
cp .env.example .env
cp .env.example .env.local
```

1. Crea un proyecto en [Neon](https://console.neon.tech) (plan Free).
2. En **Connect**, copia las URLs **pooled** (`DATABASE_URL`, host con `-pooler`) y **direct** (`DIRECT_URL`).
3. Pega las mismas dos URLs en `.env` y `.env.local`.
4. Añade tu API key de [API-Football](https://www.api-football.com/) en `.env.local`:

```env
FOOTBALL_API_KEY=tu_api_key_aqui
```

Opcional (enrich / backtest):

```env
# ODDS_API_KEY=
# FOOTBALL_DATA_API_KEY=
```

5. Crea las tablas y, si vienes de SQLite local, importa el historial:

```bash
npx prisma generate
npm run db:migrate
npm run db:import-sqlite
```

Si la red bloquea el puerto 5432 (común en oficinas), usa HTTPS:

```bash
npm run db:migrate:http
npm run db:import-sqlite
```

### 4. Iniciar el servidor de desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

---

## 📁 Rutas principales

| Ruta | Descripción |
|------|-------------|
| `/` | Landing |
| `/dashboard` | Safe picks sobre fixtures live |
| `/builder` | Generador de combinada (Modo Diversión) |
| `/stats` | Analytics + historial + sync de marcadores |
| `/teams` | Perfiles de equipo (forma, venue, lesiones) |
| `/health` | Salud del algoritmo / calibración |
| `/api/matches` | Partidos live |
| `/api/predict` | Predicciones Poisson |
| `/api/parlay` | Generar acumulador automático |
| `/api/settle` | Liquidar tickets PENDING |
| `/api/results` | Verificación de marcadores |
| `/api/bankroll` | Banca persistida en Neon |
| `/api/teams/profiles` | Perfiles de equipo |
| `/api/cron/settle` | Cron de liquidación (Vercel) |

---

## 🛡️ Criterios del Modo Seguro

Un mercado se considera “safe” cuando cumple:

- Probabilidad del modelo **≥ 80%**
- Cuotas entre **1.15** y **1.35**

---

## 📜 Scripts disponibles

```bash
npm run dev              # Servidor de desarrollo
npm run build            # Build de producción
npm run start            # Servidor de producción
npm run lint             # ESLint
npm run smoke            # Smoke tests
npm run db:migrate       # Aplicar migraciones Prisma en Neon (puerto 5432)
npm run db:migrate:http  # Igual, por HTTPS si 5432 está bloqueado
npm run db:import-sqlite # Copiar historial local (prisma/dev.db) a Neon
```

---

## 🧭 Estándares de código (Ponytail)

El repo incluye reglas YAGNI para Cursor/agentes. Detalle en [`RULES.md`](./RULES.md) y [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Archivos que deben versionarse (para que funcionen en casa u otro PC):

- `.cursor/rules/ponytail.mdc`
- `.cursorrules`
- `RULES.md`
- `CONTRIBUTING.md`

---

## 📄 Licencia

Proyecto de portfolio / uso educativo. Todos los derechos reservados salvo que se indique lo contrario.
