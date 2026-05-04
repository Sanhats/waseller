"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var OrdersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrdersService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const library_1 = require("@prisma/client/runtime/library");
const db_1 = require("@waseller/db");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TTL_MINUTES = 15;
const MAX_ITEMS = 50;
const MAX_QTY_PER_LINE = 99;
function trimStr(v, fallback = "") {
    return typeof v === "string" ? v.trim() : String(v ?? fallback).trim();
}
function isPositiveInt(n) {
    return typeof n === "number" && Number.isInteger(n) && n > 0;
}
let OrdersService = OrdersService_1 = class OrdersService {
    logger = new common_1.Logger(OrdersService_1.name);
    /**
     * Crea una Order en estado `pending_payment`, congela snapshots de cada línea
     * y reserva stock atómicamente. Si la reserva falla en alguna línea, la
     * transacción rollea — no quedan reservas parciales.
     */
    async createPendingOrder(input) {
        if (!UUID_RE.test(input.tenantId)) {
            throw new common_1.BadRequestException("tenantId inválido.");
        }
        const buyerName = trimStr(input.buyer?.name);
        const buyerEmail = trimStr(input.buyer?.email);
        const buyerPhone = trimStr(input.buyer?.phone);
        if (!buyerName)
            throw new common_1.BadRequestException("Falta el nombre del comprador.");
        if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
            throw new common_1.BadRequestException("El email del comprador no es válido.");
        }
        if (!buyerPhone)
            throw new common_1.BadRequestException("Falta el teléfono del comprador.");
        if (!Array.isArray(input.items) || input.items.length === 0) {
            throw new common_1.BadRequestException("El carrito está vacío.");
        }
        if (input.items.length > MAX_ITEMS) {
            throw new common_1.BadRequestException(`Máximo ${MAX_ITEMS} líneas por orden.`);
        }
        /** Consolida líneas duplicadas (mismo variantId) sumando cantidades. */
        const consolidated = new Map();
        for (const it of input.items) {
            const variantId = trimStr(it?.variantId);
            const qty = Number(it?.quantity);
            if (!UUID_RE.test(variantId)) {
                throw new common_1.BadRequestException(`variantId inválido: ${variantId}`);
            }
            if (!isPositiveInt(qty) || qty > MAX_QTY_PER_LINE) {
                throw new common_1.BadRequestException(`Cantidad inválida para ${variantId}: debe ser entero entre 1 y ${MAX_QTY_PER_LINE}.`);
            }
            consolidated.set(variantId, (consolidated.get(variantId) ?? 0) + qty);
        }
        const lines = Array.from(consolidated.entries()).map(([variantId, quantity]) => ({
            variantId,
            quantity,
        }));
        const ttlMinutes = Number.isFinite(input.ttlMinutes) && (input.ttlMinutes ?? 0) > 0
            ? Math.floor(input.ttlMinutes)
            : DEFAULT_TTL_MINUTES;
        const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
        const externalReference = `ws-order-${(0, node_crypto_1.randomUUID)()}`;
        const tenantId = input.tenantId;
        const result = await db_1.prisma.$transaction(async (tx) => {
            /** Lookup + lock optimista: leemos cada variante una sola vez con sus precios y stock disponible. */
            const variantIds = lines.map((l) => l.variantId);
            const rows = (await tx.$queryRawUnsafe(`select
          v.id::text as "variantId",
          v.product_id::text as "productId",
          v.sku as "sku",
          v.attributes as "attributes",
          v.is_active as "isActive",
          v.stock as "stock",
          v.reserved_stock as "reservedStock",
          coalesce(v.price, p.price) as "effectivePrice",
          p.name as "productName"
        from public.product_variants v
        inner join public.products p on p.id = v.product_id
        where v.tenant_id::text = $1
          and v.id = any($2::uuid[])`, tenantId, variantIds));
            const byId = new Map(rows.map((r) => [r.variantId, r]));
            for (const line of lines) {
                const v = byId.get(line.variantId);
                if (!v) {
                    throw new common_1.BadRequestException(`La variante ${line.variantId} no existe o no pertenece a esta tienda.`);
                }
                if (!v.isActive) {
                    throw new common_1.BadRequestException(`La variante ${v.sku} ya no está disponible.`);
                }
                const available = Number(v.stock) - Number(v.reservedStock);
                if (available < line.quantity) {
                    throw new common_1.BadRequestException(`Stock insuficiente para ${v.sku}: disponible ${available}, pedido ${line.quantity}.`);
                }
            }
            const totalAmount = lines.reduce((acc, line) => {
                const v = byId.get(line.variantId);
                const price = Number(v.effectivePrice ?? 0);
                return acc + price * line.quantity;
            }, 0);
            /** 1. Crear la Order. */
            const created = await tx.order.create({
                data: {
                    tenantId,
                    status: "pending_payment",
                    totalAmount: new library_1.Decimal(totalAmount),
                    currency: "ARS",
                    buyerName,
                    buyerEmail,
                    buyerPhone,
                    buyerNotes: trimStr(input.buyer?.notes) || null,
                    externalReference,
                    expiresAt,
                    metadata: (input.metadata ?? {}),
                },
                select: {
                    id: true,
                    tenantId: true,
                    status: true,
                    totalAmount: true,
                    currency: true,
                    buyerName: true,
                    buyerEmail: true,
                    buyerPhone: true,
                    buyerNotes: true,
                    externalReference: true,
                    expiresAt: true,
                    paidAt: true,
                    fulfilledAt: true,
                    metadata: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
            /** 2. Crear los OrderItems con snapshots y reservar stock línea por línea. */
            const items = [];
            for (const line of lines) {
                const v = byId.get(line.variantId);
                const unitPrice = Number(v.effectivePrice ?? 0);
                const lineTotal = unitPrice * line.quantity;
                const item = await tx.orderItem.create({
                    data: {
                        orderId: created.id,
                        productVariantId: v.variantId,
                        productName: v.productName,
                        variantSku: v.sku,
                        variantAttributes: (v.attributes ?? {}),
                        quantity: line.quantity,
                        unitPrice: new library_1.Decimal(unitPrice),
                        lineTotal: new library_1.Decimal(lineTotal),
                    },
                    select: {
                        id: true,
                        productVariantId: true,
                        productName: true,
                        variantSku: true,
                        variantAttributes: true,
                        quantity: true,
                        unitPrice: true,
                        lineTotal: true,
                    },
                });
                /** 3. Reserva atómica: condition optimista sobre reserved_stock + stock visto. */
                const updated = await tx.$executeRaw `
          update public.product_variants
          set reserved_stock = reserved_stock + ${line.quantity}, updated_at = now()
          where id::text = ${v.variantId}
            and tenant_id::text = ${tenantId}
            and (stock - reserved_stock) >= ${line.quantity}
        `;
                if (Number(updated) <= 0) {
                    throw new common_1.BadRequestException(`No se pudo reservar stock para ${v.sku}. Probá de nuevo en un momento.`);
                }
                await tx.stockMovement.create({
                    data: {
                        tenantId,
                        productId: v.productId,
                        variantId: v.variantId,
                        movementType: "reserve",
                        deltaStock: 0,
                        deltaReserved: line.quantity,
                        reason: "order_checkout_started",
                        source: "orders.createPendingOrder",
                        orderId: created.id,
                        phone: buyerPhone,
                    },
                });
                items.push({
                    id: String(item.id),
                    productVariantId: String(item.productVariantId),
                    productName: String(item.productName),
                    variantSku: String(item.variantSku),
                    variantAttributes: (item.variantAttributes ?? null),
                    quantity: Number(item.quantity),
                    unitPrice: Number(item.unitPrice),
                    lineTotal: Number(item.lineTotal),
                });
            }
            return { created, items };
        });
        const order = this.serializeOrder(result.created);
        return { order, items: result.items };
    }
    async getOrderById(tenantId, orderId) {
        if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId))
            return null;
        const row = await db_1.prisma.order.findFirst({
            where: { id: orderId, tenantId },
            select: {
                id: true,
                tenantId: true,
                status: true,
                totalAmount: true,
                currency: true,
                buyerName: true,
                buyerEmail: true,
                buyerPhone: true,
                buyerNotes: true,
                externalReference: true,
                expiresAt: true,
                paidAt: true,
                fulfilledAt: true,
                metadata: true,
                createdAt: true,
                updatedAt: true,
                items: {
                    orderBy: { createdAt: "asc" },
                    select: {
                        id: true,
                        productVariantId: true,
                        productName: true,
                        variantSku: true,
                        variantAttributes: true,
                        quantity: true,
                        unitPrice: true,
                        lineTotal: true,
                    },
                },
            },
        });
        if (!row)
            return null;
        return {
            order: this.serializeOrder(row),
            items: row.items.map((it) => ({
                id: String(it.id),
                productVariantId: String(it.productVariantId),
                productName: String(it.productName),
                variantSku: String(it.variantSku),
                variantAttributes: (it.variantAttributes ?? null),
                quantity: Number(it.quantity),
                unitPrice: Number(it.unitPrice),
                lineTotal: Number(it.lineTotal),
            })),
        };
    }
    /**
     * Marca la Order como `paid` y commitea el stock reservado de cada línea.
     * Idempotente: si la Order ya está paid/fulfilled/refunded, no hace nada.
     */
    async markOrderPaid(tenantId, orderId) {
        if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId))
            return false;
        return db_1.prisma.$transaction(async (tx) => {
            const order = await tx.order.findFirst({
                where: { id: orderId, tenantId },
                select: { id: true, status: true },
            });
            if (!order) {
                this.logger.warn(`markOrderPaid: order ${orderId} no encontrada para tenant ${tenantId}`);
                return false;
            }
            if (order.status !== "pending_payment") {
                return order.status === "paid" || order.status === "fulfilled";
            }
            const items = (await tx.$queryRaw `
        select
          oi.product_variant_id::text as "variantId",
          oi.quantity,
          v.product_id::text as "productId",
          v.sku as "sku"
        from public.order_items oi
        inner join public.product_variants v on v.id = oi.product_variant_id
        where oi.order_id::text = ${orderId}
      `);
            for (const line of items) {
                const updated = await tx.$executeRaw `
          update public.product_variants
          set
            stock = stock - ${line.quantity},
            reserved_stock = reserved_stock - ${line.quantity},
            updated_at = now()
          where id::text = ${line.variantId}
            and tenant_id::text = ${tenantId}
            and stock >= ${line.quantity}
            and reserved_stock >= ${line.quantity}
        `;
                if (Number(updated) <= 0) {
                    /** Si esto falla, alguien manipuló el stock fuera de la reserva. Logueamos pero igual marcamos paid. */
                    this.logger.error(`markOrderPaid: no se pudo commitear stock para ${line.sku} (order ${orderId}). Reserva inconsistente.`);
                }
                else {
                    await tx.stockMovement.create({
                        data: {
                            tenantId,
                            productId: line.productId,
                            variantId: line.variantId,
                            movementType: "commit",
                            deltaStock: -line.quantity,
                            deltaReserved: -line.quantity,
                            reason: "order_paid",
                            source: "orders.markOrderPaid",
                            orderId,
                        },
                    });
                }
            }
            await tx.order.update({
                where: { id: orderId },
                data: { status: "paid", paidAt: new Date(), expiresAt: null },
            });
            return true;
        });
    }
    /**
     * Libera el stock reservado y marca la Order con un status terminal no exitoso.
     * Idempotente: si la Order ya no está en pending_payment, no toca el stock.
     */
    async markOrderUnpaid(tenantId, orderId, finalStatus) {
        if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId))
            return false;
        return db_1.prisma.$transaction(async (tx) => {
            const order = await tx.order.findFirst({
                where: { id: orderId, tenantId },
                select: { id: true, status: true },
            });
            if (!order) {
                this.logger.warn(`markOrderUnpaid: order ${orderId} no encontrada para tenant ${tenantId}`);
                return false;
            }
            if (order.status !== "pending_payment") {
                /** Idempotente: si ya está paid o terminal, no se libera stock. */
                return false;
            }
            const items = (await tx.$queryRaw `
        select
          oi.product_variant_id::text as "variantId",
          oi.quantity,
          v.product_id::text as "productId",
          v.sku as "sku"
        from public.order_items oi
        inner join public.product_variants v on v.id = oi.product_variant_id
        where oi.order_id::text = ${orderId}
      `);
            for (const line of items) {
                const updated = await tx.$executeRaw `
          update public.product_variants
          set
            reserved_stock = greatest(reserved_stock - ${line.quantity}, 0),
            updated_at = now()
          where id::text = ${line.variantId}
            and tenant_id::text = ${tenantId}
        `;
                if (Number(updated) > 0) {
                    await tx.stockMovement.create({
                        data: {
                            tenantId,
                            productId: line.productId,
                            variantId: line.variantId,
                            movementType: "release",
                            deltaStock: 0,
                            deltaReserved: -line.quantity,
                            reason: `order_${finalStatus}`,
                            source: "orders.markOrderUnpaid",
                            orderId,
                        },
                    });
                }
            }
            await tx.order.update({
                where: { id: orderId },
                data: { status: finalStatus, expiresAt: null },
            });
            return true;
        });
    }
    /**
     * Lista paginada de Orders del tenant para el dashboard. Filtros por status y búsqueda
     * libre sobre nombre/email/teléfono/externalReference y prefijo del id (8 chars).
     */
    async listOrdersByTenant(tenantId, opts) {
        if (!UUID_RE.test(tenantId))
            return { rows: [], total: 0 };
        const limit = Math.min(Math.max(1, Math.floor(opts?.limit ?? 50)), 200);
        const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
        const params = [tenantId];
        let next = 2;
        let where = "where o.tenant_id::text = $1";
        if (opts?.status && opts.status !== "all") {
            where += ` and o.status = $${next}::order_status`;
            params.push(opts.status);
            next += 1;
        }
        const search = (opts?.search ?? "").trim();
        if (search) {
            where += ` and (
        o.buyer_name ilike $${next}
        or o.buyer_email ilike $${next}
        or o.buyer_phone ilike $${next}
        or o.external_reference ilike $${next}
        or o.id::text ilike $${next}
      )`;
            params.push(`%${search}%`);
            next += 1;
        }
        const totalRows = (await db_1.prisma.$queryRawUnsafe(`select count(*)::int as total from public.orders o ${where}`, ...params));
        const total = Number(totalRows[0]?.total ?? 0);
        const listParams = [...params, limit, offset];
        const limitIdx = next;
        const offsetIdx = next + 1;
        const rows = (await db_1.prisma.$queryRawUnsafe(`select
        o.id::text as "id",
        o.tenant_id::text as "tenantId",
        o.status::text as "status",
        o.total_amount as "totalAmount",
        o.currency as "currency",
        o.buyer_name as "buyerName",
        o.buyer_email as "buyerEmail",
        o.buyer_phone as "buyerPhone",
        o.buyer_notes as "buyerNotes",
        o.external_reference as "externalReference",
        o.expires_at as "expiresAt",
        o.paid_at as "paidAt",
        o.fulfilled_at as "fulfilledAt",
        o.metadata as "metadata",
        o.created_at as "createdAt",
        o.updated_at as "updatedAt",
        coalesce((
          select sum(quantity)::int
          from public.order_items oi
          where oi.order_id = o.id
        ), 0) as "itemCount"
      from public.orders o
      ${where}
      order by o.created_at desc
      limit $${limitIdx} offset $${offsetIdx}`, ...listParams));
        return {
            rows: rows.map((row) => ({
                ...this.serializeOrder(row),
                itemCount: Number(row.itemCount ?? 0),
            })),
            total,
        };
    }
    /**
     * Detalle extendido para el drawer del dashboard: incluye ítems + payment_attempts.
     */
    async getOrderDetail(tenantId, orderId) {
        const base = await this.getOrderById(tenantId, orderId);
        if (!base)
            return null;
        const attempts = await db_1.prisma.paymentAttempt.findMany({
            where: { tenantId, orderId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                status: true,
                provider: true,
                amount: true,
                currency: true,
                checkoutUrl: true,
                externalPaymentId: true,
                createdAt: true,
                paidAt: true,
                lastWebhookAt: true,
            },
        });
        return {
            ...base,
            paymentAttempts: attempts.map((a) => ({
                id: String(a.id),
                status: String(a.status),
                provider: String(a.provider),
                amount: Number(a.amount),
                currency: String(a.currency),
                checkoutUrl: a.checkoutUrl ? String(a.checkoutUrl) : null,
                externalPaymentId: a.externalPaymentId ? String(a.externalPaymentId) : null,
                createdAt: new Date(a.createdAt).toISOString(),
                paidAt: a.paidAt ? new Date(a.paidAt).toISOString() : null,
                lastWebhookAt: a.lastWebhookAt ? new Date(a.lastWebhookAt).toISOString() : null,
            })),
        };
    }
    /**
     * Marca como `fulfilled` una Order ya pagada. No toca stock — el commit
     * ya se hizo en `markOrderPaid`. Idempotente: si ya está fulfilled, no hace nada.
     */
    async markOrderFulfilled(tenantId, orderId) {
        if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId))
            return false;
        const order = await db_1.prisma.order.findFirst({
            where: { id: orderId, tenantId },
            select: { id: true, status: true },
        });
        if (!order) {
            throw new common_1.NotFoundException("Order no encontrada.");
        }
        if (order.status === "fulfilled")
            return true;
        if (order.status !== "paid") {
            throw new common_1.BadRequestException(`Solo se puede marcar como despachada una Order ya pagada (estado actual: ${order.status}).`);
        }
        await db_1.prisma.order.update({
            where: { id: orderId },
            data: { status: "fulfilled", fulfilledAt: new Date() },
        });
        return true;
    }
    serializeOrder(row) {
        return {
            id: String(row.id),
            tenantId: String(row.tenantId),
            status: row.status,
            totalAmount: Number(row.totalAmount),
            currency: String(row.currency),
            buyerName: String(row.buyerName),
            buyerEmail: String(row.buyerEmail),
            buyerPhone: String(row.buyerPhone),
            buyerNotes: row.buyerNotes ? String(row.buyerNotes) : null,
            externalReference: String(row.externalReference),
            expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
            paidAt: row.paidAt ? new Date(row.paidAt).toISOString() : null,
            fulfilledAt: row.fulfilledAt ? new Date(row.fulfilledAt).toISOString() : null,
            metadata: (row.metadata ?? null),
            createdAt: new Date(row.createdAt).toISOString(),
            updatedAt: new Date(row.updatedAt).toISOString(),
        };
    }
};
exports.OrdersService = OrdersService;
exports.OrdersService = OrdersService = OrdersService_1 = __decorate([
    (0, common_1.Injectable)()
], OrdersService);
