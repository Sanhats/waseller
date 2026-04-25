-- Categorías jerárquicas por tenant y vínculo N:N producto ↔ categoría.
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  parent_id uuid references public.categories(id) on delete restrict,
  name text not null,
  slug text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index if not exists idx_categories_tenant_parent on public.categories (tenant_id, parent_id);
create index if not exists idx_categories_tenant_active on public.categories (tenant_id, is_active);

create table if not exists public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (product_id, category_id)
);

create index if not exists idx_product_categories_category on public.product_categories (category_id);
