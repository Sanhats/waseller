"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockSyncQueue = exports.outgoingQueue = exports.leadProcessingQueue = exports.incomingQueue = exports.redisConnection = exports.QueueNames = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
exports.QueueNames = {
    incomingMessages: "incoming_messages",
    leadProcessing: "lead_processing",
    outgoingMessages: "outgoing_messages",
    stockSync: "stock_sync"
};
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
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
exports.outgoingQueue = new bullmq_1.Queue(exports.QueueNames.outgoingMessages, {
    connection: exports.redisConnection,
    defaultJobOptions
});
exports.stockSyncQueue = new bullmq_1.Queue(exports.QueueNames.stockSync, {
    connection: exports.redisConnection,
    defaultJobOptions
});
