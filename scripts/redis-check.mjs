/**
 * Comprueba REDIS_URL: PING, lectura/escritura breve y opcionalmente colas BullMQ.
 * Uso: REDIS_URL='redis://...' node scripts/redis-check.mjs
 *      npm run redis:check
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let IORedis;
try {
  IORedis = require("ioredis");
} catch {
  console.error(
    "No se encontró ioredis. Ejecutá desde la raíz del repo después de `npm install` (workspace @waseller/queue)."
  );
  process.exit(1);
}

const url = process.env.REDIS_URL?.trim();
if (!url) {
  console.error("Definí REDIS_URL (ej. export REDIS_URL='redis://...' o en .env).");
  process.exit(1);
}

const options = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 15_000,
  /** Pocas reconexiones y cortamos: es un chequeo puntual, no un worker. */
  retryStrategy(times) {
    if (times > 4) return null;
    return 400;
  },
  ...(url.startsWith("rediss://") ? { tls: {} } : {})
};

const client = new IORedis(url, options);
client.on("error", (err) => {
  if (process.env.REDIS_CHECK_VERBOSE === "1") console.error("[redis-check]", err?.message ?? err);
});
const key = `waseller:redis-check:${Date.now()}`;

try {
  const pong = await client.ping();
  if (pong !== "PONG") {
    console.error("PING inesperado:", pong);
    process.exit(1);
  }
  console.log("PING → PONG");

  await client.set(key, "ok", "EX", 10);
  const val = await client.get(key);
  await client.del(key);
  if (val !== "ok") {
    console.error("SET/GET falló:", val);
    process.exit(1);
  }
  console.log("SET/GET/DEL → ok");

  const prefixes = [
    "bull:incoming_messages",
    "bull:lead_processing",
    "bull:outgoing_messages",
    "bull:llm_orchestration"
  ];
  let anyBull = false;
  for (const p of prefixes) {
    const exists = await client.exists(`${p}:meta`);
    if (exists) {
      anyBull = true;
      const n = await client.llen(`${p}:wait`);
      console.log(`${p}: cola wait length ≈ ${n} (meta existe)`);
    }
  }
  if (!anyBull) {
    console.log(
      "BullMQ: aún no hay claves meta de colas (normal en Redis nuevo o sin workers encolando todavía)."
    );
  }

  console.log("\nRedis responde bien para Waseller.");
  process.exit(0);
} catch (err) {
  const msg = String(err?.message ?? err);
  let hint = "";
  if (/ECONNREFUSED/i.test(msg)) hint = " Revisá host/puerto y que Redis esté levantado.";
  if (/ENOTFOUND/i.test(msg)) hint = " El hostname no resolvió (¿URL interna de Railway desde fuera de Railway?).";
  if (/Connection is closed|ECONNRESET/i.test(msg))
    hint = " No hubo conexión estable a Redis (rechazo, TLS incorrecto o host inaccesible).";
  if (/NOAUTH|WRONGPASS/i.test(msg)) hint = " Usuario/contraseña de REDIS_URL incorrectos.";
  console.error("Error de conexión o comando:", msg + hint);
  process.exit(1);
} finally {
  await client.quit().catch(() => {});
}
