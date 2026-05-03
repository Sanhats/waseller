-- 010_conversation_suggestions.sql
-- Crea la tabla conversation_suggestions usada por el pipeline copiloto:
-- el bot deja de auto-responder y persiste sugerencias (intent + lead status +
-- productos recomendados + borrador de respuesta) para que el humano las use
-- desde el dashboard.

CREATE TABLE IF NOT EXISTS conversation_suggestions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id       UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  trigger_message_id    UUID,
  trigger               TEXT NOT NULL,
  intent                TEXT,
  lead_score            INTEGER,
  lead_status           TEXT,
  reasoning             JSONB,
  recommended_variants  JSONB,
  draft_reply           TEXT,
  summary_for_seller    TEXT,
  status                TEXT NOT NULL DEFAULT 'fresh',
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at               TIMESTAMPTZ,
  llm_model             TEXT,
  llm_latency_ms        INTEGER,
  llm_tokens_in         INTEGER,
  llm_tokens_out        INTEGER
);

CREATE INDEX IF NOT EXISTS conversation_suggestions_conversation_id_generated_at_idx
  ON conversation_suggestions (conversation_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_suggestions_tenant_id_status_idx
  ON conversation_suggestions (tenant_id, status);
