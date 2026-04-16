"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const src_1 = require("../../../packages/queue/src");
const message_processor_worker_1 = require("./message-processor.worker");
const conversation_orchestrator_worker_1 = require("./conversation-orchestrator.worker");
const lead_worker_1 = require("./lead.worker");
const sender_worker_1 = require("./sender.worker");
const stock_sync_worker_1 = require("./stock-sync.worker");
const reservation_expiry_worker_1 = require("./reservation-expiry.worker");
const bullWorkersForErrorHandling = [
    message_processor_worker_1.messageProcessorWorker,
    conversation_orchestrator_worker_1.conversationOrchestratorWorker,
    lead_worker_1.leadWorker,
    sender_worker_1.senderWorker,
    stock_sync_worker_1.stockSyncWorker,
    reservation_expiry_worker_1.reservationExpiryWorker
];
for (const w of bullWorkersForErrorHandling) {
    (0, src_1.bindTransientRedisSocketErrors)(w, `BullMQ Worker:${w.name}`);
}
const stockSyncIntervalMs = Number(process.env.STOCK_SYNC_INTERVAL_MS ?? 300000);
const bootstrapStockCron = () => {
    setInterval(async () => {
        const tenantId = process.env.DEFAULT_TENANT_ID;
        if (!tenantId)
            return;
        await src_1.stockSyncQueue.add("scheduled-sync", {
            tenantId,
            source: "api",
            products: []
        });
    }, stockSyncIntervalMs);
};
bootstrapStockCron();
console.log("Workers running", {
    messageProcessor: !!message_processor_worker_1.messageProcessorWorker,
    conversationOrchestrator: !!conversation_orchestrator_worker_1.conversationOrchestratorWorker,
    leadWorker: !!lead_worker_1.leadWorker,
    senderWorker: !!sender_worker_1.senderWorker,
    stockSyncWorker: !!stock_sync_worker_1.stockSyncWorker,
    reservationExpiryWorker: !!reservation_expiry_worker_1.reservationExpiryWorker
});
