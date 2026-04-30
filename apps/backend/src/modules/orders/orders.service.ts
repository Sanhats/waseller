import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@waseller/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderBuyer = {
  name: string;
  email: string;
  phone: string;
  notes?: string;
};

export type OrderInputItem = {
  variantId: string;
  quantity: number;
};

export type OrderItemSnapshot = {
  id: string;
  productVariantId: string;
  productName: string;
  variantSku: string;
  variantAttributes: Record<string, unknown> | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type OrderRecord = {
  id: string;
  tenantId: string;
  status:
    | "pending_payment"
    | "paid"
    | "failed"
    | "cancelled"
    | "expired"
    | "fulfilled"
    | "refunded";
  totalAmount: number;
  currency: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerNotes: string | null;
  externalReference: string;
  expiresAt: string | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderWithItems = {
  order: OrderRecord;
  items: OrderItemSnapshot[];
};

const DEFAULT_TTL_MINUTES = 15;
const MAX_ITEMS = 50;
const MAX_QTY_PER_LINE = 99;

function trimStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : String(v ?? fallback).trim();
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  /**
   * Crea una Order en estado `pending_payment`, congela snapshots de cada línea
   * y reserva stock atómicamente. Si la reserva falla en alguna línea, la
   * transacción rollea — no quedan reservas parciales.
   */
  async createPendingOrder(input: {
    tenantId: string;
    items: OrderInputItem[];
    buyer: OrderBuyer;
    ttlMinutes?: number;
    metadata?: Record<string, unknown>;
  }): Promise<OrderWithItems> {
    if (!UUID_RE.test(input.tenantId)) {
      throw new BadRequestException("tenantId inválido.");
    }
    const buyerName = trimStr(input.buyer?.name);
    const buyerEmail = trimStr(input.buyer?.email);
    const buyerPhone = trimStr(input.buyer?.phone);
    if (!buyerName) throw new BadRequestException("Falta el nombre del comprador.");
    if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      throw new BadRequestException("El email del comprador no es válido.");
    }
    if (!buyerPhone) throw new BadRequestException("Falta el teléfono del comprador.");
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new BadRequestException("El carrito está vacío.");
    }
    if (input.items.length > MAX_ITEMS) {
      throw new BadRequestException(`Máximo ${MAX_ITEMS} líneas por orden.`);
    }

    /** Consolida líneas duplicadas (mismo variantId) sumando cantidades. */
    const consolidated = new Map<string, number>();
    for (const it of input.items) {
      const variantId = trimStr(it?.variantId);
      const qty = Number(it?.quantity);
      if (!UUID_RE.test(variantId)) {
        throw new BadRequestException(`variantId inválido: ${variantId}`);
      }
      if (!isPositiveInt(qty) || qty > MAX_QTY_PER_LINE) {
        throw new BadRequestException(
          `Cantidad inválida para ${variantId}: debe ser entero entre 1 y ${MAX_QTY_PER_LINE}.`
        );
      }
      consolidated.set(variantId, (consolidated.get(variantId) ?? 0) + qty);
    }
    const lines = Array.from(consolidated.entries()).map(([variantId, quantity]) => ({
      variantId,
      quantity,
    }));

    const ttlMinutes = Number.isFinite(input.ttlMinutes) && (input.ttlMinutes ?? 0) > 0
      ? Math.floor(input.ttlMinutes!)
      : DEFAULT_TTL_MINUTES;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const externalReference = `ws-order-${randomUUID()}`;
    const tenantId = input.tenantId;

    const result = await prisma.$transaction(async (tx: any) => {
      /** Lookup + lock optimista: leemos cada variante una sola vez con sus precios y stock disponible. */
      const variantIds = lines.map((l) => l.variantId);
      const rows = (await tx.$queryRawUnsafe(
        `select
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
          and v.id = any($2::uuid[])`,
        tenantId,
        variantIds
      )) as Array<{
        variantId: string;
        productId: string;
        sku: string;
        attributes: Record<string, unknown> | null;
        isActive: boolean;
        stock: number;
        reservedStock: number;
        effectivePrice: unknown;
        productName: string;
      }>;
      const byId = new Map(rows.map((r) => [r.variantId, r]));
      for (const line of lines) {
        const v = byId.get(line.variantId);
        if (!v) {
          throw new BadRequestException(
            `La variante ${line.variantId} no existe o no pertenece a esta tienda.`
          );
        }
        if (!v.isActive) {
          throw new BadRequestException(`La variante ${v.sku} ya no está disponible.`);
        }
        const available = Number(v.stock) - Number(v.reservedStock);
        if (available < line.quantity) {
          throw new BadRequestException(
            `Stock insuficiente para ${v.sku}: disponible ${available}, pedido ${line.quantity}.`
          );
        }
      }

      const totalAmount = lines.reduce((acc, line) => {
        const v = byId.get(line.variantId)!;
        const price = Number(v.effectivePrice ?? 0);
        return acc + price * line.quantity;
      }, 0);

      /** 1. Crear la Order. */
      const created = await tx.order.create({
        data: {
          tenantId,
          status: "pending_payment",
          totalAmount: new Decimal(totalAmount),
          currency: "ARS",
          buyerName,
          buyerEmail,
          buyerPhone,
          buyerNotes: trimStr(input.buyer?.notes) || null,
          externalReference,
          expiresAt,
          metadata: (input.metadata ?? {}) as object,
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
      const items: OrderItemSnapshot[] = [];
      for (const line of lines) {
        const v = byId.get(line.variantId)!;
        const unitPrice = Number(v.effectivePrice ?? 0);
        const lineTotal = unitPrice * line.quantity;
        const item = await tx.orderItem.create({
          data: {
            orderId: created.id,
            productVariantId: v.variantId,
            productName: v.productName,
            variantSku: v.sku,
            variantAttributes: (v.attributes ?? {}) as object,
            quantity: line.quantity,
            unitPrice: new Decimal(unitPrice),
            lineTotal: new Decimal(lineTotal),
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
        const updated = await tx.$executeRaw`
          update public.product_variants
          set reserved_stock = reserved_stock + ${line.quantity}, updated_at = now()
          where id::text = ${v.variantId}
            and tenant_id::text = ${tenantId}
            and (stock - reserved_stock) >= ${line.quantity}
        `;
        if (Number(updated) <= 0) {
          throw new BadRequestException(
            `No se pudo reservar stock para ${v.sku}. Probá de nuevo en un momento.`
          );
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
          variantAttributes: (item.variantAttributes ?? null) as Record<string, unknown> | null,
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

  async getOrderById(
    tenantId: string,
    orderId: string
  ): Promise<OrderWithItems | null> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId)) return null;
    const row = await prisma.order.findFirst({
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
    if (!row) return null;
    return {
      order: this.serializeOrder(row),
      items: row.items.map((it: any) => ({
        id: String(it.id),
        productVariantId: String(it.productVariantId),
        productName: String(it.productName),
        variantSku: String(it.variantSku),
        variantAttributes: (it.variantAttributes ?? null) as Record<string, unknown> | null,
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
  async markOrderPaid(tenantId: string, orderId: string): Promise<boolean> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId)) return false;
    return prisma.$transaction(async (tx: any) => {
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
      const items = (await tx.$queryRaw`
        select
          oi.product_variant_id::text as "variantId",
          oi.quantity,
          v.product_id::text as "productId",
          v.sku as "sku"
        from public.order_items oi
        inner join public.product_variants v on v.id = oi.product_variant_id
        where oi.order_id::text = ${orderId}
      `) as Array<{ variantId: string; quantity: number; productId: string; sku: string }>;

      for (const line of items) {
        const updated = await tx.$executeRaw`
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
          this.logger.error(
            `markOrderPaid: no se pudo commitear stock para ${line.sku} (order ${orderId}). Reserva inconsistente.`
          );
        } else {
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
  async markOrderUnpaid(
    tenantId: string,
    orderId: string,
    finalStatus: "failed" | "cancelled" | "expired"
  ): Promise<boolean> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId)) return false;
    return prisma.$transaction(async (tx: any) => {
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
      const items = (await tx.$queryRaw`
        select
          oi.product_variant_id::text as "variantId",
          oi.quantity,
          v.product_id::text as "productId",
          v.sku as "sku"
        from public.order_items oi
        inner join public.product_variants v on v.id = oi.product_variant_id
        where oi.order_id::text = ${orderId}
      `) as Array<{ variantId: string; quantity: number; productId: string; sku: string }>;

      for (const line of items) {
        const updated = await tx.$executeRaw`
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
  async listOrdersByTenant(
    tenantId: string,
    opts?: {
      status?: OrderRecord["status"] | "all";
      search?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ rows: Array<OrderRecord & { itemCount: number }>; total: number }> {
    if (!UUID_RE.test(tenantId)) return { rows: [], total: 0 };
    const limit = Math.min(Math.max(1, Math.floor(opts?.limit ?? 50)), 200);
    const offset = Math.max(0, Math.floor(opts?.offset ?? 0));

    const params: unknown[] = [tenantId];
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

    const totalRows = (await (prisma as any).$queryRawUnsafe(
      `select count(*)::int as total from public.orders o ${where}`,
      ...params
    )) as Array<{ total: number }>;
    const total = Number(totalRows[0]?.total ?? 0);

    const listParams = [...params, limit, offset];
    const limitIdx = next;
    const offsetIdx = next + 1;
    const rows = (await (prisma as any).$queryRawUnsafe(
      `select
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
      limit $${limitIdx} offset $${offsetIdx}`,
      ...listParams
    )) as Array<any>;

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
  async getOrderDetail(
    tenantId: string,
    orderId: string
  ): Promise<
    | (OrderWithItems & {
        paymentAttempts: Array<{
          id: string;
          status: string;
          provider: string;
          amount: number;
          currency: string;
          checkoutUrl: string | null;
          externalPaymentId: string | null;
          createdAt: string;
          paidAt: string | null;
          lastWebhookAt: string | null;
        }>;
      })
    | null
  > {
    const base = await this.getOrderById(tenantId, orderId);
    if (!base) return null;
    const attempts = await prisma.paymentAttempt.findMany({
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
      paymentAttempts: attempts.map((a: any) => ({
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
  async markOrderFulfilled(tenantId: string, orderId: string): Promise<boolean> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId)) return false;
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new NotFoundException("Order no encontrada.");
    }
    if (order.status === "fulfilled") return true;
    if (order.status !== "paid") {
      throw new BadRequestException(
        `Solo se puede marcar como despachada una Order ya pagada (estado actual: ${order.status}).`
      );
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "fulfilled", fulfilledAt: new Date() },
    });
    return true;
  }

  private serializeOrder(row: any): OrderRecord {
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
      metadata: (row.metadata ?? null) as Record<string, unknown> | null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
