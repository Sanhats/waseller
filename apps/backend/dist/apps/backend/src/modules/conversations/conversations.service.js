"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationsService = void 0;
const common_1 = require("@nestjs/common");
const src_1 = require("../../../../../packages/db/src");
const src_2 = require("../../../../../packages/queue/src");
const src_3 = require("../../../../../packages/shared/src");
const mercado_pago_service_1 = require("../mercado-pago/mercado-pago.service");
const src_4 = require("../../../../../packages/shared/src");
/** Cache por proceso: evita `prisma:error` 42P01 si la tabla opcional no existe (BD sin migrar). */
let botResponseTemplatesTableExists = null;
async function resolveBotResponseTemplatesTableExists() {
    if (botResponseTemplatesTableExists !== null)
        return botResponseTemplatesTableExists;
    try {
        const rows = (await src_1.prisma.$queryRaw `
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'bot_response_templates'
      ) as "exists"
    `);
        botResponseTemplatesTableExists = Boolean(rows[0]?.exists);
    }
    catch {
        botResponseTemplatesTableExists = false;
    }
    return botResponseTemplatesTableExists;
}
const DEFAULT_PAYMENT_LINK_GENERATED_TEMPLATE = "Perfecto, te comparto el link de pago de {product_name}: {payment_url} Cuando se acredite te confirmamos por este medio.";
let ConversationsService = class ConversationsService {
    mercadoPagoService;
    constructor(mercadoPagoService) {
        this.mercadoPagoService = mercadoPagoService;
    }
    /** Variantes de `phone` para alinear URL / lead / fila `conversations` (mismo dígito, distinto prefijo). */
    async matchConversationPhoneVariants(tenantId, phoneParam) {
        const raw = decodeURIComponent(phoneParam).trim();
        const resolved = (await this.resolvePhoneForLead(tenantId, raw)) ?? raw;
        const phoneCandidates = new Set([resolved, raw]);
        for (const v of (0, src_4.buildPhoneDigitVariants)((0, src_4.digitsOnlyPhone)(raw))) {
            phoneCandidates.add(v);
        }
        for (const v of (0, src_4.buildPhoneDigitVariants)((0, src_4.digitsOnlyPhone)(resolved))) {
            phoneCandidates.add(v);
        }
        const phones = [...phoneCandidates].filter((p) => (0, src_4.digitsOnlyPhone)(p).length >= 8);
        return [...new Set(phones.length > 0 ? phones : [resolved])];
    }
    coerceUnitPrice(value) {
        if (value === null || value === undefined)
            return NaN;
        if (typeof value === "number")
            return value;
        if (typeof value === "bigint")
            return Number(value);
        if (typeof value === "string")
            return Number(value.replace(",", "."));
        if (typeof value === "object" && value !== null && "toString" in value) {
            return Number(String(value).replace(",", "."));
        }
        return NaN;
    }
    /** Mismo texto que plantilla `payment_link_generated` del bot (incl. override por tenant en BD). */
    async renderPaymentLinkGeneratedMessage(tenantId, productName, paymentUrl) {
        let template = DEFAULT_PAYMENT_LINK_GENERATED_TEMPLATE;
        if (await resolveBotResponseTemplatesTableExists()) {
            try {
                const overrideRows = (await src_1.prisma.$queryRaw `
          select template
          from public.bot_response_templates
          where tenant_id = ${tenantId}::uuid
            and lower(trim(key)) = 'payment_link_generated'
            and is_active = true
          limit 1
        `);
                const custom = String(overrideRows[0]?.template ?? "").trim();
                if (custom)
                    template = custom;
            }
            catch {
                // lectura fallida: default del producto
            }
        }
        return template.replaceAll("{product_name}", productName).replaceAll("{payment_url}", paymentUrl);
    }
    /** Alinea el teléfono de la URL con el string guardado en `leads` / mensajes (dígitos, prefijos, etc.). */
    async resolvePhoneForLead(tenantId, phone) {
        const trimmed = phone.trim();
        if (!trimmed)
            return null;
        const digits = (0, src_4.digitsOnlyPhone)(trimmed);
        if (digits.length < 8)
            return null;
        const stringVariants = new Set([trimmed, digits, ...(0, src_4.buildPhoneDigitVariants)(digits)]);
        for (const v of stringVariants) {
            const found = await src_1.prisma.lead.findFirst({
                where: { tenantId, phone: v },
                select: { phone: true }
            });
            if (found)
                return found.phone;
        }
        for (const variantDigits of (0, src_4.buildPhoneDigitVariants)(digits)) {
            const rows = (await src_1.prisma.$queryRaw `
        select phone
        from public.leads
        where tenant_id = ${tenantId}::uuid
          and regexp_replace(phone, '[^0-9]', '', 'g') = ${variantDigits}
        limit 1
      `);
            if (rows[0]?.phone)
                return rows[0].phone;
        }
        return null;
    }
    async getOrCreateConversation(tenantId, phone) {
        const existing = await src_1.prisma.conversation.findFirst({
            where: { tenantId, phone },
            orderBy: { updatedAt: "desc" },
            select: { id: true, state: true }
        });
        if (existing)
            return existing;
        return src_1.prisma.conversation.create({
            data: {
                tenantId,
                phone,
                state: "open"
            },
            select: { id: true, state: true }
        });
    }
    async listMessages(tenantId, phone) {
        const uniquePhones = await this.matchConversationPhoneVariants(tenantId, phone);
        return src_1.prisma.message.findMany({
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
    async getState(tenantId, phone) {
        const variants = await this.matchConversationPhoneVariants(tenantId, phone);
        const conversation = await src_1.prisma.conversation.findFirst({
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
    async archiveFromInbox(tenantId, phoneParam) {
        const raw = decodeURIComponent(phoneParam).trim();
        const resolved = (await this.resolvePhoneForLead(tenantId, raw)) ?? raw;
        const lead = await src_1.prisma.lead.findFirst({
            where: { tenantId, phone: resolved },
            select: { id: true, phone: true, lastMessage: true }
        });
        const now = new Date();
        const existingByLead = lead
            ? await src_1.prisma.conversation.findFirst({ where: { tenantId, leadId: lead.id } })
            : null;
        const existingByPhone = await src_1.prisma.conversation.findFirst({
            where: { tenantId, phone: resolved },
            orderBy: { updatedAt: "desc" }
        });
        const existing = existingByLead ?? existingByPhone;
        if (existing) {
            await src_1.prisma.conversation.update({
                where: { id: existing.id },
                data: {
                    archivedAt: now,
                    phone: lead?.phone ?? existing.phone
                }
            });
        }
        else if (lead) {
            await src_1.prisma.conversation.create({
                data: {
                    tenantId,
                    phone: lead.phone,
                    leadId: lead.id,
                    state: "open",
                    lastMessage: lead.lastMessage ?? null,
                    archivedAt: now
                }
            });
        }
        else {
            await src_1.prisma.conversation.create({
                data: {
                    tenantId,
                    phone: resolved,
                    state: "open",
                    archivedAt: now
                }
            });
        }
        if (lead) {
            await src_1.prisma.lead.update({
                where: { id: lead.id },
                data: { inboxHiddenAt: now }
            });
        }
        return { ok: true };
    }
    async unarchiveFromInbox(tenantId, phoneParam) {
        const raw = decodeURIComponent(phoneParam).trim();
        const resolved = (await this.resolvePhoneForLead(tenantId, raw)) ?? raw;
        const lead = await src_1.prisma.lead.findFirst({
            where: { tenantId, phone: resolved },
            select: { id: true }
        });
        await src_1.prisma.conversation.updateMany({
            where: { tenantId, phone: resolved },
            data: { archivedAt: null }
        });
        if (lead) {
            await src_1.prisma.conversation.updateMany({
                where: { tenantId, leadId: lead.id },
                data: { archivedAt: null }
            });
            await src_1.prisma.lead.update({
                where: { id: lead.id },
                data: { inboxHiddenAt: null }
            });
        }
        return { ok: true };
    }
    async resolveChat(tenantId, phone) {
        const conversation = await this.getOrCreateConversation(tenantId, phone);
        const updated = await src_1.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: "manual_paused" },
            select: { state: true }
        });
        return { state: updated.state, botPaused: true };
    }
    async reopenChat(tenantId, phone) {
        const conversation = await this.getOrCreateConversation(tenantId, phone);
        const updated = await src_1.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: "open" },
            select: { state: true }
        });
        return { state: updated.state, botPaused: false };
    }
    async closeLead(tenantId, phone) {
        const conversation = await this.getOrCreateConversation(tenantId, phone);
        const lead = await src_1.prisma.lead.findFirst({
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
            await src_1.prisma.$transaction(async (tx) => {
                const rows = (await tx.$queryRaw `
          select id, product_id as "productId", reserved_stock as "reservedStock"
          from public.product_variants
          where tenant_id::text = ${tenantId}
            and id::text = ${lead.productVariantId}
          limit 1
        `);
                const variant = rows[0];
                if (!variant || variant.reservedStock < 1)
                    return;
                const changed = await tx.$executeRaw `
          update public.product_variants
          set reserved_stock = reserved_stock - 1, updated_at = now()
          where id::text = ${variant.id}
            and tenant_id::text = ${tenantId}
            and reserved_stock = ${variant.reservedStock}
        `;
                if (Number(changed) <= 0)
                    return;
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
            await src_1.prisma.lead.update({
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
        const updated = await src_1.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: "lead_closed" },
            select: { state: true }
        });
        return { state: updated.state, botPaused: false, leadClosed: true };
    }
    async manualReply(tenantId, phone, message) {
        const conversation = await this.getOrCreateConversation(tenantId, phone);
        await src_1.prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessage: message }
        });
        const dedupeKey = (0, src_2.buildStableDedupeKey)(tenantId, phone, "manual-reply", message);
        await src_2.outgoingQueue.add("manual-reply-v1", {
            schemaVersion: src_2.JOB_SCHEMA_VERSION,
            correlationId: (0, src_2.buildCorrelationId)(),
            dedupeKey,
            tenantId,
            phone,
            message,
            priority: src_3.OUTGOING_PRIORITY.HIGH,
            metadata: {
                source: "manual"
            }
        }, {
            priority: src_3.OUTGOING_PRIORITY.HIGH,
            attempts: src_3.OUTGOING_ATTEMPTS,
            backoff: { type: "smart" },
            jobId: `manual_${dedupeKey}`
        });
        return { queued: true };
    }
    async listPaymentReviews(tenantId, phone) {
        const resolvedPhone = await this.resolvePhoneForLead(tenantId, phone);
        if (!resolvedPhone)
            return [];
        const lead = await src_1.prisma.lead.findFirst({
            where: { tenantId, phone: resolvedPhone },
            orderBy: { updatedAt: "desc" },
            select: { id: true }
        });
        if (!lead)
            return [];
        const rows = (await src_1.prisma.$queryRaw `
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
    `);
        const mapped = rows.map((row) => {
            const metadata = typeof row.metadata === "object" && row.metadata !== null ? row.metadata : {};
            const variantAttributes = typeof metadata.variantAttributes === "object" && metadata.variantAttributes !== null
                ? Object.fromEntries(Object.entries(metadata.variantAttributes).map(([key, value]) => [
                    String(key),
                    String(value ?? "").trim()
                ]))
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
        return Promise.all(mapped.map(async (item) => {
            const url = String(item.checkoutUrl ?? item.sandboxCheckoutUrl ?? "").trim();
            const canPreviewManualSend = !item.paymentLinkSentAt &&
                Boolean(url) &&
                (item.status === "draft" || item.status === "pending");
            if (!canPreviewManualSend) {
                return { ...item, outboundMessagePreview: null };
            }
            const productLabel = String(item.productName ?? item.title ?? "tu compra").trim();
            const outboundMessagePreview = await this.renderPaymentLinkGeneratedMessage(tenantId, productLabel, url);
            return { ...item, outboundMessagePreview };
        }));
    }
    /**
     * Genera en Mercado Pago el borrador (`payment_attempts` = draft) para revisión/envío manual.
     * Útil cuando el bot respondió con derivación pero no llegó a crear la preferencia.
     */
    async prepareDraftPaymentLink(tenantId, phone) {
        const resolvedPhone = await this.resolvePhoneForLead(tenantId, phone);
        if (!resolvedPhone)
            throw new common_1.NotFoundException("No encontramos un lead para este contacto.");
        const lead = await src_1.prisma.lead.findFirst({
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
        if (!lead)
            throw new common_1.NotFoundException("No encontramos un lead para este contacto.");
        if (!lead.productVariantId) {
            throw new common_1.BadRequestException("El lead no tiene variante de producto; no se puede armar el cobro.");
        }
        const existingOpenAttempt = (await src_1.prisma.$queryRaw `
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
    `);
        const draftRow = existingOpenAttempt[0];
        const existingUrl = String(draftRow?.checkoutUrl ?? draftRow?.sandboxCheckoutUrl ?? "").trim();
        if (draftRow && existingUrl) {
            return { paymentAttemptId: draftRow.id, checkoutUrl: existingUrl, reusedExisting: true };
        }
        const variantRows = (await src_1.prisma.$queryRaw `
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
    `);
        const vr = variantRows[0];
        if (!vr) {
            throw new common_1.BadRequestException("No se encontró la variante de producto en catálogo.");
        }
        const unit = this.coerceUnitPrice(vr.effectivePrice);
        if (!Number.isFinite(unit) || unit <= 0) {
            throw new common_1.BadRequestException("La variante no tiene precio válido; cargalo en stock o catálogo.");
        }
        const attrs = (vr.attributes ?? {});
        const attrBits = Object.entries(attrs)
            .filter(([, v]) => String(v ?? "").trim().length > 0)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
        const title = `${vr.productName}${attrBits ? ` — ${attrBits}` : ""}`;
        const variantAttributes = typeof lead.productVariantAttributes === "object" && lead.productVariantAttributes !== null
            ? Object.fromEntries(Object.entries(lead.productVariantAttributes).map(([k, v]) => [
                String(k),
                String(v ?? "").trim()
            ]))
            : Object.fromEntries(Object.entries(attrs).map(([k, v]) => [String(k), String(v ?? "").trim()]));
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
    async sendPreparedPaymentLink(tenantId, phone, attemptId) {
        const resolvedPhone = await this.resolvePhoneForLead(tenantId, phone);
        if (!resolvedPhone)
            throw new Error("Lead no encontrado para esta conversación.");
        const lead = await src_1.prisma.lead.findFirst({
            where: { tenantId, phone: resolvedPhone },
            orderBy: { updatedAt: "desc" },
            select: { id: true }
        });
        if (!lead)
            throw new Error("Lead no encontrado para esta conversación.");
        const rows = (await src_1.prisma.$queryRaw `
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
    `);
        const attempt = rows[0];
        if (!attempt)
            throw new Error("No encontramos ese link de pago para esta conversación.");
        const checkoutUrl = String(attempt.checkoutUrl ?? attempt.sandboxCheckoutUrl ?? "").trim();
        if (!checkoutUrl)
            throw new Error("El intento de pago no tiene URL de checkout disponible.");
        const metadata = typeof attempt.metadata === "object" && attempt.metadata !== null ? attempt.metadata : {};
        const productName = String(metadata.productName ?? attempt.title ?? "tu compra").trim();
        const message = await this.renderPaymentLinkGeneratedMessage(tenantId, productName, checkoutUrl);
        const conversation = await this.getOrCreateConversation(tenantId, resolvedPhone);
        await src_1.prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessage: message }
        });
        const dedupeKey = (0, src_2.buildStableDedupeKey)(tenantId, resolvedPhone, "manual-payment-link", attempt.id, checkoutUrl);
        await src_2.outgoingQueue.add("manual-payment-link-v1", {
            schemaVersion: src_2.JOB_SCHEMA_VERSION,
            correlationId: (0, src_2.buildCorrelationId)(),
            dedupeKey,
            tenantId,
            phone: resolvedPhone,
            message,
            priority: src_3.OUTGOING_PRIORITY.HIGH,
            metadata: {
                source: "manual",
                nextBestAction: "share_payment_link"
            }
        }, {
            priority: src_3.OUTGOING_PRIORITY.HIGH,
            attempts: src_3.OUTGOING_ATTEMPTS,
            backoff: { type: "smart" },
            jobId: `manual_payment_${dedupeKey}`
        });
        await src_1.prisma.$executeRaw `
      update public.payment_attempts
      set
        status = 'link_generated'::payment_attempt_status,
        payment_link_sent_at = coalesce(payment_link_sent_at, now()),
        updated_at = now()
      where id::text = ${attempt.id}
    `;
        return { queued: true, attemptId: attempt.id };
    }
    async handoffAssistive(tenantId, phone, reason) {
        const conversation = await this.getOrCreateConversation(tenantId, phone);
        const recentMessages = await src_1.prisma.message.findMany({
            where: { tenantId, phone },
            orderBy: { createdAt: "desc" },
            take: 8,
            select: { direction: true, message: true }
        });
        const lastIncoming = recentMessages.find((msg) => msg.direction === "incoming")
            ?.message ?? "";
        const lastOutgoing = recentMessages.find((msg) => msg.direction === "outgoing")
            ?.message ?? "";
        const summary = [
            `Motivo de derivación: ${reason.trim() || "confianza baja del asistente"}.`,
            `Último mensaje cliente: ${lastIncoming || "n/a"}.`,
            `Última respuesta bot: ${lastOutgoing || "n/a"}.`
        ].join(" ");
        const updated = await src_1.prisma.conversation.update({
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
};
exports.ConversationsService = ConversationsService;
exports.ConversationsService = ConversationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mercado_pago_service_1.MercadoPagoService])
], ConversationsService);
