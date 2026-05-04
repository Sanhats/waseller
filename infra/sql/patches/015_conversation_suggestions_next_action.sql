-- 015_conversation_suggestions_next_action.sql
-- Extiende conversation_suggestions con la acción comercial sugerida al
-- vendedor (`next_seller_action`), su urgencia, motivo y, opcionalmente, el
-- nuevo lead_status que el copiloto recomienda mover. Convierte al copiloto
-- de "redactor de respuestas" a asistente de gestión de pipeline.

ALTER TABLE conversation_suggestions
  ADD COLUMN IF NOT EXISTS next_seller_action    TEXT,
  ADD COLUMN IF NOT EXISTS action_reason         TEXT,
  ADD COLUMN IF NOT EXISTS action_urgency        TEXT,
  ADD COLUMN IF NOT EXISTS suggested_lead_status TEXT;

CREATE INDEX IF NOT EXISTS conversation_suggestions_tenant_action_idx
  ON conversation_suggestions (tenant_id, next_seller_action)
  WHERE status = 'fresh';

CREATE INDEX IF NOT EXISTS conversation_suggestions_tenant_urgency_idx
  ON conversation_suggestions (tenant_id, action_urgency)
  WHERE status = 'fresh';
