import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@waseller/db";
import { buildPhoneDigitVariants, digitsOnlyPhone } from "@waseller/shared";
import { MercadoPagoService } from "../mercado-pago/mercado-pago.service";
import { OrdersService } from "./orders.service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QTY = 99;

export type ChatOrderPaymentMethod = "alias" | "link_mp" | "efectivo";

export type ChatOrderItem = {
  id: string;
  productVariantId: string;
  productName: string;
  variantSku: string;
  variantAttributes: Record<string, unknown> | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type ChatOrderRecord = {
  id: string;
  status: string;
  totalAmount: number;
  currency: string;
  paymentMethod: ChatOrderPaymentMethod | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: ChatOrderItem[];
  paymentAttempts: Array<{
    id: string;
    status: string;
    checkoutUrl: string | null;
    createdAt: string;
  }>;
};

export type ChatOrderSnapshot = {
  open: ChatOrderRecord | null;
  /** Pedidos confirmados/cerrados recientes para mostrar contexto al vendedor. */
  history: ChatOrderRecord[];
};

@Injectable()
export class ChatOrdersService {
  private readonly logger = new Logger(ChatOrdersService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly mercadoPagoService: MercadoPagoService
  ) {}

  /** Resuelve un teléfono al formato canónico almacenado en `leads.phone`. */
  private async resolvePhone(tenantId: string, phone: string): Promise<string | null> {
    const trimmed = phone.trim();
    if (!trimmed) return null;
    const digits = digitsOnlyPhone(trimmed);
    if (digits.length < 8) return null;
    const variants = new Set<string>([trimmed, digits, ...buildPhoneDigitVariants(digits)]);
    for (const v of variants) {
      const lead = await prisma.lead.findFirst({
        where: { tenantId, phone: v },
        select: { phone: true }
      });
      if (lead) return lead.phone;
    }
    return digits;
  }

  async getForLead(tenantId: string, phone: string): Promise<ChatOrderSnapshot> {
    if (!UUID_RE.test(tenantId)) throw new BadRequestException("tenantId inválido.");
    const resolved = await this.resolvePhone(tenantId, phone);
    if (!resolved) return { open: null, history: [] };

    const orders = await prisma.order.findMany({
      where: { tenantId, buyerPhone: resolved },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        currency: true,
        metadata: true,
        paidAt: true,
        fulfilledAt: true,
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
            lineTotal: true
          }
        },
        paymentAttempts: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            status: true,
            checkoutUrl: true,
            sandboxCheckoutUrl: true,
            createdAt: true
          }
        }
      }
    });

    const records: ChatOrderRecord[] = orders.map((o: any) => this.toRecord(o));
    const open = records.find((r) => r.status === "pending_payment") ?? null;
    const history = records.filter((r) => r.id !== open?.id);
    return { open, history };
  }

  /**
   * Agrega una variante a la Order abierta del lead. Si no hay open Order, crea una nueva.
   * Reserva stock atómicamente; si falla, no toca nada.
   */
  async addItem(input: {
    tenantId: string;
    phone: string;
    variantId: string;
    quantity?: number;
  }): Promise<ChatOrderRecord> {
    const { tenantId } = input;
    if (!UUID_RE.test(tenantId)) throw new BadRequestException("tenantId inválido.");
    if (!UUID_RE.test(input.variantId)) throw new BadRequestException("variantId inválido.");
    const quantity = Math.floor(Number(input.quantity ?? 1));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      throw new BadRequestException(`Cantidad inválida (1-${MAX_QTY}).`);
    }
    const resolved = await this.resolvePhone(tenantId, input.phone);
    if (!resolved) throw new NotFoundException("No se encontró un lead para este teléfono.");
    const lead = await prisma.lead.findFirst({
      where: { tenantId, phone: resolved },
      select: { id: true, customerName: true }
    });
    const buyerName = lead?.customerName?.trim() || resolved;

    return prisma.$transaction(async (tx: any) => {
      // 1. Bloqueo lógico de la variante: leemos stock + precio.
      const variantRows = (await tx.$queryRawUnsafe(
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
        where v.tenant_id::text = $1 and v.id::text = $2
        limit 1`,
        tenantId,
        input.variantId
      )) as Array<any>;
      const v = variantRows[0];
      if (!v) throw new BadRequestException("La variante no existe en este catálogo.");
      if (!v.isActive) throw new BadRequestException(`La variante ${v.sku} no está activa.`);
      const available = Number(v.stock) - Number(v.reservedStock);
      if (available < quantity) {
        throw new BadRequestException(
          `Stock insuficiente para ${v.sku}: disponible ${available}, pedido ${quantity}.`
        );
      }
      const unitPrice = Number(v.effectivePrice ?? 0);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new BadRequestException(`La variante ${v.sku} no tiene precio válido.`);
      }
      const lineTotal = unitPrice * quantity;

      // 2. ¿Ya hay Order abierta para este teléfono?
      const existing = await tx.order.findFirst({
        where: { tenantId, buyerPhone: resolved, status: "pending_payment" },
        orderBy: { createdAt: "desc" },
        select: { id: true, totalAmount: true, items: { select: { id: true, productVariantId: true, quantity: true } } }
      });

      let orderId: string;
      if (existing) {
        orderId = existing.id;
        const dupe = existing.items.find((it: any) => it.productVariantId === input.variantId);
        if (dupe) {
          await tx.orderItem.update({
            where: { id: dupe.id },
            data: {
              quantity: dupe.quantity + quantity,
              lineTotal: new Decimal((dupe.quantity + quantity) * unitPrice)
            }
          });
        } else {
          await tx.orderItem.create({
            data: {
              orderId,
              productVariantId: v.variantId,
              productName: v.productName,
              variantSku: v.sku,
              variantAttributes: (v.attributes ?? {}) as object,
              quantity,
              unitPrice: new Decimal(unitPrice),
              lineTotal: new Decimal(lineTotal)
            }
          });
        }
        await tx.order.update({
          where: { id: orderId },
          data: { totalAmount: new Decimal(Number(existing.totalAmount) + lineTotal) }
        });
      } else {
        const created = await tx.order.create({
          data: {
            tenantId,
            status: "pending_payment",
            totalAmount: new Decimal(lineTotal),
            currency: "ARS",
            buyerName,
            // Email es required en el schema; usamos placeholder porque el chat no lo pide.
            buyerEmail: `${digitsOnlyPhone(resolved)}@whatsapp.local`,
            buyerPhone: resolved,
            buyerNotes: null,
            externalReference: `ws-chat-${randomUUID()}`,
            expiresAt: null,
            metadata: { source: "chat" }
          },
          select: { id: true }
        });
        orderId = created.id;
        await tx.orderItem.create({
          data: {
            orderId,
            productVariantId: v.variantId,
            productName: v.productName,
            variantSku: v.sku,
            variantAttributes: (v.attributes ?? {}) as object,
            quantity,
            unitPrice: new Decimal(unitPrice),
            lineTotal: new Decimal(lineTotal)
          }
        });
      }

      // 3. Reserva atómica de stock.
      const updated = await tx.$executeRaw`
        update public.product_variants
        set reserved_stock = reserved_stock + ${quantity}, updated_at = now()
        where id::text = ${v.variantId}
          and tenant_id::text = ${tenantId}
          and (stock - reserved_stock) >= ${quantity}
      `;
      if (Number(updated) <= 0) {
        throw new BadRequestException(`No se pudo reservar stock para ${v.sku}.`);
      }
      await tx.stockMovement.create({
        data: {
          tenantId,
          productId: v.productId,
          variantId: v.variantId,
          movementType: "reserve",
          deltaStock: 0,
          deltaReserved: quantity,
          reason: "chat_reservation",
          source: "chat-orders.addItem",
          orderId,
          phone: resolved
        }
      });

      // 4. Devolver Order completa.
      const reloaded = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          currency: true,
          metadata: true,
          paidAt: true,
          fulfilledAt: true,
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
              lineTotal: true
            }
          },
          paymentAttempts: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              status: true,
              checkoutUrl: true,
              sandboxCheckoutUrl: true,
              createdAt: true
            }
          }
        }
      });
      return this.toRecord(reloaded);
    });
  }

  /**
   * Cambia la cantidad de un OrderItem en una Order abierta. Ajusta stock reservado por delta.
   * Si `quantity = 0`, elimina el item.
   */
  async updateItemQuantity(input: {
    tenantId: string;
    orderId: string;
    itemId: string;
    quantity: number;
  }): Promise<ChatOrderRecord> {
    const { tenantId, orderId, itemId } = input;
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId) || !UUID_RE.test(itemId)) {
      throw new BadRequestException("ids inválidos.");
    }
    const quantity = Math.floor(Number(input.quantity));
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY) {
      throw new BadRequestException(`Cantidad inválida (0-${MAX_QTY}).`);
    }
    if (quantity === 0) {
      return this.removeItem({ tenantId, orderId, itemId });
    }

    return prisma.$transaction(async (tx: any) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        select: { id: true, status: true, totalAmount: true, buyerPhone: true }
      });
      if (!order) throw new NotFoundException("Order no encontrada.");
      if (order.status !== "pending_payment") {
        throw new BadRequestException(`No se puede editar (estado ${order.status}).`);
      }
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, orderId },
        select: {
          id: true,
          productVariantId: true,
          variantSku: true,
          quantity: true,
          unitPrice: true
        }
      });
      if (!item) throw new NotFoundException("Item no encontrado.");
      const oldQty = Number(item.quantity);
      const delta = quantity - oldQty;
      if (delta === 0) {
        const reloaded = await this.loadOrder(tenantId, orderId);
        if (!reloaded) throw new NotFoundException("Order no encontrada.");
        return reloaded;
      }

      // Variante (para validar stock disponible si delta > 0)
      const variantRows = (await tx.$queryRawUnsafe(
        `select v.id::text as "variantId", v.product_id::text as "productId",
                v.stock as "stock", v.reserved_stock as "reservedStock"
         from public.product_variants v
         where v.tenant_id::text = $1 and v.id::text = $2 limit 1`,
        tenantId,
        item.productVariantId
      )) as Array<any>;
      const v = variantRows[0];
      if (!v) throw new BadRequestException("Variante no encontrada.");

      if (delta > 0) {
        const updated = await tx.$executeRaw`
          update public.product_variants
          set reserved_stock = reserved_stock + ${delta}, updated_at = now()
          where id::text = ${item.productVariantId}
            and tenant_id::text = ${tenantId}
            and (stock - reserved_stock) >= ${delta}
        `;
        if (Number(updated) <= 0) {
          throw new BadRequestException(`Stock insuficiente para ${item.variantSku}.`);
        }
      } else {
        await tx.$executeRaw`
          update public.product_variants
          set reserved_stock = greatest(0, reserved_stock - ${-delta}), updated_at = now()
          where id::text = ${item.productVariantId}
            and tenant_id::text = ${tenantId}
        `;
      }

      const unitPrice = Number(item.unitPrice);
      const newLineTotal = unitPrice * quantity;
      const oldLineTotal = unitPrice * oldQty;
      await tx.orderItem.update({
        where: { id: itemId },
        data: { quantity, lineTotal: new Decimal(newLineTotal) }
      });
      await tx.order.update({
        where: { id: orderId },
        data: { totalAmount: new Decimal(Number(order.totalAmount) - oldLineTotal + newLineTotal) }
      });
      await tx.stockMovement.create({
        data: {
          tenantId,
          productId: v.productId,
          variantId: item.productVariantId,
          movementType: delta > 0 ? "reserve" : "release",
          deltaStock: 0,
          deltaReserved: delta,
          reason: "chat_quantity_update",
          source: "chat-orders.updateItemQuantity",
          orderId,
          phone: order.buyerPhone
        }
      });

      const reloaded = await this.loadOrderTx(tx, tenantId, orderId);
      if (!reloaded) throw new NotFoundException("Order no encontrada tras editar.");
      return reloaded;
    });
  }

  /** Elimina un OrderItem y libera el stock reservado correspondiente. */
  async removeItem(input: {
    tenantId: string;
    orderId: string;
    itemId: string;
  }): Promise<ChatOrderRecord> {
    const { tenantId, orderId, itemId } = input;
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId) || !UUID_RE.test(itemId)) {
      throw new BadRequestException("ids inválidos.");
    }
    return prisma.$transaction(async (tx: any) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        select: { id: true, status: true, totalAmount: true, buyerPhone: true }
      });
      if (!order) throw new NotFoundException("Order no encontrada.");
      if (order.status !== "pending_payment") {
        throw new BadRequestException(`No se puede editar (estado ${order.status}).`);
      }
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, orderId },
        select: {
          id: true,
          productVariantId: true,
          quantity: true,
          lineTotal: true
        }
      });
      if (!item) throw new NotFoundException("Item no encontrado.");

      const variantRows = (await tx.$queryRawUnsafe(
        `select v.id::text as "variantId", v.product_id::text as "productId"
         from public.product_variants v
         where v.tenant_id::text = $1 and v.id::text = $2 limit 1`,
        tenantId,
        item.productVariantId
      )) as Array<any>;
      const v = variantRows[0];

      const qty = Number(item.quantity);
      await tx.orderItem.delete({ where: { id: itemId } });
      await tx.order.update({
        where: { id: orderId },
        data: { totalAmount: new Decimal(Number(order.totalAmount) - Number(item.lineTotal)) }
      });
      await tx.$executeRaw`
        update public.product_variants
        set reserved_stock = greatest(0, reserved_stock - ${qty}), updated_at = now()
        where id::text = ${item.productVariantId}
          and tenant_id::text = ${tenantId}
      `;
      if (v) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: v.productId,
            variantId: item.productVariantId,
            movementType: "release",
            deltaStock: 0,
            deltaReserved: -qty,
            reason: "chat_item_removed",
            source: "chat-orders.removeItem",
            orderId,
            phone: order.buyerPhone
          }
        });
      }

      // Si la orden quedó vacía, la cancelamos para no dejar pedidos fantasma.
      const remaining = await tx.orderItem.count({ where: { orderId } });
      if (remaining === 0) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "cancelled", totalAmount: new Decimal(0) }
        });
      }

      const reloaded = await this.loadOrderTx(tx, tenantId, orderId);
      if (!reloaded) throw new NotFoundException("Order no encontrada tras eliminar.");
      return reloaded;
    });
  }

  /** Setea metadata.paymentMethod ("alias" | "link_mp" | "efectivo"). No cambia el estado. */
  async setPaymentMethod(
    tenantId: string,
    orderId: string,
    method: ChatOrderPaymentMethod
  ): Promise<ChatOrderRecord> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId)) {
      throw new BadRequestException("ids inválidos.");
    }
    if (method !== "alias" && method !== "link_mp" && method !== "efectivo") {
      throw new BadRequestException("Método de pago inválido.");
    }
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, metadata: true }
    });
    if (!order) throw new NotFoundException("Order no encontrada.");
    const meta = (order.metadata ?? {}) as Record<string, unknown>;
    await prisma.order.update({
      where: { id: orderId },
      data: { metadata: { ...meta, paymentMethod: method } as object }
    });
    const updated = await this.loadOrder(tenantId, orderId);
    if (!updated) throw new NotFoundException("Order no encontrada tras actualizar.");
    return updated;
  }

  /** Genera link de pago de Mercado Pago para la Order completa. backUrls los arma el caller. */
  async createMpLink(input: {
    tenantId: string;
    orderId: string;
    backUrls: { success: string; failure: string; pending: string };
  }): Promise<{ checkoutUrl: string; paymentAttemptId: string }> {
    const { tenantId, orderId } = input;
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId)) {
      throw new BadRequestException("ids inválidos.");
    }
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        status: true,
        externalReference: true,
        buyerName: true,
        buyerEmail: true,
        buyerPhone: true,
        items: {
          select: {
            productVariantId: true,
            productName: true,
            variantSku: true,
            quantity: true,
            unitPrice: true
          }
        }
      }
    });
    if (!order) throw new NotFoundException("Order no encontrada.");
    if (order.status !== "pending_payment") {
      throw new BadRequestException(`No se pueden generar links: estado ${order.status}.`);
    }
    if (order.items.length === 0) {
      throw new BadRequestException("La orden no tiene items.");
    }
    const result = await this.mercadoPagoService.createOrderCheckoutPreference({
      tenantId,
      orderId: order.id,
      externalReference: order.externalReference,
      items: order.items.map((it: any) => ({
        title: `${it.productName} (${it.variantSku})`,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice)
      })),
      payer: {
        name: order.buyerName,
        email: order.buyerEmail,
        phone: order.buyerPhone
      },
      backUrls: input.backUrls,
      metadata: { source: "chat" }
    });
    await this.setPaymentMethod(tenantId, orderId, "link_mp");
    return { checkoutUrl: result.checkoutUrl, paymentAttemptId: result.paymentAttemptId };
  }

  async confirmPaid(tenantId: string, orderId: string): Promise<ChatOrderRecord> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId)) {
      throw new BadRequestException("ids inválidos.");
    }
    const ok = await this.ordersService.markOrderPaid(tenantId, orderId);
    if (!ok) throw new BadRequestException("No se pudo marcar como pagada (estado no válido).");
    const updated = await this.loadOrder(tenantId, orderId);
    if (!updated) throw new NotFoundException("Order no encontrada tras confirmar pago.");
    return updated;
  }

  async cancel(tenantId: string, orderId: string): Promise<ChatOrderRecord> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId)) {
      throw new BadRequestException("ids inválidos.");
    }
    const ok = await this.ordersService.markOrderUnpaid(tenantId, orderId, "cancelled");
    if (!ok) throw new BadRequestException("No se pudo cancelar (estado no válido).");
    const updated = await this.loadOrder(tenantId, orderId);
    if (!updated) throw new NotFoundException("Order no encontrada tras cancelar.");
    return updated;
  }

  async fulfill(tenantId: string, orderId: string): Promise<ChatOrderRecord> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(orderId)) {
      throw new BadRequestException("ids inválidos.");
    }
    await this.ordersService.markOrderFulfilled(tenantId, orderId);
    const updated = await this.loadOrder(tenantId, orderId);
    if (!updated) throw new NotFoundException("Order no encontrada tras despachar.");
    return updated;
  }

  /** Lee el alias de transferencia desde tenant_knowledge.profile.payment.transferAlias. */
  async getTenantAlias(tenantId: string): Promise<string> {
    if (!UUID_RE.test(tenantId)) throw new BadRequestException("tenantId inválido.");
    try {
      const rows = (await (prisma as any).$queryRaw`
        select profile from public.tenant_knowledge where tenant_id::text = ${tenantId} limit 1
      `) as Array<{ profile: any }>;
      const profile = rows[0]?.profile ?? {};
      const alias = String(profile?.payment?.transferAlias ?? "").trim();
      return alias;
    } catch {
      return "";
    }
  }

  /** Actualiza solo `payment.transferAlias` en el JSON de tenant_knowledge. */
  async setTenantAlias(tenantId: string, alias: string): Promise<{ transferAlias: string }> {
    if (!UUID_RE.test(tenantId)) throw new BadRequestException("tenantId inválido.");
    const trimmed = String(alias ?? "").trim().slice(0, 80);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true }
    });
    const tenantName = String(tenant?.name ?? "").trim();
    const rows = (await (prisma as any).$queryRaw`
      select profile, business_category as "businessCategory", business_labels as "businessLabels"
      from public.tenant_knowledge
      where tenant_id::text = ${tenantId}
      limit 1
    `) as Array<{ profile: any; businessCategory: string; businessLabels: string[] }>;
    const existing = rows[0];
    const baseProfile: Record<string, any> =
      existing?.profile && typeof existing.profile === "object"
        ? { ...(existing.profile as Record<string, any>) }
        : { businessName: tenantName || undefined };
    const basePayment: Record<string, any> =
      baseProfile.payment && typeof baseProfile.payment === "object"
        ? { ...(baseProfile.payment as Record<string, any>) }
        : { methods: ["link_pago", "efectivo_retiro"], acceptsInstallments: false };
    basePayment.transferAlias = trimmed || undefined;
    baseProfile.payment = basePayment;

    const businessCategory = existing?.businessCategory ?? baseProfile.businessCategory ?? "general";
    const businessLabels = Array.isArray(existing?.businessLabels)
      ? existing.businessLabels
      : Array.isArray(baseProfile.businessLabels)
        ? baseProfile.businessLabels
        : [];

    await prisma.tenantKnowledge.upsert({
      where: { tenantId },
      create: {
        tenantId,
        businessCategory,
        businessLabels,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        profile: baseProfile as any
      },
      update: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        profile: baseProfile as any
      }
    });
    return { transferAlias: trimmed };
  }

  private async loadOrderTx(tx: any, tenantId: string, orderId: string): Promise<ChatOrderRecord | null> {
    const row = await tx.order.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        currency: true,
        metadata: true,
        paidAt: true,
        fulfilledAt: true,
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
            lineTotal: true
          }
        },
        paymentAttempts: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            status: true,
            checkoutUrl: true,
            sandboxCheckoutUrl: true,
            createdAt: true
          }
        }
      }
    });
    if (!row) return null;
    return this.toRecord(row);
  }

  private async loadOrder(tenantId: string, orderId: string): Promise<ChatOrderRecord | null> {
    const row = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        currency: true,
        metadata: true,
        paidAt: true,
        fulfilledAt: true,
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
            lineTotal: true
          }
        },
        paymentAttempts: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            status: true,
            checkoutUrl: true,
            sandboxCheckoutUrl: true,
            createdAt: true
          }
        }
      }
    });
    if (!row) return null;
    return this.toRecord(row);
  }

  private toRecord(o: any): ChatOrderRecord {
    const meta = (o.metadata ?? {}) as Record<string, unknown>;
    const rawMethod = String(meta.paymentMethod ?? "").trim();
    const paymentMethod: ChatOrderPaymentMethod | null =
      rawMethod === "alias" || rawMethod === "link_mp" || rawMethod === "efectivo" ? rawMethod : null;
    return {
      id: String(o.id),
      status: String(o.status),
      totalAmount: Number(o.totalAmount),
      currency: String(o.currency),
      paymentMethod,
      paidAt: o.paidAt ? new Date(o.paidAt).toISOString() : null,
      fulfilledAt: o.fulfilledAt ? new Date(o.fulfilledAt).toISOString() : null,
      createdAt: new Date(o.createdAt).toISOString(),
      updatedAt: new Date(o.updatedAt).toISOString(),
      items: (o.items ?? []).map((it: any) => ({
        id: String(it.id),
        productVariantId: String(it.productVariantId),
        productName: String(it.productName),
        variantSku: String(it.variantSku),
        variantAttributes: (it.variantAttributes ?? null) as Record<string, unknown> | null,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        lineTotal: Number(it.lineTotal)
      })),
      paymentAttempts: (o.paymentAttempts ?? []).map((p: any) => ({
        id: String(p.id),
        status: String(p.status),
        checkoutUrl: String(p.checkoutUrl ?? p.sandboxCheckoutUrl ?? "") || null,
        createdAt: new Date(p.createdAt).toISOString()
      }))
    };
  }
}
