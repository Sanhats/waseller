-- 014_conversation_turn_examples_source.sql
-- Trazabilidad del origen de cada turno indexado: 'real' (conversaciones que
-- terminaron en venta), 'imported' (subidas vía importador WhatsApp con flag
-- de venta), 'synthetic' (generadas por GPT-4 para cold start).
-- Nos permite priorizar reales sobre sintéticos en el retrieval, y borrar
-- sintéticos cuando hay suficiente data real.

ALTER TABLE conversation_turn_examples
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'real',
  ADD COLUMN IF NOT EXISTS segment TEXT,
  ADD COLUMN IF NOT EXISTS scenario TEXT;

CREATE INDEX IF NOT EXISTS conversation_turn_examples_tenant_source_idx
  ON conversation_turn_examples (tenant_id, source);
