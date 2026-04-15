import { existsSync } from "node:fs";
import { JobsOptions, Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * `redis://redis:6379` es válido solo dentro de la red de Docker Compose.
 * En la máquina local el host `redis` no resuelve (ENOTFOUND); usamos 127.0.0.1 salvo que el proceso corra en contenedor.
 */
function resolveRedisUrl(): string {
  const raw = process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
  const inContainer =
    process.env.RUNNING_IN_DOCKER === "1" ||
    process.env.RUNNING_IN_DOCKER === "true" ||
    existsSync("/.dockerenv");
  if (inContainer) return raw;
  try {
    const u = new URL(raw);
    if (u.hostname === "redis") {
      u.hostname = "127.0.0.1";
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return raw;
}

export const QueueNames = {
  incomingMessages: "incoming_messages",
  llmOrchestration: "llm_orchestration",
  leadProcessing: "lead_processing",
  outgoingMessages: "outgoing_messages",
  stockSync: "stock_sync",
  stockReservationExpiry: "stock_reservation_expiry"
} as const;

const redisUrl = resolveRedisUrl();
export const redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

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
