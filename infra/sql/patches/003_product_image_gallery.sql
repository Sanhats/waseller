-- Galería de imágenes: múltiples fotos por producto y por variante.
-- Ejecutar en Supabase SQL editor si `prisma db push` no está disponible.

alter table public.products
  add column if not exists image_urls text[] not null default '{}';

alter table public.product_variants
  add column if not exists image_urls text[] not null default '{}';

