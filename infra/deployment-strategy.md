# Estrategia de deploy y migración API

## Objetivo adoptado (decisión)

- **Deploy app principal en Vercel:** el dashboard Next incluye **toda la API HTTP** bajo `/api` (catch-all `app/api/[...slug]/route.ts` + rutas dedicadas `auth` y `health`). Los servicios de negocio siguen en `apps/backend/src/modules` y se importan desde el runtime de Next.
- **Build en CI/Vercel:** en la raíz del repo, `npm run build` ejecuta `build:packages` + build del dashboard. Para compilar también backend/workers/whatsapp usá `npm run build:all`.
- **Workers / WhatsApp / Redis:** no forman parte del deploy serverless del dashboard. Seguís necesitando **Redis** (`REDIS_URL` en Vercel) para encolar mensajes entrantes y procesadores en otro servicio (p. ej. Railway) si querés el pipeline completo.

Checklist histórico de paridad: `infra/api-route-parity.md`.

## Postgres en serverless (Vercel)

Las funciones serverless abren muchas conexiones TCP. Evitar URL directa al primario sin pooler.

1. **Recomendado:** URL con **PgBouncer** / pooler del proveedor (Neon, Supabase pooler, Railway con proxy, etc.). Usá `DATABASE_URL` apuntando al endpoint **pooled** (suele incluir `?pgbouncer=true` o el host `pooler.*`).
2. **Alternativa Prisma:** [Prisma Accelerate](https://www.prisma.io/data-platform/accelerate) — variable `PRISMA_ACCELERATE_URL` y cliente extendido según documentación de tu versión de Prisma.
3. **Next:** el singleton en `apps/dashboard/src/lib/prisma.ts` reutiliza el cliente entre invocaciones en caliente; igual necesitás pooler en la URL para no agotar conexiones bajo carga.

Variables útiles: ver `infra/env/.env.example`.

## Timeouts, colas y rutas pesadas

| Área | Riesgo en Vercel | Acción |
|------|------------------|--------|
| `ops` + LLM | Duración > límite del plan | Mantener ejecución larga en **workers** (Railway); el handler solo encola o consulta estado; o `maxDuration` en rutas Next (plan Pro). |
| `POST /api/messages/incoming` | Debe ser rápido: solo **enqueue** | Ya encola con Bull; adecuado para serverless si Redis es accesible con baja latencia. |
| Webhooks Mercado Pago | Verificación + I/O | Implementar con body raw y timeout razonable; probar en staging. |

Auditoría detallada por endpoint: `infra/api-timeouts-audit.md`.
