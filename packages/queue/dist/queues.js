"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockReservationExpiryQueue = exports.stockSyncQueue = exports.outgoingQueue = exports.llmOrchestrationQueue = exports.leadProcessingQueue = exports.incomingQueue = exports.redisConnection = exports.QueueNames = void 0;
const node_fs_1 = require("node:fs");
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
/**
 * `redis://redis:6379` es válido solo dentro de la red de Docker Compose.
 * En la máquina local el host `redis` no resuelve (ENOTFOUND); usamos 127.0.0.1 salvo que el proceso corra en contenedor.
 */
function resolveRedisUrl() {
    const raw = process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
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
