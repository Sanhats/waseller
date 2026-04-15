# Stack de producción (decisión actual)

| Capa | Proveedor | Rol |
|------|-----------|-----|
| Web + API HTTP (Next, `/api`) | **Vercel** | Dashboard, auth, REST, webhooks que viven en Route Handlers. |
| Postgres | **Supabase** | `DATABASE_URL` con **pooler** (connection pooling / `pooler.supabase.com`) para Prisma en serverless. |
| Redis (BullMQ) | **Upstash** | Colas compartidas entre Vercel (enqueue) y workers (consumo). Usá la URL TLS que indique Upstash (`rediss://…`). |
| Workers (procesamiento colas, LLM, sender, etc.) | **Railway** | Repo `waseller-railway-workers`: `npm run build` → `npm start` (ver `npm run export:railway` en el monorepo). |
| WhatsApp (Baileys) | **Railway** | Repo `waseller-railway-whatsapp`: mismo patrón; volumen o storage para `WA_AUTH_DIR` si persistís sesión. |

Build raíz para Vercel: `npm run build` (packages + dashboard). Workers y WhatsApp: cada repo exportado tiene su propio `package.json` con `build` y `start`; desplegás **dos servicios** en Railway apuntando a cada repo.

Checklist de rutas API: `infra/api-route-parity.md`.

## Variables por plataforma

### Vercel (Next)

- `DATABASE_URL` — Supabase **pooled**.
- `REDIS_URL` — Upstash (misma URL que usan los workers).
- `AUTH_*`, `PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_*` que uses, Mercado Pago, `PAYMENT_SECRET_KEY` si aplica.
- `WHATSAPP_SERVICE_URL` — URL pública HTTPS del servicio WhatsApp en Railway.

### Railway — Workers

- `DATABASE_URL`, `REDIS_URL`, `OPENAI_API_KEY`, `LLM_*`, `SENDER_*`, `WORKER_METRICS_*`, etc. (mismas variables que antes en `apps/workers`).
- Sin `NEXT_PUBLIC_*` salvo que algún código server lo lea por error.

### Railway — WhatsApp

- `DATABASE_URL` si el servicio toca DB; `REDIS_URL` si encola; `WA_SESSION_SECRET`, `WA_AUTH_DIR`, `WHATSAPP_PORT` (expuesto por Railway en el dominio público del servicio).
- URL pública de esta app = valor de `WHATSAPP_SERVICE_URL` en Vercel.

### Supabase / Upstash

- No suelen llevar variables del repo: solo copiás connection strings al resto de servicios.

## Postgres (serverless + Prisma)

Seguí usando URL con **pooler** de Supabase. Opcional: [Prisma Accelerate](https://www.prisma.io/data-platform/accelerate) si más adelante querés otra capa de conexiones.

## Timeouts y rutas pesadas

| Área | Nota |
|------|------|
| LLM / jobs largos | En **workers en Railway**, no en Vercel. |
| `POST /api/messages/incoming` | Vercel encola rápido; consumo en Railway. |
| Webhooks Mercado Pago | Vercel; `PUBLIC_API_BASE_URL` = dominio Vercel (o custom). |

Detalle: `infra/api-timeouts-audit.md`.

## Railway — notas prácticas

- Dos **proyectos** o dos **servicios** desde los repos `waseller-railway-workers` y `waseller-railway-whatsapp` (cada uno con variables y dominio propio).
- Región cercana a usuarios y a Supabase/Upstash para latencia.
- Secretos: variables del servicio en el dashboard de Railway (o CLI).
