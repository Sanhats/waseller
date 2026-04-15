-- =============================================================================
-- RESETEO DE DATOS DE APLICACIÓN (Postgres / Supabase)
-- =============================================================================
-- Borra TODO el contenido de negocio: tenants, usuarios, leads, mensajes,
-- pagos, stock, trazas LLM, etc. Deja el esquema y las migraciones Prisma.
--
-- NO ejecutes en producción sin backup. Ejecutá en SQL Editor de Supabase
-- (o psql) conectado a la base correcta.
--
-- Redis / colas (BullMQ): esto NO limpia Upstash. Si querés colas vacías,
-- borrá las keys del Redis o usá FLUSHDB en un entorno dedicado (¡nunca
-- compartido con otros proyectos sin confirmar!).
-- =============================================================================

BEGIN;

TRUNCATE TABLE
  "payment_attempts",
  "tenant_payment_integrations",
  "human_feedback",
  "lead_score_events",
  "llm_traces",
  "conversation_memory",
  "messages",
  "conversations",
  "stock_movements",
  "product_variants",
  "products",
  "eval_dataset_items",
  "bot_response_events",
  "bot_playbooks",
  "app_users",
  "leads",
  "tenant_knowledge",
  "tenants"
RESTART IDENTITY CASCADE;

COMMIT;

-- Verificación rápida (deberían dar 0):
-- SELECT COUNT(*) FROM tenants;
-- SELECT COUNT(*) FROM app_users;
