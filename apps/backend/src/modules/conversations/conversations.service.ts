import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../../../../../packages/db/src";
import {
  JOB_SCHEMA_VERSION,
  buildCorrelationId,
  buildStableDedupeKey,
  outgoingQueue
} from "../../../../../packages/queue/src";
import { OUTGOING_ATTEMPTS, OUTGOING_PRIORITY } from "../../../../../packages/shared/src";
import { MercadoPagoService } from "../mercado-pago/mercado-pago.service";
import { buildPhoneDigitVariants, digitsOnlyPhone } from "../../../../../packages/shared/src";

const DEFAULT_PAYMENT_LINK_GENERATED_TEMPLATE =
  "Perfecto, te comparto el link de pago de {product_name}: {payment_url} Cuando se acredite te confirmamos por este medio.";

@Injectable()
export class ConversationsService {
  constructor(private readonly mercadoPagoService: MercadoPagoService) {}

  /** Variantes de `phone` para alinear URL / lead / fila `conversations` (mismo dígito, distinto prefijo). */
  private async matchConversationPhoneVariants(tenantId: string, phoneParam: string): Promise<string[]> {
    const raw = decodeURIComponent(phoneParam).trim();
    const resolved = (await this.resolvePhoneForLead(tenantId, raw)) ?? raw;
    const phoneCandidates = new Set<string>([resolved, raw]);
    for (const v of buildPhoneDigitVariants(digitsOnlyPhone(raw))) {
      phoneCandidates.add(v);
    }
    for (const v of buildPhoneDigitVariants(digitsOnlyPhone(resolved))) {
      phoneCandidates.add(v);
    }
    const phones = [...phoneCandidates].filter((p) => digitsOnlyPhone(p).length >= 8);
    return [...new Set(phones.length > 0 ? phones : [resolved])];
  }

  private coerceUnitPrice(value: unknown): number {
    if (value === null || value === undefined) return NaN;
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "string") return Number(value.replace(",", "."));
    if (typeof value === "object" && value !== null && "toString" in value) {
      return Number(String(value).replace(",", "."));
    }
    return NaN;
  }

  /** Mismo texto que plantilla `payment_link_generated` del bot (incl. override por tenant en BD). */
  private async renderPaymentLinkGeneratedMessage(
    tenantId: string,
    productName: string,
    paymentUrl: string
  ): Promise<string> {
    let template = DEFAULT_PAYMENT_LINK_GENERATED_TEMPLATE;
    try {
      const overrideRows = (await (prisma as any).$queryRaw`
        select template
        from public.bot_response_templates
        where tenant_id::text = ${tenantId}
          and lower(trim(key)) = 'payment_link_generated'
          and is_active = true
        limit 1
      `) as Array<{ template: string }>;
      const custom = String(overrideRows[0]?.template ?? "").trim();
      if (custom) template = custom;
    } catch {
      // sin tabla o error de lectura: default del producto
    }
    return template.replaceAll("{product_name}", productName).replaceAll("{payment_url}", paymentUrl);
  }

  /** Alinea el teléfono de la URL con el string guardado en `leads` / mensajes (dígitos, prefijos, etc.). */
  private async resolvePhoneForLead(tenantId: string, phone: string): Promise<string | null> {
    const trimmed = phone.trim();
    if (!trimmed) return null;
    const digits = digitsOnlyPhone(trimmed);
    if (digits.length < 8) return null;

    const stringVariants = new Set<string>([trimmed, digits, ...buildPhoneDigitVariants(digits)]);
    for (const v of stringVariants) {
      const found = await prisma.lead.findFirst({
        where: { tenantId, phone: v },
        select: { phone: true }
      });
      if (found) return found.phone;
    }

    for (const variantDigits of buildPhoneDigitVariants(digits)) {
      const rows = (await prisma.$queryRaw`
        select phone
        from public.leads
        where tenant_id::text = ${tenantId}
          and regexp_replace(phone, '[^0-9]', '', 'g') = ${variantDigits}
        limit 1
      `) as Array<{ phone: string }>;
      if (rows[0]?.phone) return rows[0].phone;
    }
    return null;
  }

  private async getOrCreateConversation(
    tenantId: string,
    phone: string
  ): Promise<{ id: string; state: string }> {
    const existing = await prisma.conversation.findFirst({
      where: { tenantId, phone },
      orderBy: { updatedAt: "desc" },
      select: { id: true, state: true }
    });
    if (existing) return existing;

    return prisma.conversation.create({
      data: {
        tenantId,
        phone,
        state: "open"
      },
      select: { id: true, state: true }
    });
  }

  async listMessages(tenantId: string, phone: string): Promise<unknown[]> {
    const uniquePhones = await this.matchConversationPhoneVariants(tenantId, phone);
    return prisma.message.findMany({
      where: { tenantId, phone: { in: uniquePhones } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        phone: true,
        message: true,
        direction: true,
        createdAt: true
      }
    });
  }

  async getState(
    tenantId: string,
    phone: string
  ): Promise<{ state: string; botPaused: boolean; leadClosed: boolean; archived: boolean }> {
    const variants = await this.matchConversationPhoneVariants(tenantId, phone);
    const conversation = await prisma.conversation.findFirst({
      where: { tenantId, phone: { in: variants } },
      orderBy: { updatedAt: "desc" },
      select: { state: true, archivedAt: true }
    });
    if (!conversation) {
      return { state: "open", botPaused: false, leadClosed: false, archived: false };
    }
    return {
      state: conversation.state,
      botPaused: conversation.state === "manual_paused",
      leadClosed: conversation.state === "lead_closed",
      archived: Boolean(conversation.archivedAt)
    };
  }

  async archiveFromInbox(tenantId: string, phoneParam: string): Promise<{ ok: true }> {
    const raw = decodeURIComponent(phoneParam).trim();
    const resolved = (await this.resolvePhoneForLead(tenantId, raw)) ?? raw;
    const lead = await prisma.lead.findFirst({
      where: { tenantId, phone: resolved },
      select: { id: true, phone: true, lastMessage: true }
    });
    const now = new Date();

    const existingByLead = lead
      ? await prisma.conversation.findFirst({ where: { tenantId, leadId: lead.id } })
      : null;
    const existingByPhone = await prisma.conversation.findFirst({
      where: { tenantId, phone: resolved },
      orderBy: { updatedAt: "desc" }
    });
    const existing = existingByLead ?? existingByPhone;

    if (existing) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: {
          archivedAt: now,
          phone: lead?.phone ?? existing.phone
        }
      });
    } else if (lead) {
      await prisma.conversation.create({
        data: {
          tenantId,
          phone: lead.phone,
          leadId: lead.id,
          state: "open",
          lastMessage: lead.lastMessage ?? null,
          archivedAt: now
        }
      });
    } else {
      await prisma.conversation.create({
        data: {
          tenantId,
          phone: resolved,
          state: "open",
          archivedAt: now
        }
      });
    }
    if (lead) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { inboxHiddenAt: now }
      });
    }
    return { ok: true };
  }

  async unarchiveFromInbox(tenantId: string, phoneParam: string): Promise<{ ok: true }> {
    const raw = decodeURIComponent(phoneParam).trim();
    const resolved = (await this.resolvePhoneForLead(tenantId, raw)) ?? raw;
    const lead = await prisma.lead.findFirst({
      where: { tenantId, phone: resolved },
      select: { id: true }
    });
    await prisma.conversation.updateMany({
      where: { tenantId, phone: resolved },
      data: { archivedAt: null }
    });
    if (lead) {
      await prisma.conversation.updateMany({
        where: { tenantId, leadId: lead.id },
        data: { archivedAt: null }
      });
      await prisma.lead.update({
        where: { id: lead.id },
        data: { inboxHiddenAt: null }
      });
    }
    return { ok: true };
  }

  async resolveChat(tenantId: string, phone: string): Promise<{ state: string; botPaused: boolean }> {
    const conversation = await this.getOrCreateConversation(tenantId, phone);
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { state: "manual_paused" },
      select: { state: true }
    });
    return { state: updated.state, botPaused: true };
  }

  async reopenChat(tenantId: string, phone: string): Promise<{ state: string; botPaused: boolean }> {
    const conversation = await this.getOrCreateConversation(tenantId, phone);
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { state: "open" },
      select: { state: true }
    });
    return { state: updated.state, botPaused: false };
  }

  async closeLead(tenantId: string, phone: string): Promise<{ state: string; botPaused: boolean; leadClosed: boolean }> {
    const conversation = await this.getOrCreateConversation(tenantId, phone);
    const lead = await prisma.lead.findFirst({
      where: { tenantId, phone },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        product: true,
        productVariantId: true,
        hasStockReservation: true
      }
    });

    if (lead?.hasStockReservation && lead.productVariantId) {
      await prisma.$transaction(async (tx: any) => {
        const rows = (await tx.$queryRaw`
          select id, product_id as "productId", reserved_stock as "reservedStock"
          from public.product_variants
          where tenant_id::text = ${tenantId}
            and id::text = ${lead.productVariantId}
          limit 1
        `) as Array<{ id: string; productId: string; reservedStock: number }>;
        const variant = rows[0];
        if (!variant || variant.reservedStock < 1) return;
        const changed = await tx.$executeRaw`
          update public.product_variants
          set reserved_stock = reserved_stock - 1, updated_at = now()
          where id::text = ${variant.id}
            and tenant_id::text = ${tenantId}
            and reserved_stock = ${variant.reservedStock}
        `;
        if (Number(changed) <= 0) return;
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: variant.productId,
            variantId: variant.id,
            movementType: "release",
            deltaStock: 0,
            deltaReserved: -1,
            reason: "lead_closed",
            source: "api_conversations_close_lead",
            leadId: lead.id,
            phone
          }
        });
      });
    }

    if (lead) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          // Keep a valid persisted lead_status value; closure state is tracked in Conversation.state.
          status: "frio",
          score: 0,
          product: null,
          productVariantId: null,
          productVariantAttributes: null,
          hasStockReservation: false,
          reservationExpiresAt: null
        }
      });
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { state: "lead_closed" },
      select: { state: true }
    });
    return { state: updated.state, botPaused: false, leadClosed: true };
  }

  async manualReply(tenantId: string, phone: string, message: string): Promise<{ queued: boolean }> {
    const conversation = await this.getOrCreateConversation(tenantId, phone);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessage: message }
    });

    const dedupeKey = buildStableDedupeKey(tenantId, phone, "manual-reply", message);
    await outgoingQueue.add(
      "manual-reply-v1",
      {
        schemaVersion: JOB_SCHEMA_VERSION,
        correlationId: buildCorrelationId(),
        dedupeKey,
        tenantId,
        phone,
        message,
        priority: OUTGOING_PRIORITY.HIGH,
        metadata: {
          source: "manual"
        }
      },
      {
        priority: OUTGOING_PRIORITY.HIGH,
        attempts: OUTGOING_ATTEMPTS,
        backoff: { type: "smart" },
        jobId: `manual_${dedupeKey}`
      }
    );
    return { queued: true };
  }

  async listPaymentReviews(
    tenantId: string,
    phone: string
  ): Promise<
    Array<{
      id: string;
      status: string;
      title: string;
      amount: number;
      currency: string;
      checkoutUrl: string | null;
      sandboxCheckoutUrl: string | null;
      createdAt: string;
      updatedAt: string;
      paymentLinkSentAt: string | null;
      productName: string | null;
      variantAttributes: Record<string, string>;
      outboundMessagePreview: string | null;
    }>
  > {
    const resolvedPhone = await this.resolvePhoneForLead(tenantId, phone);
    if (!resolvedPhone) return [];
    const lead = await prisma.lead.findFirst({
      where: { tenantId, phone: resolvedPhone },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });
    if (!lead) return [];
    const rows = (await (prisma as any).$queryRaw`
      select
        id,
        status::text as status,
        title,
        amount,
        currency,
        checkout_url as "checkoutUrl",
        sandbox_checkout_url as "sandboxCheckoutUrl",
        payment_link_sent_at as "paymentLinkSentAt",
        metadata,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from public.payment_attempts
      where tenant_id::text = ${tenantId}
        and lead_id::text = ${lead.id}
      order by created_at desc
      limit 10
    `) as Array<{
      id: string;
      status: string;
      title: string;
      amount: unknown;
      currency: string;
      checkoutUrl: string | null;
      sandboxCheckoutUrl: string | null;
      paymentLinkSentAt: Date | string | null;
      metadata?: unknown;
      createdAt: Date | string;
      updatedAt: Date | string;
    }>;
    const mapped = rows.map((row) => {
      const metadata =
        typeof row.metadata === "object" && row.metadata !== null ? (row.metadata as Record<string, unknown>) : {};
      const variantAttributes =
        typeof metadata.variantAttributes === "object" && metadata.variantAttributes !== null
          ? Object.fromEntries(
              Object.entries(metadata.variantAttributes as Record<string, unknown>).map(([key, value]) => [
                String(key),
                String(value ?? "").trim()
              ])
            )
          : {};
      return {
        id: row.id,
        status: row.status,
        title: row.title,
        amount: Number(row.amount ?? 0),
        currency: row.currency,
        checkoutUrl: row.checkoutUrl,
        sandboxCheckoutUrl: row.sandboxCheckoutUrl,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
        paymentLinkSentAt: row.paymentLinkSentAt ? new Date(row.paymentLinkSentAt).toISOString() : null,
        productName: String(metadata.productName ?? "").trim() || null,
        variantAttributes
      };
    });

    return Promise.all(
      mapped.map(async (item) => {
        const url = String(item.checkoutUrl ?? item.sandboxCheckoutUrl ?? "").trim();
        const canPreviewManualSend =
          !item.paymentLinkSentAt &&
          Boolean(url) &&
          (item.status === "draft" || item.status === "pending");
        if (!canPreviewManualSend) {
          return { ...item, outboundMessagePreview: null as string | null };
        }
        const productLabel = String(item.productName ?? item.title ?? "tu compra").trim();
        const outboundMessagePreview = await this.renderPaymentLinkGeneratedMessage(tenantId, productLabel, url);
        return { ...item, outboundMessagePreview };
      })
    );
  }

  /**
   * Genera en Mercado Pago el borrador (`payment_attempts` = draft) para revisión/envío manual.
   * Útil cuando el bot respondió con derivación pero no llegó a crear la preferencia.
   */
  async prepareDraftPaymentLink(
    tenantId: string,
    phone: string
  ): Promise<{ paymentAttemptId: string; checkoutUrl: string; reusedExisting: boolean }> {
    const resolvedPhone = await this.resolvePhoneForLead(tenantId, phone);
    if (!resolvedPhone) throw new NotFoundException("No encontramos un lead para este contacto.");
    const lead = await prisma.lead.findFirst({
      where: { tenantId, phone: resolvedPhone },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        productVariantId: true,
        hasStockReservation: true,
        product: true,
        productVariantAttributes: true
      }
    });
    if (!lead) throw new NotFoundException("No encontramos un lead para este contacto.");
    if (!lead.productVariantId) {
      throw new BadRequestException("El lead no tiene variante de producto; no se puede armar el cobro.");
    }

    const existingOpenAttempt = (await (prisma as any).$queryRaw`
      select id, checkout_url as "checkoutUrl", sandbox_checkout_url as "sandboxCheckoutUrl"
      from public.payment_attempts
      where tenant_id::text = ${tenantId}
        and lead_id::text = ${lead.id}
        and payment_link_sent_at is null
        and status in ('draft'::payment_attempt_status, 'pending'::payment_attempt_status)
        and (
          length(btrim(coalesce(checkout_url::text, ''))) > 0
          or length(btrim(coalesce(sandbox_checkout_url::text, ''))) > 0
        )
      order by created_at desc
      limit 1
    `) as Array<{ id: string; checkoutUrl: string | null; sandboxCheckoutUrl: string | null }>;
    const draftRow = existingOpenAttempt[0];
    const existingUrl = String(draftRow?.checkoutUrl ?? draftRow?.sandboxCheckoutUrl ?? "").trim();
    if (draftRow && existingUrl) {
      return { paymentAttemptId: draftRow.id, checkoutUrl: existingUrl, reusedExisting: true };
    }

    const variantRows = (await (prisma as any).$queryRaw`
      select
        v.id as "variantId",
        coalesce(v.price, p.price) as "effectivePrice",
        p.name as "productName",
        v.attributes
      from public.product_variants v
      inner join public.products p on p.id = v.product_id
      where v.tenant_id::text = ${tenantId}
        and v.id::text = ${lead.productVariantId}
      limit 1
    `) as Array<{
      variantId: string;
      effectivePrice: unknown;
      productName: string;
      attributes: Record<string, unknown>;
    }>;
    const vr = variantRows[0];
    if (!vr) {
      throw new BadRequestException("No se encontró la variante de producto en catálogo.");
    }
    const unit = this.coerceUnitPrice(vr.effectivePrice);
    if (!Number.isFinite(unit) || unit <= 0) {
      throw new BadRequestException("La variante no tiene precio válido; cargalo en stock o catálogo.");
    }
    const attrs = (vr.attributes ?? {}) as Record<string, string>;
    const attrBits = Object.entries(attrs)
      .filter(([, v]) => String(v ?? "").trim().length > 0)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const title = `${vr.productName}${attrBits ? ` — ${attrBits}` : ""}`;
    const variantAttributes =
      typeof lead.productVariantAttributes === "object" && lead.productVariantAttributes !== null
        ? Object.fromEntries(
            Object.entries(lead.productVariantAttributes as Record<string, unknown>).map(([k, v]) => [
              String(k),
              String(v ?? "").trim()
            ])
          )
        : Object.fromEntries(
            Object.entries(attrs).map(([k, v]) => [String(k), String(v ?? "").trim()])
          );

    const created = await this.mercadoPagoService.createDraftCheckoutPreference({
      tenantId,
      leadId: lead.id,
      phone: resolvedPhone,
      productVariantId: lead.productVariantId,
      title,
      amount: unit,
      metadata: {
        productName: vr.productName,
        variantAttributes
      }
    });
    return {
      paymentAttemptId: created.paymentAttemptId,
      checkoutUrl: created.checkoutUrl,
      reusedExisting: false
    };
  }

  async sendPreparedPaymentLink(
    tenantId: string,
    phone: string,
    attemptId: string
  ): Promise<{ queued: boolean; attemptId: string }> {
    const resolvedPhone = await this.resolvePhoneForLead(tenantId, phone);
    if (!resolvedPhone) throw new Error("Lead no encontrado para esta conversación.");
    const lead = await prisma.lead.findFirst({
      where: { tenantId, phone: resolvedPhone },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });
    if (!lead) throw new Error("Lead no encontrado para esta conversación.");
    const rows = (await (prisma as any).$queryRaw`
      select
        id,
        status::text as status,
        title,
        checkout_url as "checkoutUrl",
        sandbox_checkout_url as "sandboxCheckoutUrl",
        metadata
      from public.payment_attempts
      where tenant_id::text = ${tenantId}
        and lead_id::text = ${lead.id}
        and id::text = ${attemptId}
      limit 1
    `) as Array<{
      id: string;
      status: string;
      title: string;
      checkoutUrl: string | null;
      sandboxCheckoutUrl: string | null;
      metadata?: unknown;
    }>;
    const attempt = rows[0];
    if (!attempt) throw new Error("No encontramos ese link de pago para esta conversación.");
    const checkoutUrl = String(attempt.checkoutUrl ?? attempt.sandboxCheckoutUrl ?? "").trim();
    if (!checkoutUrl) throw new Error("El intento de pago no tiene URL de checkout disponible.");
    const metadata =
      typeof attempt.metadata === "object" && attempt.metadata !== null ? (attempt.metadata as Record<string, unknown>) : {};
    const productName = String(metadata.productName ?? attempt.title ?? "tu compra").trim();
    const message = await this.renderPaymentLinkGeneratedMessage(tenantId, productName, checkoutUrl);

    const conversation = await this.getOrCreateConversation(tenantId, resolvedPhone);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessage: message }
    });

    const dedupeKey = buildStableDedupeKey(tenantId, resolvedPhone, "manual-payment-link", attempt.id, checkoutUrl);
    await outgoingQueue.add(
      "manual-payment-link-v1",
      {
        schemaVersion: JOB_SCHEMA_VERSION,
        correlationId: buildCorrelationId(),
        dedupeKey,
        tenantId,
        phone: resolvedPhone,
        message,
        priority: OUTGOING_PRIORITY.HIGH,
        metadata: {
          source: "manual",
          nextBestAction: "share_payment_link"
        }
      },
      {
        priority: OUTGOING_PRIORITY.HIGH,
        attempts: OUTGOING_ATTEMPTS,
        backoff: { type: "smart" },
        jobId: `manual_payment_${dedupeKey}`
      }
    );

    await (prisma as any).$executeRaw`
      update public.payment_attempts
      set
        status = 'link_generated'::payment_attempt_status,
        payment_link_sent_at = coalesce(payment_link_sent_at, now()),
        updated_at = now()
      where id::text = ${attempt.id}
    `;

    return { queued: true, attemptId: attempt.id };
  }

  async handoffAssistive(
    tenantId: string,
    phone: string,
    reason: string
  ): Promise<{ state: string; botPaused: boolean; summary: string }> {
    const conversation = await this.getOrCreateConversation(tenantId, phone);
    const recentMessages = await prisma.message.findMany({
      where: { tenantId, phone },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { direction: true, message: true }
    });
    const lastIncoming =
      recentMessages.find((msg: { direction: "incoming" | "outgoing"; message: string }) => msg.direction === "incoming")
        ?.message ?? "";
    const lastOutgoing =
      recentMessages.find((msg: { direction: "incoming" | "outgoing"; message: string }) => msg.direction === "outgoing")
        ?.message ?? "";
    const summary = [
      `Motivo de derivación: ${reason.trim() || "confianza baja del asistente"}.`,
      `Último mensaje cliente: ${lastIncoming || "n/a"}.`,
      `Última respuesta bot: ${lastOutgoing || "n/a"}.`
    ].join(" ");

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { state: "manual_paused", lastMessage: summary },
      select: { state: true }
    });
    return {
      state: updated.state,
      botPaused: true,
      summary
    };
  }
}
