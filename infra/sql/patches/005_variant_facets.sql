-- Facetas de variante indexadas para filtros (talle, color, marca/modelo).
-- Se mantienen en sync con `attributes` JSON desde la aplicación; este script crea columnas y backfill inicial.

alter table public.product_variants
  add column if not exists variant_talle varchar(160),
  add column if not exists variant_color varchar(160),
  add column if not exists variant_marca varchar(200);

create index if not exists idx_product_variants_tenant_talle
  on public.product_variants (tenant_id, variant_talle)
  where variant_talle is not null and trim(variant_talle) <> '';

create index if not exists idx_product_variants_tenant_color
  on public.product_variants (tenant_id, variant_color)
  where variant_color is not null and trim(variant_color) <> '';

create index if not exists idx_product_variants_tenant_marca
  on public.product_variants (tenant_id, variant_marca)
  where variant_marca is not null and trim(variant_marca) <> '';

update public.product_variants v
set
  variant_talle = coalesce(
    nullif(trim(v.variant_talle), ''),
    nullif(trim(v.attributes ->> 'talle'), ''),
    nullif(trim(v.attributes ->> 'talla'), '')
  ),
  variant_color = coalesce(
    nullif(trim(v.variant_color), ''),
    nullif(trim(v.attributes ->> 'color'), '')
  ),
  variant_marca = coalesce(
    nullif(trim(v.variant_marca), ''),
    nullif(trim(v.attributes ->> 'marca'), ''),
    nullif(trim(v.attributes ->> 'modelo'), '')
  )
where true;
