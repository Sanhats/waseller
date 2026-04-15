import { Job, Worker } from "bullmq";
import { QueueNames, redisConnection } from "../../../packages/queue/src";
import { prisma } from "../../../packages/db/src";
import { StockReservationService } from "./services/stock-reservation.service";

interface ReservationExpiryPayload {
  tenantId: string;
  leadId: string;
  variantId: string;
}

const stockReservation = new StockReservationService();

export const reservationExpiryWorker = new Worker<ReservationExpiryPayload>(
  QueueNames.stockReservationExpiry,
  async (job: Job<ReservationExpiryPayload>) => {
    const { tenantId, leadId, variantId } = job.data;
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: {
        id: true,
        phone: true,
        status: true,
        hasStockReservation: true,
        reservationExpiresAt: true
      }
    });
    if (!lead) return;
    if (!lead.hasStockReservation) return;
    if (lead.status === "vendido") return;
    if (lead.reservationExpiresAt && lead.reservationExpiresAt.getTime() > Date.now()) return;

    const released = await stockReservation.releaseOne(tenantId, variantId, {
      reason: "reservation_ttl_expired",
      source: "reservation_expiry_worker",
      leadId,
      phone: lead.phone
    });
    if (!released) return;

    await prisma.lead.updateMany({
      where: { id: leadId, tenantId },
      data: {
        hasStockReservation: false,
        reservationExpiresAt: null
      }
    });
  },
  { connection: redisConnection, concurrency: Number(process.env.RESERVATION_EXPIRY_CONCURRENCY ?? 2) }
);
