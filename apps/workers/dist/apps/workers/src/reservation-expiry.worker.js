"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reservationExpiryWorker = void 0;
const bullmq_1 = require("bullmq");
const src_1 = require("../../../packages/queue/src");
const src_2 = require("../../../packages/db/src");
const stock_reservation_service_1 = require("./services/stock-reservation.service");
const stockReservation = new stock_reservation_service_1.StockReservationService();
exports.reservationExpiryWorker = new bullmq_1.Worker(src_1.QueueNames.stockReservationExpiry, async (job) => {
    const { tenantId, leadId, variantId } = job.data;
    const lead = await src_2.prisma.lead.findFirst({
        where: { id: leadId, tenantId },
        select: {
            id: true,
            phone: true,
            status: true,
            hasStockReservation: true,
            reservationExpiresAt: true
        }
    });
    if (!lead)
        return;
    if (!lead.hasStockReservation)
        return;
    if (lead.status === "vendido")
        return;
    if (lead.reservationExpiresAt && lead.reservationExpiresAt.getTime() > Date.now())
        return;
    const released = await stockReservation.releaseOne(tenantId, variantId, {
        reason: "reservation_ttl_expired",
        source: "reservation_expiry_worker",
        leadId,
        phone: lead.phone
    });
    if (!released)
        return;
    await src_2.prisma.lead.updateMany({
        where: { id: leadId, tenantId },
        data: {
            hasStockReservation: false,
            reservationExpiresAt: null
        }
    });
}, { connection: src_1.redisConnection, concurrency: Number(process.env.RESERVATION_EXPIRY_CONCURRENCY ?? 2) });
