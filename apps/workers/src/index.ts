import { bindTransientRedisSocketErrors, stockSyncQueue } from "../../../packages/queue/src";
import { messageProcessorWorker } from "./message-processor.worker";
import { suggestionGeneratorWorker } from "./suggestion-generator.worker";
import { senderWorker } from "./sender.worker";
import { stockSyncWorker } from "./stock-sync.worker";
import { reservationExpiryWorker } from "./reservation-expiry.worker";
import { orderReservationExpiryWorker } from "./order-reservation-expiry.worker";

const bullWorkersForErrorHandling = [
  messageProcessorWorker,
  suggestionGeneratorWorker,
  senderWorker,
  stockSyncWorker,
  reservationExpiryWorker,
  orderReservationExpiryWorker
];
for (const w of bullWorkersForErrorHandling) {
  bindTransientRedisSocketErrors(w, `BullMQ Worker:${w.name}`);
}

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
  suggestionGenerator: !!suggestionGeneratorWorker,
  senderWorker: !!senderWorker,
  stockSyncWorker: !!stockSyncWorker,
  reservationExpiryWorker: !!reservationExpiryWorker,
  orderReservationExpiryWorker: !!orderReservationExpiryWorker
});
