# ⚽ CareWeaPredictions - Sports Analytics & Betting Prediction Engine

![Next.js](https://img.shields.io/badge/Next.js-App%20Router-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-38B2AC?style=flat-square&logo=tailwind-css)
![License](https://img.shields.io/badge/license-Private-lightgrey?style=flat-square)

Motor de predicción basado en modelos de **Poisson** y análisis estadístico para fútbol. CareWeaPredictions combina datos en vivo de API-Football con probabilidades modeladas para generar picks de alta confianza y combinadas de alta cuota.

> ⚠️ **Disclaimer:** Solo fines educativos. El juego puede ser adictivo. +18.

---

## ✨ Features Clave

- 🔴 **Integración en tiempo real con API-Football** — fixtures live sin datos mock.
- 🎲 **Generador de combinadas de alta cuota (Modo Diversión)** — parlays automáticos en un clic.
- 🛡️ **Selección de Picks Individuales de Alta Probabilidad (Modo Seguro)** — mercados con probabilidad elevada y cuotas controladas.
- 📊 **Panel de estadísticas dinámico** — verificación automática de marcadores reales.
- 💾 **Persistencia en Neon (PostgreSQL)** — historial, stats y predicciones se comparten entre PCs.

---

## 🧰 Tech Stack

| Tecnología | Uso |
|------------|-----|
| **Next.js** (App Router) | Framework full-stack |
| **TypeScript** | Tipado estricto |
| **Tailwind CSS** | Estilos utilitarios |
| **shadcn/ui** | Componentes de interfaz |
| **Recharts** | Visualización de estadísticas |
| **Poisson / Dixon-Coles** | Modelo de predicción (`lib/poisson.ts`) |

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
| `/api/matches` | Partidos live |
| `/api/predict` | Predicciones Poisson |
| `/api/parlay` | Generar acumulador automático |
| `/api/results` | Verificación de marcadores |

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

## 📄 Licencia

Proyecto de portfolio / uso educativo. Todos los derechos reservados salvo que se indique lo contrario.
