"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockReservationExpiryQueue = exports.stockSyncQueue = exports.outgoingQueue = exports.llmOrchestrationQueue = exports.leadProcessingQueue = exports.incomingQueue = exports.redisConnection = exports.QueueNames = void 0;
exports.bindTransientRedisSocketErrors = bindTransientRedisSocketErrors;
const node_fs_1 = require("node:fs");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
/** Cierres de TCP por idle, redeploy o balanceador; ioredis/BullMQ reconectan. */
function isTransientRedisSocketError(err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    return code === "ECONNRESET" || code === "EPIPE" || code === "ETIMEDOUT";
}
/**
 * BullMQ reenvía errores de Redis al `Queue`/`Worker`. Sin ningún listener, Node trata `error` como no manejado y spamea stderr.
 * Los resets TCP a Upstash/Railway suelen ser transitorios.
 */
function bindTransientRedisSocketErrors(emitter, label) {
    emitter.on("error", (err) => {
        if (isTransientRedisSocketError(err))
            return;
        console.error(`[waseller/queue] ${label}`, err);
    });
}
/** BullMQ y otros llaman `duplicate()` en la clase; parchear solo `redisConnection` no basta si el método viene del prototipo. */
let ioredisDuplicatePatched = false;
function patchIoredisDuplicateForTransientSocketErrors() {
    if (ioredisDuplicatePatched)
        return;
    ioredisDuplicatePatched = true;
    const proto = ioredis_1.default.prototype;
    const originalDuplicate = proto.duplicate;
    proto.duplicate = function duplicateWithTransientErrorHandler(override) {
        const dup = originalDuplicate.call(this, override);
        bindTransientRedisSocketErrors(dup, "redis (ioredis duplicate)");
        return dup;
    };
}
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
    let trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        trimmed = trimmed.slice(1, -1).trim();
    }
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
/** Upstash solo expone Redis con TLS; `redis://` sin TLS suele cortar la conexión (ECONNRESET). */
function ensureTlsForUpstash(url) {
    try {
        const u = new URL(url);
        if (!u.hostname.endsWith(".upstash.io"))
            return url;
        if (u.protocol === "redis:") {
            u.protocol = "rediss:";
            console.warn("[waseller/queue] Host *.upstash.io con redis://: se usa rediss:// (TLS). Revisá REDIS_URL en el panel de Upstash.");
            return u.toString();
        }
    }
    catch {
        return url;
    }
    return url;
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
    const finalized = ensureTlsForUpstash(raw);
    if (inContainer)
        return finalized;
    try {
        const u = new URL(finalized);
        if (u.hostname === "redis") {
            u.hostname = "127.0.0.1";
            return ensureTlsForUpstash(u.toString());
        }
    }
    catch {
        /* ignore */
    }
    return finalized;
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
patchIoredisDuplicateForTransientSocketErrors();
/** Upstash / cloud: READY check de ioredis puede fallar o churn; BullMQ exige maxRetriesPerRequest: null. */
const redisClientOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    /** Reduce cierres por inactividad en Redis gestionado (p. ej. Upstash). */
    keepAlive: 30000,
    ...(redisUrl.startsWith("rediss://") ? { tls: {} } : {})
};
exports.redisConnection = new ioredis_1.default(redisUrl, redisClientOptions);
bindTransientRedisSocketErrors(exports.redisConnection, "redis (IORedis)");
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
const bullQueuesForErrorHandling = [
    exports.incomingQueue,
    exports.leadProcessingQueue,
    exports.llmOrchestrationQueue,
    exports.outgoingQueue,
    exports.stockSyncQueue,
    exports.stockReservationExpiryQueue
];
for (const q of bullQueuesForErrorHandling) {
    bindTransientRedisSocketErrors(q, `BullMQ Queue:${q.name}`);
}
