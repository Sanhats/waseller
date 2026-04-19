# Redis en el mismo proyecto Railway (BullMQ)

Waseller usa **una sola** variable `REDIS_URL` (ver `packages/queue/src/queues.ts`). En Railway conviene un **servicio Redis** dentro del mismo proyecto y que **workers** y **WhatsApp** referencien esa URL (red privada, sin TLS: `redis://`).

## 1. Crear el servicio Redis

1. En tu **proyecto** de Railway: **+ New** (o `Ctrl/Cmd + K` → buscar *Redis*).
2. Elegí **Redis** (template oficial: imagen `redis` de Docker Hub).
3. Esperá a que el deploy quede **Active**.

No hace falta exponer Redis a internet para Waseller: los workers y WhatsApp hablan por **red interna** del proyecto.

## 2. Variables que genera Railway

En el servicio Redis, Railway suele definir (nombres típicos):

- `REDIS_URL` — URL completa (la que más nos importa)
- `REDISHOST`, `REDISPORT`, `REDISUSER`, `REDISPASSWORD`

Documentación: [Redis on Railway](https://docs.railway.app/guides/redis).

## 3. Enlazar `REDIS_URL` a workers y WhatsApp

En el servicio **workers** (y en **WhatsApp**, si encola mensajes):

1. **Variables** → **Add variable** → **Reference variable**.
2. Elegí el servicio Redis y la variable **`REDIS_URL`**.
3. Railway guarda algo equivalente a `${{NombreDelServicioRedis.REDIS_URL}}` (el prefijo coincide con el **nombre del servicio** en el canvas, p. ej. `Redis`).

**Importante:** no pegues a mano `redis://127.0.0.1:6379` en Railway: eso es solo local.

### Si ves errores de DNS con la URL interna

Algunos entornos reportan problemas con la resolución del host de `REDIS_URL`. En ese caso probá añadir a la URL (solo si hace falta):

`?family=0`

(ver [ayuda de Railway](https://station.railway.com/questions/redis-url-suddenly-not-working-from-servi-3c232450) y discusiones similares).

## 4. Formato y TLS

- Redis **dentro de Railway** (imagen oficial): suele ser **`redis://`** (sin TLS). El código ya usa `tls` solo cuando la URL empieza con `rediss://`.
- **Upstash** sigue siendo `rediss://` (TLS); no mezcles conceptos entre proveedores.

## 5. Vercel (dashboard / Next)

El dashboard en Vercel **no necesita** `REDIS_URL` para listar leads si el API usa solo Postgres. Dejá `REDIS_URL` solo en los servicios que ejecutan **BullMQ** (workers, WhatsApp).

## 6. Datos y reinicios

El template Redis de Railway es **no gestionado**: si el contenedor se recrea sin **volumen**, se pierde lo que hubiera en memoria (colas BullMQ, locks, etc.). Para colas suele ser aceptable; para **persistencia** revisá [volúmenes y backups](https://docs.railway.app/volumes/backups).

## 7. Coste

Redis en Railway consume **RAM/CPU** del plan del proyecto (no es “gratis” aparte de los créditos del plan). Suele ser **más estable** que un free tier de Redis serverless con tope de comandos para BullMQ.

## 8. Probar que la conexión funciona

### Opción A — Script del repo (recomendado)

En la raíz del monorepo, con dependencias instaladas (`npm install`):

```bash
REDIS_URL='redis://...' npm run redis:check
```

Hace `PING`, un `SET`/`GET`/`DEL` de prueba y, si ya corrieron workers, lista longitudes aproximadas de algunas colas BullMQ.

**Desde tu PC con la misma URL que Railway:** copiá `REDIS_URL` del servicio Redis (o la referencia resuelta en variables) y ejecutá el comando. Si la URL solo es válida **dentro** de la red de Railway, usá la opción B.

### Opción B — One-off en Railway

Con [Railway CLI](https://docs.railway.app/develop/cli) vinculado al proyecto y al servicio **workers** (o uno que tenga `REDIS_URL`):

```bash
railway run npm run redis:check
```

Así el proceso corre **en la red del proyecto** y usa la variable ya referenciada.

### Opción C — `redis-cli` (si lo tenés instalado)

```bash
redis-cli -u "$REDIS_URL" PING
```

Debería responder `PONG`. Para Redis solo accesible por TCP proxy público, usá esa URL/host que exponga Railway.

### Opción D — Comportamiento real

Si los **workers** arrancan sin errores de Redis y al mandar un mensaje de WhatsApp ves actividad en logs (incoming → cola → processor), la conexión está bien a nivel aplicación.
