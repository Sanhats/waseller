-- Vínculo N:N variante ↔ categoría (además de producto ↔ categoría).
create table if not exists public.variant_categories (
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (variant_id, category_id)
);

create index if not exists idx_variant_categories_category on public.variant_categories (category_id);
