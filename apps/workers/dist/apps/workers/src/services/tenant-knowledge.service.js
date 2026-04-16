"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantKnowledgeService = void 0;
const src_1 = require("../../../../packages/db/src");
const src_2 = require("../../../../packages/shared/src");
const CACHE_MS = Math.max(5_000, Number(process.env.TENANT_KNOWLEDGE_CACHE_MS ?? 60_000));
class TenantKnowledgeService {
    cache = new Map();
    resolveRulePack(profile) {
        const base = {
            category: profile.businessCategory,
            preferredIntents: ["buscar_producto", "consultar_precio", "aceptar_oferta", "pedir_link_pago"],
            forbiddenActions: [],
            requiredAxes: profile.productVariantAxes
        };
        if (profile.businessCategory === "electronica") {
            return {
                ...base,
                preferredIntents: [...base.preferredIntents, "consultar_garantia", "consultar_financiacion"],
                forbiddenActions: profile.payment.methods.includes("link_pago") ? [] : ["share_payment_link"]
            };
        }
        if (profile.businessCategory === "indumentaria_calzado") {
            return {
                ...base,
                preferredIntents: [...base.preferredIntents, "consultar_talle", "consultar_color"],
                requiredAxes: ["talle", "color", ...profile.productVariantAxes.filter((axis) => axis !== "talle" && axis !== "color")]
            };
        }
        return base;
    }
    async get(tenantId) {
        const now = Date.now();
        const cached = this.cache.get(tenantId);
        if (cached && cached.expiresAt > now)
            return cached.value;
        try {
            const rows = (await src_1.prisma.$queryRaw `
        select profile, business_category as "businessCategory", business_labels as "businessLabels"
        from public.tenant_knowledge
        where tenant_id::text = ${tenantId}
        limit 1
      `);
            const profile = rows[0]?.profile;
            const value = (0, src_2.normalizeTenantBusinessProfile)({
                ...(profile && typeof profile === "object" ? profile : {}),
                businessCategory: rows[0]?.businessCategory,
                businessLabels: rows[0]?.businessLabels
            });
            const tenant = await src_1.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { name: true }
            });
            const tenantName = String(tenant?.name ?? "").trim();
            const merged = {
                ...value,
                businessName: value.businessName?.trim() || tenantName || undefined
            };
            this.cache.set(tenantId, { expiresAt: now + CACHE_MS, value: merged });
            return merged;
        }
        catch {
            const tenant = await src_1.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { name: true }
            });
            const tenantName = String(tenant?.name ?? "").trim();
            const fallback = (0, src_2.normalizeTenantBusinessProfile)({
                businessName: tenantName || undefined
            });
            this.cache.set(tenantId, { expiresAt: now + CACHE_MS, value: fallback });
            return fallback;
        }
    }
    async getWithRulePack(tenantId) {
        const profile = await this.get(tenantId);
        return {
            profile,
            rulePack: this.resolveRulePack(profile)
        };
    }
}
exports.TenantKnowledgeService = TenantKnowledgeService;
