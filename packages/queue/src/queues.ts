import { existsSync } from "node:fs";
import { JobsOptions, Queue } from "bullmq";
import IORedis from "ioredis";
import type { RedisOptions } from "ioredis";

/**
 * Errores de socket que ioredis/BullMQ suelen reintentar sin acción humana inmediata.
 * Incluye `ECONNREFUSED` (p. ej. Redis apagado en local sin Docker) para no spamear stderr en cada cola.
 */
function isTransientRedisSocketError(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
  return (
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED"
  );
}

export type RedisErrorEmitter = { on(event: "error", listener: (err: unknown) => void): unknown };

/**
 * BullMQ reenvía errores de Redis al `Queue`/`Worker`. Sin ningún listener, Node trata `error` como no manejado y spamea stderr.
 * Los resets TCP a Upstash/Railway suelen ser transitorios.
 */
export function bindTransientRedisSocketErrors(emitter: RedisErrorEmitter, label: string): void {
  emitter.on("error", (err: unknown) => {
    if (isTransientRedisSocketError(err)) return;
    console.error(`[waseller/queue] ${label}`, err);
  });
}

/** BullMQ y otros llaman `duplicate()` en la clase; parchear solo `redisConnection` no basta si el método viene del prototipo. */
let ioredisDuplicatePatched = false;
function patchIoredisDuplicateForTransientSocketErrors(): void {
  if (ioredisDuplicatePatched) return;
  ioredisDuplicatePatched = true;
  type DuplicateFn = (this: IORedis, override?: RedisOptions) => IORedis;
  const proto = IORedis.prototype as unknown as { duplicate: DuplicateFn };
  const originalDuplicate = proto.duplicate;
  proto.duplicate = function duplicateWithTransientErrorHandler(this: IORedis, override?: RedisOptions) {
    const dup = originalDuplicate.call(this, override);
    bindTransientRedisSocketErrors(dup, "redis (ioredis duplicate)");
    return dup;
  };
}

function redactRedisUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return "[url inválida]";
  }
}

/**
 * Si pegaron `redis-cli --tls -u rediss://...`, ioredis interpreta el string entero como path de socket (ENOENT).
 * Solo debe usarse la URL `redis(s)://...`.
 */
function sanitizeRedisUrlInput(value: string): string {
  let trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (!trimmed) return "";
  if (trimmed.startsWith("redis://") || trimmed.startsWith("rediss://")) {
    return trimmed;
  }
  const extracted = trimmed.match(/(rediss?:\/\/\S+)/);
  if (extracted?.[1]) {
    console.warn(
      "[waseller/queue] REDIS_URL contenía texto extra (p. ej. `redis-cli --tls -u`). " +
        "En Railway/Vercel guardá solo la URL. Usando: " +
        redactRedisUrlForLog(extracted[1])
    );
    return extracted[1];
  }
  return trimmed;
}

let warnedUpstashTlsMismatch = false;

/** Upstash solo expone Redis con TLS; `redis://` sin TLS suele cortar la conexión (ECONNRESET). */
function ensureTlsForUpstash(url: string): string {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith(".upstash.io")) return url;
    if (u.protocol === "redis:") {
      u.protocol = "rediss:";
      if (!warnedUpstashTlsMismatch) {
        warnedUpstashTlsMismatch = true;
        console.warn(
          "[waseller/queue] Host *.upstash.io con redis://: se usa rediss:// (TLS). " +
            "Definí REDIS_URL con rediss:// en Railway (Upstash) para evitar este aviso y conexiones inestables."
        );
      }
      return u.toString();
    }
  } catch {
    return url;
  }
  return url;
}

/**
 * `redis://redis:6379` es válido solo dentro de la red de Docker Compose.
 * En la máquina local el host `redis` no resuelve (ENOTFOUND); usamos 127.0.0.1 salvo que el proceso corra en contenedor.
 */
function resolveRedisUrl(): string {
  const fromEnv = process.env.REDIS_URL?.trim();
  const sanitized = fromEnv ? sanitizeRedisUrlInput(fromEnv) : "";
  const raw = sanitized || "redis://127.0.0.1:6379";
  if (
    !fromEnv &&
    (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL === "1")
  ) {
    // Sin esto, BullMQ intenta 127.0.0.1:6379 y los mensajes WhatsApp no se encolan ni los workers procesan.
    console.error(
      "[waseller/queue] REDIS_URL no está definida: se usa redis://127.0.0.1:6379 y fallará en Railway/Vercel. " +
        "Definí REDIS_URL (p. ej. Upstash: rediss://default:TOKEN@....upstash.io:6379) en el servicio workers y en el de WhatsApp."
    );
  }
  const inContainer =
    process.env.RUNNING_IN_DOCKER === "1" ||
    process.env.RUNNING_IN_DOCKER === "true" ||
    existsSync("/.dockerenv");
  const finalized = ensureTlsForUpstash(raw);
  if (inContainer) return finalized;
  try {
    const u = new URL(finalized);
    if (u.hostname === "redis") {
      u.hostname = "127.0.0.1";
      return ensureTlsForUpstash(u.toString());
    }
  } catch {
    /* ignore */
  }
  return finalized;
}

export const QueueNames = {
  incomingMessages: "incoming_messages",
  llmOrchestration: "llm_orchestration",
  leadProcessing: "lead_processing",
  suggestionGeneration: "suggestion_generation",
  styleProfileRecompute: "style_profile_recompute",
  conversationIndexing: "conversation_indexing",
  syntheticConversationGen: "synthetic_conversation_gen",
  outgoingMessages: "outgoing_messages",
  stockSync: "stock_sync",
  stockReservationExpiry: "stock_reservation_expiry",
  /** Expiración de carritos del storefront (TTL desde la creación de Order). */
  orderReservationExpiry: "order_reservation_expiry"
} as const;

const redisUrl = resolveRedisUrl();

patchIoredisDuplicateForTransientSocketErrors();

/** Upstash / cloud: READY check de ioredis puede fallar o churn; BullMQ exige maxRetriesPerRequest: null. */
const redisClientOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  /** Reduce cierres por inactividad en Redis gestionado (p. ej. Upstash). */
  keepAlive: 30000,
  ...(redisUrl.startsWith("rediss://") ? { tls: {} } : {})
};

export const redisConnection = new IORedis(redisUrl, redisClientOptions);

bindTransientRedisSocketErrors(redisConnection, "redis (IORedis)");

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  removeOnComplete: 1000,
  removeOnFail: 2000,
  backoff: {
    type: "exponential",
    delay: 1000
  }
};

export const incomingQueue = new Queue(QueueNames.incomingMessages, {
  connection: redisConnection,
  defaultJobOptions
});

export const leadProcessingQueue = new Queue(QueueNames.leadProcessing, {
  connection: redisConnection,
  defaultJobOptions
});

export const llmOrchestrationQueue = new Queue(QueueNames.llmOrchestration, {
  connection: redisConnection,
  defaultJobOptions
});

export const suggestionGenerationQueue = new Queue(QueueNames.suggestionGeneration, {
  connection: redisConnection,
  defaultJobOptions
});

export const styleProfileRecomputeQueue = new Queue(QueueNames.styleProfileRecompute, {
  connection: redisConnection,
  defaultJobOptions
});

export const conversationIndexingQueue = new Queue(QueueNames.conversationIndexing, {
  connection: redisConnection,
  defaultJobOptions
});

export const syntheticConversationGenQueue = new Queue(QueueNames.syntheticConversationGen, {
  connection: redisConnection,
  defaultJobOptions
});

export const outgoingQueue = new Queue(QueueNames.outgoingMessages, {
  connection: redisConnection,
  defaultJobOptions
});

export const stockSyncQueue = new Queue(QueueNames.stockSync, {
  connection: redisConnection,
  defaultJobOptions
});

export const stockReservationExpiryQueue = new Queue(QueueNames.stockReservationExpiry, {
  connection: redisConnection,
  defaultJobOptions
});

export const orderReservationExpiryQueue = new Queue(QueueNames.orderReservationExpiry, {
  connection: redisConnection,
  defaultJobOptions
});

const bullQueuesForErrorHandling: Queue[] = [
  incomingQueue,
  leadProcessingQueue,
  llmOrchestrationQueue,
  suggestionGenerationQueue,
  styleProfileRecomputeQueue,
  conversationIndexingQueue,
  syntheticConversationGenQueue,
  outgoingQueue,
  stockSyncQueue,
  stockReservationExpiryQueue,
  orderReservationExpiryQueue
];
for (const q of bullQueuesForErrorHandling) {
  bindTransientRedisSocketErrors(q, `BullMQ Queue:${q.name}`);
}
