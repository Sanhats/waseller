-- 013_conversation_turn_examples.sql
-- RAG: indexamos turnos (incoming → outgoing) de conversaciones que terminaron
-- en venta para usarlos como few-shot examples en el copiloto.
-- Requiere extensión pgvector (Supabase la soporta nativa).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS conversation_turn_examples (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL,
  incoming_text    TEXT NOT NULL,
  outgoing_text    TEXT NOT NULL,
  product_name     TEXT,
  intent_hint      TEXT,
  lead_stage       TEXT,
  embedding_model  TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedding        vector(1536),
  indexed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_turn_examples_tenant_indexed_at_idx
  ON conversation_turn_examples (tenant_id, indexed_at DESC);

CREATE INDEX IF NOT EXISTS conversation_turn_examples_conversation_id_idx
  ON conversation_turn_examples (conversation_id);

-- ivfflat para búsqueda aproximada (cosine). lists=100 es razonable para hasta ~1M filas;
-- ajustar después si crece. ANALYZE necesario antes de buscar para que use el índice.
CREATE INDEX IF NOT EXISTS conversation_turn_examples_embedding_cosine_idx
  ON conversation_turn_examples
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
