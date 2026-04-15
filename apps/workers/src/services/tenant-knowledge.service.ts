import { prisma } from "../../../../packages/db/src";
import { BusinessCategory, TenantBusinessProfile, normalizeTenantBusinessProfile } from "../../../../packages/shared/src";

const CACHE_MS = Math.max(5_000, Number(process.env.TENANT_KNOWLEDGE_CACHE_MS ?? 60_000));

export type RubroRulePack = {
  category: BusinessCategory;
  preferredIntents: string[];
  forbiddenActions: Array<"share_payment_link" | "reserve_stock" | "close_lead">;
  requiredAxes: string[];
};

export class TenantKnowledgeService {
  private cache = new Map<string, { expiresAt: number; value: TenantBusinessProfile }>();

  private resolveRulePack(profile: TenantBusinessProfile): RubroRulePack {
    const base: RubroRulePack = {
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

  async get(tenantId: string): Promise<TenantBusinessProfile> {
    const now = Date.now();
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > now) return cached.value;

    try {
      const rows = (await (prisma as any).$queryRaw`
        select profile, business_category as "businessCategory", business_labels as "businessLabels"
        from public.tenant_knowledge
        where tenant_id = ${tenantId}::uuid
        limit 1
      `) as Array<{ profile: unknown; businessCategory: string; businessLabels: string[] }>;
      const profile = rows[0]?.profile;
      const value = normalizeTenantBusinessProfile({
        ...(profile && typeof profile === "object" ? (profile as Record<string, unknown>) : {}),
        businessCategory: rows[0]?.businessCategory,
        businessLabels: rows[0]?.businessLabels
      });
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true }
      });
      const tenantName = String(tenant?.name ?? "").trim();
      const merged: TenantBusinessProfile = {
        ...value,
        businessName: value.businessName?.trim() || tenantName || undefined
      };
      this.cache.set(tenantId, { expiresAt: now + CACHE_MS, value: merged });
      return merged;
    } catch {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true }
      });
      const tenantName = String(tenant?.name ?? "").trim();
      const fallback = normalizeTenantBusinessProfile({
        businessName: tenantName || undefined
      });
      this.cache.set(tenantId, { expiresAt: now + CACHE_MS, value: fallback });
      return fallback;
    }
  }

  async getWithRulePack(tenantId: string): Promise<{ profile: TenantBusinessProfile; rulePack: RubroRulePack }> {
    const profile = await this.get(tenantId);
    return {
      profile,
      rulePack: this.resolveRulePack(profile)
    };
  }
}
