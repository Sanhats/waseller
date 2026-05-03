import { Queue } from "bullmq";
import IORedis from "ioredis";
export type RedisErrorEmitter = {
    on(event: "error", listener: (err: unknown) => void): unknown;
};
/**
 * BullMQ reenvía errores de Redis al `Queue`/`Worker`. Sin ningún listener, Node trata `error` como no manejado y spamea stderr.
 * Los resets TCP a Upstash/Railway suelen ser transitorios.
 */
export declare function bindTransientRedisSocketErrors(emitter: RedisErrorEmitter, label: string): void;
export declare const QueueNames: {
    readonly incomingMessages: "incoming_messages";
    readonly llmOrchestration: "llm_orchestration";
    readonly leadProcessing: "lead_processing";
    readonly suggestionGeneration: "suggestion_generation";
    readonly outgoingMessages: "outgoing_messages";
    readonly stockSync: "stock_sync";
    readonly stockReservationExpiry: "stock_reservation_expiry";
    /** Expiración de carritos del storefront (TTL desde la creación de Order). */
    readonly orderReservationExpiry: "order_reservation_expiry";
};
export declare const redisConnection: IORedis;
export declare const incomingQueue: Queue<any, any, string, any, any, string>;
export declare const leadProcessingQueue: Queue<any, any, string, any, any, string>;
export declare const llmOrchestrationQueue: Queue<any, any, string, any, any, string>;
export declare const suggestionGenerationQueue: Queue<any, any, string, any, any, string>;
export declare const outgoingQueue: Queue<any, any, string, any, any, string>;
export declare const stockSyncQueue: Queue<any, any, string, any, any, string>;
export declare const stockReservationExpiryQueue: Queue<any, any, string, any, any, string>;
export declare const orderReservationExpiryQueue: Queue<any, any, string, any, any, string>;
