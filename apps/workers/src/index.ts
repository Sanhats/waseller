import { stockSyncQueue } from "../../../packages/queue/src";
import { messageProcessorWorker } from "./message-processor.worker";
import { conversationOrchestratorWorker } from "./conversation-orchestrator.worker";
import { leadWorker } from "./lead.worker";
import { senderWorker } from "./sender.worker";
import { stockSyncWorker } from "./stock-sync.worker";
import { reservationExpiryWorker } from "./reservation-expiry.worker";

const stockSyncIntervalMs = Number(process.env.STOCK_SYNC_INTERVAL_MS ?? 300000);

const bootstrapStockCron = (): void => {
  setInterval(async () => {
    const tenantId = process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return;

    await stockSyncQueue.add("scheduled-sync", {
      tenantId,
      source: "api",
      products: []
    });
  }, stockSyncIntervalMs);
};

bootstrapStockCron();

console.log("Workers running", {
  messageProcessor: !!messageProcessorWorker,
  conversationOrchestrator: !!conversationOrchestratorWorker,
  leadWorker: !!leadWorker,
  senderWorker: !!senderWorker,
  stockSyncWorker: !!stockSyncWorker,
  reservationExpiryWorker: !!reservationExpiryWorker
});
