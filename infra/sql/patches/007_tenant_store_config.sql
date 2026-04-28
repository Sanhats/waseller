-- Configuración visual de la tienda pública por tenant
CREATE TABLE IF NOT EXISTS tenant_store_configs (
  tenant_id  UUID        NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  config     JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
