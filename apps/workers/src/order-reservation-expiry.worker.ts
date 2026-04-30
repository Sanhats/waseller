import { Job, Worker } from "bullmq";
import { QueueNames, redisConnection } from "../../../packages/queue/src";
import { OrdersService } from "../../backend/src/modules/orders/orders.service";

interface OrderReservationExpiryPayload {
  tenantId: string;
  orderId: string;
}

const ordersService = new OrdersService();

/**
 * Cuando vence el TTL del carrito (15 min por defecto), liberamos el stock reservado
 * y marcamos la Order como `expired`. `markOrderUnpaid` es idempotente: si MP ya confirmó
 * pago entre que se encoló y se ejecutó este job, la Order ya está en `paid` y no toca stock.
 */
export const orderReservationExpiryWorker = new Worker<OrderReservationExpiryPayload>(
  QueueNames.orderReservationExpiry,
  async (job: Job<OrderReservationExpiryPayload>) => {
    const { tenantId, orderId } = job.data;
    if (!tenantId || !orderId) return;
    await ordersService.markOrderUnpaid(tenantId, orderId, "expired");
  },
  {
    connection: redisConnection,
    concurrency: Number(process.env.ORDER_RESERVATION_EXPIRY_CONCURRENCY ?? 4)
  }
);
