"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TiendaConfigService = void 0;
const db_1 = require("@waseller/db");
const shared_1 = require("@waseller/shared");
class TiendaConfigService {
    async getConfig(tenantId) {
        const rows = await db_1.prisma.$queryRaw `
      SELECT config FROM tenant_store_configs WHERE tenant_id = ${tenantId}::uuid LIMIT 1
    `;
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row?.config)
            return (0, shared_1.normalizeStoreConfig)({});
        return (0, shared_1.normalizeStoreConfig)(row.config);
    }
    async upsertConfig(tenantId, incoming) {
        const normalized = (0, shared_1.normalizeStoreConfig)(incoming);
        const json = JSON.stringify(normalized);
        await db_1.prisma.$executeRaw `
      INSERT INTO tenant_store_configs (tenant_id, config, updated_at)
      VALUES (${tenantId}::uuid, ${json}::jsonb, NOW())
      ON CONFLICT (tenant_id)
      DO UPDATE SET config = ${json}::jsonb, updated_at = NOW()
    `;
        return normalized;
    }
}
exports.TiendaConfigService = TiendaConfigService;
