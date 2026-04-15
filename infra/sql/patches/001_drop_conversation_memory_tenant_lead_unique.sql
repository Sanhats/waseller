-- Parche para BDs creadas con supabase-init.sql antiguo (unique tenant_id+lead_id en la tabla).
-- Prisma espera solo UNIQUE(lead_id) + índices; sin esto `prisma db push` puede fallar con:
--   cannot drop index conversation_memory_tenant_id_lead_id_key because constraint ... requires it
--
-- Ejecutá este script UNA VEZ en el SQL editor de Supabase (o psql) antes de volver a correr `npm run db:push`.

alter table public.conversation_memory
  drop constraint if exists conversation_memory_tenant_id_lead_id_key;
