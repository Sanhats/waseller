# Waseller

Plataforma SaaS multi-tenant para automatización de ventas por WhatsApp.

## Estructura

- `apps/backend`: API NestJS y receiver de mensajes.
- `apps/dashboard`: dashboard comercial en Next.js.
- `packages/db`: Prisma schema y cliente.
- `packages/queue`: definición de colas y conexión Redis.
- `packages/shared`: tipos y lógica compartida.
- `infra`: docker-compose y variables de entorno.

**Workers (BullMQ) y servicio WhatsApp (Baileys)** se despliegan en Railway desde repos propios. Las carpetas `waseller-railway-workers` y `waseller-railway-whatsapp` se generan en el **directorio padre** de este monorepo con `npm run export:railway` (requiere que existan `apps/workers` y `apps/whatsapp`; si ya no están en el árbol de trabajo, recuperalas con `git restore apps/workers apps/whatsapp` desde un commit que las incluya). Después: `git init`, push a GitHub/GitLab y un servicio Railway por repo (`build`: `npm run build`, `start`: `npm start`).

## Arranque local con Supabase

1. Cargar credenciales de Supabase en `infra/env/.env.example` o en tu `.env`.
2. Crear esquema base en Supabase SQL Editor ejecutando `infra/sql/supabase-init.sql`.
3. Levantar servicios:

```bash
docker compose -f infra/docker-compose.yml up
```

4. Ejecutar smoke check:

```bash
npm run smoke
```

## Login y roles (Iteración 3)

- Endpoint login: `POST /api/auth/login` (requiere header `x-tenant-id`).
- Usuarios soportados por tenant en tabla `app_users`.
- Roles:
  - `admin`: acceso completo
  - `vendedor`: operación comercial (leads + reply)
  - `viewer`: solo lectura
- Endpoints públicos (sin bearer token):
  - `POST /api/auth/login`
  - `POST /api/messages/incoming` (ingesta interna WhatsApp)

Credencial demo semilla:

- `admin@demo.local` / `demo123` (tenant `00000000-0000-0000-0000-000000000001`)

## Servicios que corren por Docker

- `redis`: colas BullMQ y control de rate limit.
- `api`: backend NestJS.
- `dashboard`: frontend Next.js.

Workers y WhatsApp no se levantan con este compose; usá los repos exportados o tus servicios en Railway con las mismas variables que antes (`REDIS_URL`, `DATABASE_URL`, etc.).

PostgreSQL puede ser el servicio `postgres` del compose (ver `infra/env/.env.example`) o Supabase u otro host según `DATABASE_URL`.

## Observabilidad y runbook corto

Workers publican métricas JSON periódicas en logs:

- `queue_metrics` con campos `enqueued`, `processing`, `completed`, `failed`, `retryScheduled`.
- Revisar:
  - Logs del servicio **workers** en Railway (o tu runtime).
  - `docker logs -f infra-api-1`

### Incidentes comunes

1. **Dashboard sin datos / 401**
   - Verificar token en `localStorage` (`ws_auth_token`) y tenant (`ws_tenant_id`).
   - Reloguear por `/login`.

2. **Mensajes no salen**
   - Revisar sesión WhatsApp en la URL pública del servicio Baileys (p. ej. `/sessions`) y que esté `connected`.
   - Revisar logs del worker de envío por errores `WhatsApp send failed`.

3. **Errores de columnas faltantes**
   - Reejecutar `infra/sql/supabase-init.sql`.
   - Reiniciar `api` con `docker compose ... --force-recreate` y el servicio workers en Railway si aplica.

4. **Pool timeout Prisma (P2024)**
   - Bajar concurrencia (`SENDER_CONCURRENCY`, `PROCESSOR_CONCURRENCY`) o subir límites en DB pooler.

## Iteración 4 (alto volumen)

Se agregó soporte para:

- throttling global estricto (`SENDER_GLOBAL_TPS`, `SENDER_GLOBAL_BURST`, `SENDER_GLOBAL_WAIT_MS`)
- batch adaptativo por backlog (`SENDER_BATCH_MIN`, `SENDER_BATCH_MAX`, `SENDER_BATCH_BACKLOG_HIGH`)
- control de concurrencia por tenant (`SENDER_TENANT_MAX_CONCURRENCY`, `SENDER_TENANT_SLOT_*`)
- endpoint operativo `GET /api/ops/queues` (solo rol `admin`)
- panel operativo en dashboard: `/ops`

### Prueba de carga rápida

```bash
SMOKE_TENANT_ID=00000000-0000-0000-0000-000000000001 \
SMOKE_API_BASE_URL=http://127.0.0.1:3000/api \
SMOKE_LOAD_MESSAGES=100 \
npm run load:test
```

Esto verifica:

- login/auth operativo
- ingesta `incoming -> lead`
- encolado masivo de salida
- validación básica de cap global de throughput

## Rollout LLM recomendado (shadow -> activo)

Valores iniciales recomendados en `infra/env/.env.example` o tu `.env`:

- `LLM_ASSIST_ENABLED=true`
- `LLM_ROLLOUT_PERCENT=100`
- `LLM_SHADOW_MODE=true`
- `LLM_KILL_SWITCH=false`
- `LLM_ALLOW_SENSITIVE_ACTIONS=false`
- `LLM_POLICY_HIGH_CONFIDENCE=0.80`
- `LLM_POLICY_MEDIUM_CONFIDENCE=0.60`

### Pasaje gradual a ejecución real

1. **Semana 1 (shadow 100%)**
   - Mantener `LLM_SHADOW_MODE=true`.
   - Monitorear en `/ops`: `fallbackRate`, `decisionPrecisionProxy`, `feedbackNegativeRate`.

2. **Activación parcial (10%)**
   - Cambiar a `LLM_SHADOW_MODE=false`.
   - `LLM_ROLLOUT_PERCENT=10`.
   - Mantener `LLM_ALLOW_SENSITIVE_ACTIONS=false` los primeros días.

3. **Escalado controlado (25% -> 50%)**
   - Subir `LLM_ROLLOUT_PERCENT` a 25 y luego 50 si no hay regresiones.
   - Activar `LLM_ALLOW_SENSITIVE_ACTIONS=true` solo cuando los KPIs sean estables.

4. **Kill-switch inmediato**
   - Ante desvío, setear `LLM_KILL_SWITCH=true` y reiniciar el servicio workers en Railway.
