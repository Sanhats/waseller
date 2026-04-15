-- Ejecutar este script en Supabase SQL Editor.
-- Crea tipos, tablas, constraints e índices del MVP SaaS multi-tenant.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type lead_status as enum (
      'frio',
      'consulta',
      'interesado',
      'caliente',
      'listo_para_cobrar',
      'vendido',
      'cerrado'
    );
  end if;
end $$;

do $$
begin
  alter type lead_status add value if not exists 'cerrado';
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'message_direction') then
    create type message_direction as enum ('incoming', 'outgoing');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'vendedor', 'viewer');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'stock_movement_type') then
    create type stock_movement_type as enum ('sync', 'reserve', 'release', 'commit', 'manual_adjust');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'score_event_source') then
    create type score_event_source as enum ('rule', 'llm', 'manual', 'import');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'feedback_target_type') then
    create type feedback_target_type as enum ('message', 'llm_trace', 'lead', 'conversation', 'bot_response_event');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'eval_split') then
    create type eval_split as enum ('train', 'val', 'test', 'holdout');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_provider') then
    create type payment_provider as enum ('mercadopago');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_integration_status') then
    create type payment_integration_status as enum ('disconnected', 'connected', 'expired', 'error');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_attempt_status') then
    create type payment_attempt_status as enum (
      'draft',
      'link_generated',
      'pending',
      'approved',
      'rejected',
      'cancelled',
      'expired',
      'error'
    );
  end if;
end $$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  whatsapp_number text not null,
  plan text not null default 'starter',
  sender_rate_ms int not null default 500,
  sender_pause_every int not null default 20,
  sender_pause_ms int not null default 2500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenants add column if not exists sender_rate_ms int not null default 500;
alter table public.tenants add column if not exists sender_pause_every int not null default 20;
alter table public.tenants add column if not exists sender_pause_ms int not null default 2500;
alter table public.tenants add column if not exists llm_assist_enabled boolean not null default false;
alter table public.tenants add column if not exists llm_confidence_threshold double precision not null default 0.72;
alter table public.tenants add column if not exists llm_guardrails_strict boolean not null default true;
alter table public.tenants add column if not exists llm_rollout_percent int not null default 0;
alter table public.tenants add column if not exists llm_model_name text not null default 'self-hosted-default';

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0,
  image_url text,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.products add column if not exists image_url text;

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null,
  attributes jsonb not null default '{}'::jsonb,
  price numeric(10,2),
  stock int not null default 0,
  reserved_stock int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku)
);

alter table public.product_variants add column if not exists attributes jsonb not null default '{}'::jsonb;
alter table public.product_variants add column if not exists price numeric(10,2);
alter table public.product_variants add column if not exists reserved_stock int not null default 0;
alter table public.product_variants add column if not exists is_active boolean not null default true;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  customer_name text,
  product text,
  product_variant_id uuid,
  product_variant_attributes jsonb,
  status lead_status not null default 'frio',
  score int not null default 0,
  has_stock_reservation boolean not null default false,
  reservation_expires_at timestamptz,
  last_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads add column if not exists has_stock_reservation boolean not null default false;
alter table public.leads add column if not exists reservation_expires_at timestamptz;
alter table public.leads add column if not exists customer_name text;
alter table public.leads add column if not exists profile_picture_url text;
alter table public.leads add column if not exists product_variant_id uuid;
alter table public.leads add column if not exists product_variant_attributes jsonb;
alter table public.leads add column if not exists inbox_hidden_at timestamptz;

create index if not exists idx_leads_tenant_phone on public.leads (tenant_id, phone);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  lead_id uuid unique references public.leads(id) on delete set null,
  last_message text,
  state text not null default 'open',
  updated_at timestamptz not null default now()
);

alter table public.conversations add column if not exists archived_at timestamptz;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  message text not null,
  direction message_direction not null,
  external_message_id text,
  correlation_id text,
  dedupe_key text,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists external_message_id text;
alter table public.messages add column if not exists correlation_id text;
alter table public.messages add column if not exists dedupe_key text;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  password_hash text not null,
  role user_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  movement_type stock_movement_type not null,
  delta_stock int not null default 0,
  delta_reserved int not null default 0,
  reason text,
  source text,
  lead_id uuid,
  phone text,
  created_at timestamptz not null default now()
);

alter table public.stock_movements add column if not exists product_id uuid;
alter table public.stock_movements add column if not exists variant_id uuid;

create table if not exists public.bot_playbooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  intent text not null,
  variant text not null,
  template text not null,
  weight int not null default 50,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, intent, variant)
);

create table if not exists public.bot_response_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  template text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table if not exists public.tenant_knowledge (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  business_category text not null default 'general',
  business_labels text[] not null default '{}',
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_knowledge
  add column if not exists business_category text not null default 'general';
alter table public.tenant_knowledge
  add column if not exists business_labels text[] not null default '{}';

create table if not exists public.bot_response_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid,
  phone text not null,
  intent text not null,
  variant text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  schema_version int not null default 1,
  facts jsonb not null default '{}'::jsonb,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.llm_traces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  bot_response_event_id uuid,
  correlation_id text,
  dedupe_key text,
  trace_kind text not null,
  provider text,
  model text,
  request jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  prompt_tokens int,
  completion_tokens int,
  latency_ms int,
  handoff_required boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_score_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  previous_score int not null,
  new_score int not null,
  delta int not null,
  reason text,
  source score_event_source not null default 'rule',
  metadata jsonb,
  related_trace_id uuid references public.llm_traces(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.human_feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  target_type feedback_target_type not null,
  target_id text not null,
  rating int,
  label text,
  comment text,
  app_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.eval_dataset_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  name text not null,
  slug text,
  input jsonb not null default '{}'::jsonb,
  reference jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  split eval_split not null default 'test',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_payment_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider payment_provider not null,
  status payment_integration_status not null default 'disconnected',
  external_account_id text,
  external_account_label text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  public_key text,
  token_type text,
  scope text,
  expires_at timestamptz,
  connected_at timestamptz,
  last_error text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

alter table public.tenant_payment_integrations add column if not exists external_account_id text;
alter table public.tenant_payment_integrations add column if not exists external_account_label text;
alter table public.tenant_payment_integrations add column if not exists access_token_encrypted text;
alter table public.tenant_payment_integrations add column if not exists refresh_token_encrypted text;
alter table public.tenant_payment_integrations add column if not exists public_key text;
alter table public.tenant_payment_integrations add column if not exists token_type text;
alter table public.tenant_payment_integrations add column if not exists scope text;
alter table public.tenant_payment_integrations add column if not exists expires_at timestamptz;
alter table public.tenant_payment_integrations add column if not exists connected_at timestamptz;
alter table public.tenant_payment_integrations add column if not exists last_error text;
alter table public.tenant_payment_integrations add column if not exists metadata jsonb;

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integration_id uuid references public.tenant_payment_integrations(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  product_variant_id uuid references public.product_variants(id) on delete set null,
  provider payment_provider not null,
  status payment_attempt_status not null default 'draft',
  amount numeric(10,2) not null,
  currency text not null default 'ARS',
  title text not null,
  external_reference text not null,
  external_preference_id text,
  external_payment_id text,
  checkout_url text,
  sandbox_checkout_url text,
  payment_link_sent_at timestamptz,
  last_webhook_at timestamptz,
  paid_at timestamptz,
  expires_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_reference)
);

alter table public.payment_attempts add column if not exists integration_id uuid;
alter table public.payment_attempts add column if not exists lead_id uuid;
alter table public.payment_attempts add column if not exists conversation_id uuid;
alter table public.payment_attempts add column if not exists product_variant_id uuid;
alter table public.payment_attempts add column if not exists external_preference_id text;
alter table public.payment_attempts add column if not exists external_payment_id text;
alter table public.payment_attempts add column if not exists checkout_url text;
alter table public.payment_attempts add column if not exists sandbox_checkout_url text;
alter table public.payment_attempts add column if not exists payment_link_sent_at timestamptz;
alter table public.payment_attempts add column if not exists last_webhook_at timestamptz;
alter table public.payment_attempts add column if not exists paid_at timestamptz;
alter table public.payment_attempts add column if not exists expires_at timestamptz;
alter table public.payment_attempts add column if not exists metadata jsonb;

create index if not exists idx_leads_tenant_status_score on public.leads (tenant_id, status, score);
create index if not exists idx_conversations_tenant_phone on public.conversations (tenant_id, phone);
create index if not exists idx_messages_tenant_phone_created on public.messages (tenant_id, phone, created_at);
create index if not exists idx_products_tenant_name on public.products (tenant_id, name);
create index if not exists idx_product_variants_tenant_product_active on public.product_variants (tenant_id, product_id, is_active);
create index if not exists idx_product_variants_tenant_updated on public.product_variants (tenant_id, updated_at);
create index if not exists idx_users_tenant_role_active on public.app_users (tenant_id, role, is_active);
create index if not exists idx_stock_movements_tenant_product_created on public.stock_movements (tenant_id, product_id, created_at);
create index if not exists idx_stock_movements_tenant_variant_created on public.stock_movements (tenant_id, variant_id, created_at);
create index if not exists idx_stock_movements_tenant_type_created on public.stock_movements (tenant_id, movement_type, created_at);
create index if not exists idx_bot_playbooks_tenant_intent_active on public.bot_playbooks (tenant_id, intent, is_active);
create index if not exists idx_bot_response_templates_tenant_key_active on public.bot_response_templates (tenant_id, key, is_active);
create index if not exists idx_tenant_knowledge_updated on public.tenant_knowledge (updated_at);
create index if not exists idx_tenant_knowledge_category on public.tenant_knowledge (business_category);
create index if not exists idx_bot_response_events_tenant_intent_variant_created on public.bot_response_events (tenant_id, intent, variant, created_at);
create index if not exists idx_messages_tenant_dedupe_key on public.messages (tenant_id, dedupe_key);
create index if not exists idx_conversation_memory_tenant_updated on public.conversation_memory (tenant_id, updated_at);
create unique index if not exists conversation_memory_lead_id_key on public.conversation_memory (lead_id);
create unique index if not exists conversation_memory_conversation_id_key on public.conversation_memory (conversation_id);
create index if not exists idx_llm_traces_tenant_created on public.llm_traces (tenant_id, created_at);
create index if not exists idx_llm_traces_tenant_lead_created on public.llm_traces (tenant_id, lead_id, created_at);
create index if not exists idx_llm_traces_conversation_created on public.llm_traces (conversation_id, created_at);
create index if not exists idx_lead_score_events_tenant_lead_created on public.lead_score_events (tenant_id, lead_id, created_at);
create index if not exists idx_human_feedback_tenant_target on public.human_feedback (tenant_id, target_type, target_id);
create index if not exists idx_human_feedback_tenant_created on public.human_feedback (tenant_id, created_at);
create index if not exists idx_eval_dataset_tenant_split_active on public.eval_dataset_items (tenant_id, split, is_active);
create index if not exists idx_payment_integrations_tenant_status on public.tenant_payment_integrations (tenant_id, status);
create index if not exists idx_payment_integrations_provider_account on public.tenant_payment_integrations (provider, external_account_id);
create index if not exists idx_payment_attempts_tenant_status_created on public.payment_attempts (tenant_id, status, created_at);
create index if not exists idx_payment_attempts_tenant_lead_created on public.payment_attempts (tenant_id, lead_id, created_at);
create index if not exists idx_payment_attempts_provider_preference on public.payment_attempts (provider, external_preference_id);
create index if not exists idx_payment_attempts_provider_payment on public.payment_attempts (provider, external_payment_id);

-- Semilla mínima para pruebas.
insert into public.tenants (id, name, whatsapp_number, plan)
values (
  '00000000-0000-0000-0000-000000000001',
  'Demo Tenant',
  '5491100000000',
  'starter'
)
on conflict (id) do nothing;

insert into public.products (tenant_id, name, price, tags)
values
  ('00000000-0000-0000-0000-000000000001', 'Zapatilla Running Pro', 79999.00, array['zapatilla','running','deporte']),
  ('00000000-0000-0000-0000-000000000001', 'Remera Dry Fit', 25999.00, array['remera','deporte','dryfit'])
on conflict (tenant_id, name) do nothing;

insert into public.product_variants (tenant_id, product_id, sku, attributes, price, stock, reserved_stock, is_active)
select
  p.tenant_id,
  p.id,
  'RUNPRO-42-NEGRO',
  '{"talle":"42","color":"negro"}'::jsonb,
  null,
  8,
  0,
  true
from public.products p
where p.tenant_id = '00000000-0000-0000-0000-000000000001'
  and p.name = 'Zapatilla Running Pro'
on conflict (tenant_id, sku) do nothing;

insert into public.product_variants (tenant_id, product_id, sku, attributes, price, stock, reserved_stock, is_active)
select
  p.tenant_id,
  p.id,
  'RUNPRO-43-NEGRO',
  '{"talle":"43","color":"negro"}'::jsonb,
  null,
  6,
  0,
  true
from public.products p
where p.tenant_id = '00000000-0000-0000-0000-000000000001'
  and p.name = 'Zapatilla Running Pro'
on conflict (tenant_id, sku) do nothing;

insert into public.bot_playbooks (tenant_id, intent, variant, template, weight, is_active)
values
  ('00000000-0000-0000-0000-000000000001', 'precio', 'A', '{product_name} está en ${price}. Tenemos {available_stock} unidad(es) disponibles. ¿Querés que te reserve una?', 50, true),
  ('00000000-0000-0000-0000-000000000001', 'precio', 'B', 'El precio de {product_name} es ${price}. Hay {available_stock} unidad(es) en stock. Si querés, la dejo reservada ahora.', 50, true),
  ('00000000-0000-0000-0000-000000000001', 'stock', 'A', 'Sí, tenemos {product_name}. Quedan {available_stock} unidad(es). ¿Querés avanzar con la reserva?', 50, true),
  ('00000000-0000-0000-0000-000000000001', 'stock', 'B', 'Te confirmo stock de {product_name}: {available_stock} unidad(es) disponibles. ¿Te aparto una?', 50, true),
  ('00000000-0000-0000-0000-000000000001', 'objecion', 'A', 'Entiendo. Si querés, te comparto una alternativa de {product_name} que se ajuste mejor a lo que buscás.', 50, true),
  ('00000000-0000-0000-0000-000000000001', 'objecion', 'B', 'Perfecto, gracias por el contexto. Puedo recomendarte otra opción de {product_name} según tu presupuesto.', 50, true),
  ('00000000-0000-0000-0000-000000000001', 'cierre', 'A', 'Excelente, ya tenemos {product_name} listo. Precio ${price}. ¿Te paso el link de pago para cerrar?', 50, true),
  ('00000000-0000-0000-0000-000000000001', 'cierre', 'B', '¡Genial! Reservamos {product_name}. Son ${price}. Si querés, ahora mismo te envío el link de pago.', 50, true)
on conflict (tenant_id, intent, variant) do nothing;

insert into public.bot_response_templates (tenant_id, key, template, is_active)
values
  ('00000000-0000-0000-0000-000000000001', 'payment_report_received', 'Gracias por avisar. Registramos el pago reportado de {product_name}. Un asesor lo valida y te confirmamos por este medio en breve.', true),
  ('00000000-0000-0000-0000-000000000001', 'payment_cash_available', 'Perfecto, tu reserva de {product_name} está activa. Podemos tomar pago en efectivo al retiro. Si querés, te derivamos con un asesor para coordinar entrega y cierre.', true),
  ('00000000-0000-0000-0000-000000000001', 'payment_options_overview', 'Para {product_name} podés pagar con Mercado Pago (link) o en efectivo al retiro. Precio ${price}. ¿Querés que te reserve una y avanzamos con la opción que prefieras?', true),
  ('00000000-0000-0000-0000-000000000001', 'payment_link_offer', 'Perfecto, puedo ayudarte a avanzar con {product_name}. Precio ${price}. ¿Querés que te comparta el link de pago?', true),
  ('00000000-0000-0000-0000-000000000001', 'stock_offer', '{product_name} está en ${price} y tenemos {available_stock} unidad(es) disponibles. ¿Querés que te reserve una?', true),
  ('00000000-0000-0000-0000-000000000001', 'no_product_prompt', 'Gracias por escribirnos. Decime qué producto estás buscando y te paso precio y disponibilidad al instante.', true),
  ('00000000-0000-0000-0000-000000000001', 'lead_no_product', 'Gracias por escribirnos. Contame qué producto te interesa y te comparto precio y stock al instante.', true),
  ('00000000-0000-0000-0000-000000000001', 'orchestrator_guardrail_handoff', 'Quiero asegurarme de darte la mejor respuesta. Te paso con un asesor para confirmar los detalles y ayudarte a cerrar la compra.', true),
  ('00000000-0000-0000-0000-000000000001', 'orchestrator_auto_handoff_summary', 'Derivación automática a asesor por baja confianza o necesidad de atención humana.', true)
on conflict (tenant_id, key) do nothing;

insert into public.tenant_knowledge (tenant_id, business_category, business_labels, profile)
values (
  '00000000-0000-0000-0000-000000000001',
  'indumentaria_calzado',
  array['venta_minorista', 'catalogo_whatsapp'],
  jsonb_build_object(
    'businessCategory', 'indumentaria_calzado',
    'businessLabels', jsonb_build_array('venta_minorista', 'catalogo_whatsapp'),
    'paymentMethods', jsonb_build_object(
      'available', jsonb_build_array('link_pago', 'efectivo_retiro')
    ),
    'shippingMethods', jsonb_build_object(
      'available', jsonb_build_array()
    ),
    'productVariantAxes', jsonb_build_array('talle', 'color', 'modelo'),
    'businessPolicy', jsonb_build_object(
      'reservationTtlMinutes', 30,
      'allowExchange', true,
      'allowReturns', true
    )
  )
)
on conflict (tenant_id) do nothing;

-- Usuario demo: admin@demo.local / demo123
insert into public.app_users (tenant_id, email, password_hash, role, is_active)
values (
  '00000000-0000-0000-0000-000000000001',
  'admin@demo.local',
  encode(digest('demo123:00000000-0000-0000-0000-000000000001:', 'sha256'), 'hex'),
  'admin',
  true
)
on conflict (tenant_id, email) do nothing;
