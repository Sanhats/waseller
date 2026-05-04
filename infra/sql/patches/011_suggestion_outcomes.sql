-- 011_suggestion_outcomes.sql
-- Captura del delta entre el borrador sugerido por el copiloto y el mensaje
-- que el vendedor humano efectivamente envió. Es la base del loop de
-- aprendizaje: sin estos datos no podemos medir aceptación ni mejorar el
-- prompt/estilo per-tenant.

CREATE TABLE IF NOT EXISTS suggestion_outcomes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  suggestion_id      UUID REFERENCES conversation_suggestions(id) ON DELETE SET NULL,
  draft_reply        TEXT,
  sent_message       TEXT NOT NULL,
  draft_was_offered  BOOLEAN NOT NULL DEFAULT false,
  used_as_is         BOOLEAN NOT NULL DEFAULT false,
  edit_distance      INTEGER NOT NULL DEFAULT 0,
  tokens_added       INTEGER NOT NULL DEFAULT 0,
  tokens_removed     INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suggestion_outcomes_tenant_id_created_at_idx
  ON suggestion_outcomes (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS suggestion_outcomes_conversation_id_created_at_idx
  ON suggestion_outcomes (conversation_id, created_at DESC);
