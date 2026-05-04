-- 012_tenant_style_profile.sql
-- Perfil de estilo de escritura del tenant. Agregados sobre los mensajes
-- outgoing del propio tenant (y, eventualmente, exports importados de
-- WhatsApp). Se inyecta en el system prompt del copiloto para que el
-- borrador suene como el vendedor real.

CREATE TABLE IF NOT EXISTS tenant_style_profiles (
  tenant_id          UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  avg_length         INTEGER NOT NULL DEFAULT 0,
  emoji_density      DOUBLE PRECISION NOT NULL DEFAULT 0,
  formality          TEXT NOT NULL DEFAULT 'unknown',
  top_greetings      JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_closings       JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_emojis         JSONB NOT NULL DEFAULT '[]'::jsonb,
  catchphrases       JSONB NOT NULL DEFAULT '[]'::jsonb,
  uses_abbreviations BOOLEAN NOT NULL DEFAULT false,
  sample_count       INTEGER NOT NULL DEFAULT 0,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
