import { redisConnection } from "@waseller/queue";

/**
 * Rate limit fixed-window con INCR + EXPIRE en Redis.
 *
 * Implementación intencionalmente simple: bucket de tamaño `windowSec` que cuenta hits.
 * El primer hit del bucket setea TTL = windowSec; los siguientes solo incrementan.
 * Cuando vence el TTL, Redis borra la key y arranca un bucket nuevo.
 *
 * Por qué fixed-window y no sliding: alcanza para protegerse contra abuso obvio (scraping
 * masivo, bot que spamea checkouts) y no requiere Lua script ni sorted sets. Si necesitamos
 * precisión de borde de ventana, migramos a sliding después.
 *
 * IMPORTANTE: el cliente ioredis está configurado con `maxRetriesPerRequest: null` (lo exige
 * BullMQ). Si Redis no responde, el comando se cuelga indefinido. Por eso wrapeamos con
 * Promise.race + timeout y, si falla, **fail-open** (dejamos pasar el request) para no
 * romper el endpoint si Redis está temporalmente inaccesible. El fail-open es deliberado:
 * preferimos aceptar el riesgo de un burst momentáneo a tirar 503 a usuarios legítimos.
 */
export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetSec: number;
  limit: number;
};

const REDIS_TIMEOUT_MS = 1500;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Redis timeout (${timeoutMs}ms)`)), timeoutMs)
    ),
  ]);
}

export async function rateLimit(
  key: string,
  max: number,
  windowSec: number
): Promise<RateLimitResult> {
  const fullKey = `rl:${key}`;
  try {
    const count = await withTimeout(redisConnection.incr(fullKey), REDIS_TIMEOUT_MS);
    /** Solo seteamos TTL en el primer hit para no resetear la ventana cada vez. */
    if (count === 1) {
      await withTimeout(redisConnection.expire(fullKey, windowSec), REDIS_TIMEOUT_MS);
    }
    const remaining = Math.max(0, max - count);
    let resetSec = windowSec;
    /** Tomamos el TTL real para devolver Retry-After preciso (no siempre = windowSec). */
    if (count > max) {
      const ttl = await withTimeout(redisConnection.ttl(fullKey), REDIS_TIMEOUT_MS);
      resetSec = ttl > 0 ? ttl : windowSec;
    }
    return {
      ok: count <= max,
      remaining,
      resetSec,
      limit: max,
    };
  } catch (e) {
    /** Fail-open: si Redis está caído no rompemos el endpoint. Logueamos para monitor. */
    console.error("[rate-limit] Redis no disponible, dejando pasar:", e);
    return { ok: true, remaining: max, resetSec: windowSec, limit: max };
  }
}

/** Extrae IP del request respetando proxies (Vercel, CF). Cae a "unknown" si no se puede. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
