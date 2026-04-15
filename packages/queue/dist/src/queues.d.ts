import { Queue } from "bullmq";
import IORedis from "ioredis";
export declare const QueueNames: {
    readonly incomingMessages: "incoming_messages";
    readonly leadProcessing: "lead_processing";
    readonly outgoingMessages: "outgoing_messages";
    readonly stockSync: "stock_sync";
};
export declare const redisConnection: IORedis;
export declare const incomingQueue: Queue<any, any, string, any, any, string>;
export declare const leadProcessingQueue: Queue<any, any, string, any, any, string>;
export declare const outgoingQueue: Queue<any, any, string, any, any, string>;
export declare const stockSyncQueue: Queue<any, any, string, any, any, string>;
