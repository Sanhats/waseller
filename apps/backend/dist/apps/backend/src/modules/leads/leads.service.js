"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadsService = void 0;
const common_1 = require("@nestjs/common");
const src_1 = require("../../../../../packages/db/src");
const src_2 = require("../../../../../packages/shared/src");
let LeadsService = class LeadsService {
    async listByTenant(tenantId, includeClosed = false, includeArchived = false, includeHiddenFromInbox = false, includeOrphanConversations = false) {
        const [leads, conversations, memories, allTenantLeadPhones] = await Promise.all([
            src_1.prisma.lead.findMany({
                where: {
                    tenantId,
                    ...(includeHiddenFromInbox ? {} : { inboxHiddenAt: null })
                },
                orderBy: [{ score: "desc" }, { updatedAt: "desc" }]
            }),
            src_1.prisma.conversation.findMany({
                where: { tenantId },
                orderBy: { updatedAt: "desc" },
                select: {
                    id: true,
                    phone: true,
                    state: true,
                    archivedAt: true,
                    lastMessage: true,
                    updatedAt: true
                }
            }),
            src_1.prisma.conversationMemory.findMany({
                where: { tenantId },
                select: { leadId: true, facts: true }
            }),
            includeOrphanConversations
                ? src_1.prisma.lead.findMany({
                    where: {
                        tenantId,
                        ...(includeHiddenFromInbox ? {} : { inboxHiddenAt: null })
                    },
                    select: { phone: true }
                })
                : Promise.resolve([])
        ]);
        /** Estado de conversación indexado por teléfono tal cual y por solo-dígitos (evita desalineación lead↔conversación). */
        const conversationStateByPhone = new Map();
        const registerConvoStateKeys = (phone, state) => {
            const raw = String(phone ?? "").trim();
            if (raw && !conversationStateByPhone.has(raw)) {
                conversationStateByPhone.set(raw, state);
            }
            const d = (0, src_2.digitsOnlyPhone)(raw);
            if (d.length >= 8 && !conversationStateByPhone.has(d)) {
                conversationStateByPhone.set(d, state);
            }
        };
        for (const convo of conversations) {
            registerConvoStateKeys(convo.phone, convo.state);
        }
        const conversationStateForLeadPhone = (leadPhone) => {
            const s = String(leadPhone ?? "").trim();
            return conversationStateByPhone.get(s) ?? conversationStateByPhone.get((0, src_2.digitsOnlyPhone)(s));
        };
        const conversationStageByLeadId = new Map();
        for (const row of memories) {
            const facts = row.facts;
            const stage = facts && typeof facts.conversationStage === "string" ? facts.conversationStage : null;
            if (stage)
                conversationStageByLeadId.set(row.leadId, stage);
        }
        const archivedPhones = conversations
            .filter((c) => c.archivedAt != null)
            .map((c) => c.phone);
        const leadIsArchived = (leadPhone) => {
            const ld = (0, src_2.digitsOnlyPhone)(leadPhone);
            if (!ld)
                return false;
            return archivedPhones.some((p) => (0, src_2.digitsOnlyPhone)(p) === ld);
        };
        const mappedLeads = leads
            .filter((lead) => {
            const digits = (0, src_2.digitsOnlyPhone)(String(lead.phone ?? ""));
            const validPhone = digits.length >= 8 && digits.length <= 18;
            const isClosed = conversationStateForLeadPhone(String(lead.phone ?? "")) === "lead_closed";
            const visibleByScope = includeClosed ? true : !isClosed;
            const hideArchived = !includeArchived && leadIsArchived(String(lead.phone ?? ""));
            return validPhone && visibleByScope && !hideArchived;
        })
            .map((lead) => {
            const isClosed = conversationStateForLeadPhone(String(lead.phone ?? "")) === "lead_closed";
            const conversationState = conversationStateForLeadPhone(String(lead.phone ?? "")) ?? "open";
            const conversationStage = conversationStageByLeadId.get(lead.id) ?? null;
            return {
                ...lead,
                leadClosed: isClosed,
                conversationState,
                conversationStage
            };
        });
        if (!includeOrphanConversations) {
            return mappedLeads;
        }
        const leadPhonesNormAll = new Set();
        for (const row of allTenantLeadPhones) {
            const d = (0, src_2.digitsOnlyPhone)(row.phone);
            if (d.length >= 8)
                leadPhonesNormAll.add(d);
        }
        const seenNorm = new Set(mappedLeads.map((row) => (0, src_2.digitsOnlyPhone)(String(row.phone ?? ""))));
        const orphans = [];
        for (const c of conversations) {
            const d = (0, src_2.digitsOnlyPhone)(c.phone);
            if (d.length < 8 || d.length > 18)
                continue;
            if (leadPhonesNormAll.has(d))
                continue;
            if (seenNorm.has(d))
                continue;
            const archived = c.archivedAt != null;
            if (!includeArchived && archived)
                continue;
            const closed = c.state === "lead_closed";
            if (!includeClosed && closed)
                continue;
            seenNorm.add(d);
            orphans.push({
                id: `orphan:${c.id}`,
                tenantId,
                phone: c.phone,
                customerName: null,
                product: null,
                productVariantId: null,
                productVariantAttributes: null,
                status: "frio",
                score: 0,
                hasStockReservation: false,
                reservationExpiresAt: null,
                profilePictureUrl: null,
                inboxHiddenAt: null,
                lastMessage: c.lastMessage,
                createdAt: c.updatedAt,
                updatedAt: c.updatedAt,
                leadClosed: closed,
                conversationState: c.state ?? "open",
                conversationStage: null,
                conversationOnly: true
            });
        }
        return [...mappedLeads, ...orphans];
    }
    /**
     * Oculta el lead de Clientes y Conversaciones (bandeja). No borra mensajes ni el lead.
     * También marca conversaciones como archivadas por teléfono / leadId.
     */
    async hideFromInbox(tenantId, leadId) {
        const lead = await src_1.prisma.lead.findFirst({
            where: { id: leadId, tenantId },
            select: { id: true, phone: true }
        });
        if (!lead)
            return null;
        const now = new Date();
        await src_1.prisma.lead.update({
            where: { id: lead.id },
            data: { inboxHiddenAt: now }
        });
        await src_1.prisma.conversation.updateMany({
            where: { tenantId, phone: lead.phone },
            data: { archivedAt: now }
        });
        await src_1.prisma.conversation.updateMany({
            where: { tenantId, leadId: lead.id },
            data: { archivedAt: now }
        });
        return { ok: true };
    }
    async restoreToInbox(tenantId, leadId) {
        const lead = await src_1.prisma.lead.findFirst({
            where: { id: leadId, tenantId },
            select: { id: true, phone: true }
        });
        if (!lead)
            return null;
        await src_1.prisma.lead.update({
            where: { id: lead.id },
            data: { inboxHiddenAt: null }
        });
        await src_1.prisma.conversation.updateMany({
            where: { tenantId, phone: lead.phone },
            data: { archivedAt: null }
        });
        await src_1.prisma.conversation.updateMany({
            where: { tenantId, leadId: lead.id },
            data: { archivedAt: null }
        });
        return { ok: true };
    }
    async markAs(tenantId, id, status) {
        const current = await src_1.prisma.lead.findFirst({
            where: { id, tenantId },
            select: {
                id: true,
                phone: true,
                status: true,
                product: true,
                productVariantId: true,
                hasStockReservation: true
            }
        });
        if (!current)
            return null;
        await src_1.prisma.lead.updateMany({
            where: { id, tenantId },
            data: {
                status,
                hasStockReservation: status === "vendido" ? false : current.hasStockReservation,
                reservationExpiresAt: status === "vendido" ? null : undefined
            }
        });
        const conversation = await src_1.prisma.conversation.findFirst({
            where: { tenantId, phone: current.phone },
            orderBy: { updatedAt: "desc" },
            select: { id: true }
        });
        if (conversation) {
            await src_1.prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    state: status === "vendido" ? "lead_closed" : "open"
                }
            });
        }
        if (current.productVariantId) {
            if (status === "vendido") {
                await src_1.prisma.$transaction(async (tx) => {
                    const rows = (await tx.$queryRaw `
            select id, product_id as "productId", stock, reserved_stock as "reservedStock"
            from public.product_variants
            where tenant_id::text = ${tenantId}
              and id::text = ${current.productVariantId}
            limit 1
          `);
                    const variant = rows[0];
                    if (!variant)
                        return;
                    if (variant.stock < 1 || variant.reservedStock < 1)
                        return;
                    const updated = await tx.$executeRaw `
            update public.product_variants
            set stock = stock - 1, reserved_stock = reserved_stock - 1, updated_at = now()
            where id::text = ${variant.id}
              and tenant_id::text = ${tenantId}
              and stock = ${variant.stock}
              and reserved_stock = ${variant.reservedStock}
          `;
                    if (Number(updated) > 0) {
                        await tx.stockMovement.create({
                            data: {
                                tenantId,
                                productId: variant.productId,
                                variantId: variant.id,
                                movementType: "commit",
                                deltaStock: -1,
                                deltaReserved: -1,
                                reason: "lead_marked_vendido",
                                source: "api_leads",
                                leadId: current.id,
                                phone: current.phone
                            }
                        });
                    }
                });
            }
            else if (current.status === "listo_para_cobrar" || current.hasStockReservation) {
                await src_1.prisma.$transaction(async (tx) => {
                    const rows = (await tx.$queryRaw `
            select id, product_id as "productId", reserved_stock as "reservedStock"
            from public.product_variants
            where tenant_id::text = ${tenantId}
              and id::text = ${current.productVariantId}
            limit 1
          `);
                    const variant = rows[0];
                    if (!variant)
                        return;
                    if (variant.reservedStock < 1)
                        return;
                    const updated = await tx.$executeRaw `
            update public.product_variants
            set reserved_stock = reserved_stock - 1, updated_at = now()
            where id::text = ${variant.id}
              and tenant_id::text = ${tenantId}
              and reserved_stock = ${variant.reservedStock}
          `;
                    if (Number(updated) > 0) {
                        await tx.stockMovement.create({
                            data: {
                                tenantId,
                                productId: variant.productId,
                                variantId: variant.id,
                                movementType: "release",
                                deltaStock: 0,
                                deltaReserved: -1,
                                reason: "lead_status_changed",
                                source: "api_leads",
                                leadId: current.id,
                                phone: current.phone
                            }
                        });
                        await tx.lead.updateMany({
                            where: { id, tenantId },
                            data: { hasStockReservation: false, reservationExpiresAt: null }
                        });
                    }
                });
            }
        }
        return src_1.prisma.lead.findUnique({
            where: { id }
        });
    }
    async releaseReservation(tenantId, id) {
        const current = await src_1.prisma.lead.findFirst({
            where: { id, tenantId },
            select: { id: true, phone: true, product: true, productVariantId: true, hasStockReservation: true }
        });
        if (!current?.productVariantId)
            return { released: false };
        const updated = await src_1.prisma.$transaction(async (tx) => {
            const rows = (await tx.$queryRaw `
        select id, product_id as "productId", reserved_stock as "reservedStock"
        from public.product_variants
        where tenant_id::text = ${tenantId}
          and id::text = ${current.productVariantId}
        limit 1
      `);
            const variant = rows[0];
            if (!variant)
                return 0;
            if (variant.reservedStock < 1)
                return 0;
            const result = await tx.$executeRaw `
        update public.product_variants
        set reserved_stock = reserved_stock - 1, updated_at = now()
        where id::text = ${variant.id}
          and tenant_id::text = ${tenantId}
          and reserved_stock = ${variant.reservedStock}
      `;
            if (Number(result) > 0) {
                await tx.stockMovement.create({
                    data: {
                        tenantId,
                        productId: variant.productId,
                        variantId: variant.id,
                        movementType: "release",
                        deltaStock: 0,
                        deltaReserved: -1,
                        reason: "manual_release_reservation",
                        source: "api_leads",
                        leadId: current.id,
                        phone: current.phone
                    }
                });
                await tx.lead.updateMany({
                    where: { id, tenantId },
                    data: {
                        hasStockReservation: false,
                        reservationExpiresAt: null
                    }
                });
            }
            return Number(result);
        });
        return { released: updated > 0 };
    }
};
exports.LeadsService = LeadsService;
exports.LeadsService = LeadsService = __decorate([
    (0, common_1.Injectable)()
], LeadsService);
