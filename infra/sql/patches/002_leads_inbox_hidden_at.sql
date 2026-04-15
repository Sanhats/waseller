-- Ocultar leads de Clientes / Conversaciones sin borrar filas.
-- Ejecutar en Supabase SQL editor si `prisma db push` no está disponible.

alter table public.leads add column if not exists inbox_hidden_at timestamptz;
