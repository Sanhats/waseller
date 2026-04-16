"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockReservationExpiryQueue = exports.stockSyncQueue = exports.outgoingQueue = exports.llmOrchestrationQueue = exports.leadProcessingQueue = exports.incomingQueue = exports.redisConnection = exports.QueueNames = void 0;
const node_fs_1 = require("node:fs");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
function redactRedisUrlForLog(url) {
    try {
        const u = new URL(url);
        if (u.password)
            u.password = "****";
        return u.toString();
    }
    catch {
        return "[url inválida]";
    }
}
/**
 * Si pegaron `redis-cli --tls -u rediss://...`, ioredis interpreta el string entero como path de socket (ENOENT).
 * Solo debe usarse la URL `redis(s)://...`.
 */
function sanitizeRedisUrlInput(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return "";
    if (trimmed.startsWith("redis://") || trimmed.startsWith("rediss://")) {
        return trimmed;
    }
    const extracted = trimmed.match(/(rediss?:\/\/\S+)/);
    if (extracted?.[1]) {
        console.warn("[waseller/queue] REDIS_URL contenía texto extra (p. ej. `redis-cli --tls -u`). " +
            "En Railway/Vercel guardá solo la URL. Usando: " +
            redactRedisUrlForLog(extracted[1]));
        return extracted[1];
    }
    return trimmed;
}
/**
 * `redis://redis:6379` es válido solo dentro de la red de Docker Compose.
 * En la máquina local el host `redis` no resuelve (ENOTFOUND); usamos 127.0.0.1 salvo que el proceso corra en contenedor.
 */
function resolveRedisUrl() {
    const fromEnv = process.env.REDIS_URL?.trim();
    const sanitized = fromEnv ? sanitizeRedisUrlInput(fromEnv) : "";
    const raw = sanitized || "redis://127.0.0.1:6379";
    if (!fromEnv &&
        (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL === "1")) {
        // Sin esto, BullMQ intenta 127.0.0.1:6379 y los mensajes WhatsApp no se encolan ni los workers procesan.
        console.error("[waseller/queue] REDIS_URL no está definida: se usa redis://127.0.0.1:6379 y fallará en Railway/Vercel. " +
            "Definí REDIS_URL (p. ej. Upstash: rediss://default:TOKEN@....upstash.io:6379) en el servicio workers y en el de WhatsApp.");
    }
    const inContainer = process.env.RUNNING_IN_DOCKER === "1" ||
        process.env.RUNNING_IN_DOCKER === "true" ||
        (0, node_fs_1.existsSync)("/.dockerenv");
    if (inContainer)
        return raw;
    try {
        const u = new URL(raw);
        if (u.hostname === "redis") {
            u.hostname = "127.0.0.1";
            return u.toString();
        }
    }
    catch {
        /* ignore */
    }
    return raw;
}
exports.QueueNames = {
    incomingMessages: "incoming_messages",
    llmOrchestration: "llm_orchestration",
    leadProcessing: "lead_processing",
    outgoingMessages: "outgoing_messages",
    stockSync: "stock_sync",
    stockReservationExpiry: "stock_reservation_expiry"
};
const redisUrl = resolveRedisUrl();
exports.redisConnection = new ioredis_1.default(redisUrl, { maxRetriesPerRequest: null });
const defaultJobOptions = {
    attempts: 5,
    removeOnComplete: 1000,
    removeOnFail: 2000,
    backoff: {
        type: "exponential",
        delay: 1000
    }
};
exports.incomingQueue = new bullmq_1.Queue(exports.QueueNames.incomingMessages, {
    connection: exports.redisConnection,
    defaultJobOptions
});
exports.leadProcessingQueue = new bullmq_1.Queue(exports.QueueNames.leadProcessing, {
    connection: exports.redisConnection,
    defaultJobOptions
});
exports.llmOrchestrationQueue = new bullmq_1.Queue(exports.QueueNames.llmOrchestration, {
    connection: exports.redisConnection,
    defaultJobOptions
});
exports.outgoingQueue = new bullmq_1.Queue(exports.QueueNames.outgoingMessages, {
    connection: exports.redisConnection,
    defaultJobOptions
});
exports.stockSyncQueue = new bullmq_1.Queue(exports.QueueNames.stockSync, {
    connection: exports.redisConnection,
    defaultJobOptions
});
exports.stockReservationExpiryQueue = new bullmq_1.Queue(exports.QueueNames.stockReservationExpiry, {
    connection: exports.redisConnection,
    defaultJobOptions
});
