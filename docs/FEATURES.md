# Features y arquitectura de CareWeaPredictions

Resumen de lo montado en el producto (motor Poisson + Neon + UI). Detalle de base de datos en [`NEON.md`](./NEON.md).

## Módulos principales

| Área | Qué hace | Dónde |
|------|----------|--------|
| Predicción Poisson / Dixon-Coles | Probabilidades y λ por partido | `lib/poisson.ts` |
| Generador de parlays | Combinadas (Modo Diversión) y backfill | `lib/parlay-generator.ts` |
| Safe picks | Picks individuales de alta probabilidad | Dashboard + `lib/filters.ts` |
| Liquidación | Marca WON/LOST/VOID con FT/AET/PEN | `lib/settlement.ts`, `/api/settle` |
| Stats / ROI | Solo tickets liquidados (no PENDING) | `lib/stats.ts`, `/stats` |
| Bankroll | Banca Kelly + sync Neon | `lib/bankroll-*`, `/api/bankroll` |
| Team profiles | Forma, venue splits, lesiones, managers | `lib/team-profiler.ts`, `/teams` |
| Auto-tuning | Recalibra pesos por liga/mercado | `lib/auto-tuner.ts`, `/api/auto-tune` |
| Brier learning | Factores de calibración por error de probabilidad | `lib/learning-engine.ts`, settle cron |
| AI Judge (opcional) | Auditoría cualitativa Gemini + Google Search | `lib/ai-judge.ts`, badge en slip/picks |
| Multi-source enrich | ESPN, clima, Odds API (gaps), standings | `lib/sources/*`, `lib/standings.ts` |
| Readiness / CLV / stakes | Gate pre-apuesta, closing odds, Kelly | `lib/readiness.ts`, `lib/clv-tracker.ts`, `lib/stake-engine.ts` |
| Monopoly / knockout | Filtros de equipos dominantes y copas | `lib/monopoly-engine.ts`, `lib/knockout-engine.ts` |
| Ligas / origen | Whitelist, labels Serie A/UEFA/CONMEBOL, season map | `config/allowed-leagues.ts`, `types/leagues.ts` |
| Guía casas (Chile) | Tabs Betano/JugaBet/Coolbet + warnings | `lib/formatters.ts` |

## Pantallas

| Ruta | Descripción |
|------|-------------|
| `/` | Landing |
| `/dashboard` | Safe picks live |
| `/builder` | Generador de combinada + modos |
| `/stats` | Analytics, historial, sync de marcadores |
| `/teams` | Perfiles de equipo (Neon) |
| `/health` | Salud del algoritmo / calibración |

## APIs destacadas

| Endpoint | Uso |
|----------|-----|
| `GET/POST /api/matches` | Fixtures live (API-Football) |
| `POST /api/predict` | Predicciones Poisson |
| `POST /api/parlay` | Generar acumulador |
| `POST /api/settle` | Liquidar tickets PENDING |
| `GET /api/stats/summary` | Resumen analytics |
| `GET /api/stats` | Stats agregadas |
| `POST /api/bets/record` | Registrar ticket en Neon |
| `GET/PATCH /api/bankroll` | Banca persistida |
| `GET /api/teams/profiles` | Perfiles de equipo |
| `POST /api/model/calibrate` | Recalibrar pesos |
| `POST /api/auto-tune` | Auto-tuning desde historial |
| `GET /api/cron/settle` | Cron Vercel (cada 2 h) |
| `GET /api/backtest` | Backtest opcional (Football-Data.org) |
| `GET /api/quota` | Cuota API-Football (headers) |

## Fuentes de datos

1. **API-Football** (principal) — fixtures, odds, lesiones, resultados.
2. **Neon PostgreSQL** — historial, perfiles, bankroll, caché.
3. **Enrich opcional** (`lib/sources/`):
   - ESPN — contexto de ausencias (soft-fail).
   - Open-Meteo — clima del venue.
   - The Odds API — relleno de cuotas faltantes (`ODDS_API_KEY`).
   - Football-Data.org — backtest (`FOOTBALL_DATA_API_KEY`).
   - Standings — tabla/contexto de liga (`lib/standings.ts`).
4. **Gemini AI Judge** (opcional) — última pasada cualitativa con grounding (`GEMINI_API_KEY`).

## Variables opcionales

```env
# GEMINI_API_KEY=          # AI Judge (Gemini 2.5 Flash + Search)
# ODDS_API_KEY=            # The Odds API
# FOOTBALL_DATA_API_KEY=   # Football-Data.org backtest
```

## Persistencia Neon (modelos)

- `MatchFixture`, `Prediction`, `AccumulatorTicket`
- `CachedApiResponse`, `ApiQuotaDaily`
- `BankrollSettings`
- `TeamProfile` (forma, venue splits, guards contextuales)

Ver [`NEON.md`](./NEON.md).

## Criterios Modo Seguro

- Probabilidad del modelo ≥ **80%**
- Cuotas tipicamente entre **1.15** y **1.35** (ajustable por pesos)

Win Rate y ROI se calculan **solo** con boletos `WON` / `LOST`. Los `PENDING` no distorsionan el rendimiento.
