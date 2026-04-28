import { prisma } from "@waseller/db";
import { normalizeStoreConfig, type StoreConfig } from "@waseller/shared";

export class TiendaConfigService {
  async getConfig(tenantId: string): Promise<StoreConfig> {
    const rows = await (prisma as any).$queryRaw`
      SELECT config FROM tenant_store_configs WHERE tenant_id = ${tenantId}::uuid LIMIT 1
    `;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.config) return normalizeStoreConfig({});
    return normalizeStoreConfig(row.config);
  }

  async upsertConfig(tenantId: string, incoming: unknown): Promise<StoreConfig> {
    const normalized = normalizeStoreConfig(incoming);
    const json = JSON.stringify(normalized);
    await (prisma as any).$executeRaw`
      INSERT INTO tenant_store_configs (tenant_id, config, updated_at)
      VALUES (${tenantId}::uuid, ${json}::jsonb, NOW())
      ON CONFLICT (tenant_id)
      DO UPDATE SET config = ${json}::jsonb, updated_at = NOW()
    `;
    return normalized;
  }
}
