-- Varios leads pueden compartir el mismo teléfono por tenant; email de panel único global.
alter table public.leads drop constraint if exists leads_tenant_id_phone_key;

create index if not exists idx_leads_tenant_phone on public.leads (tenant_id, phone);

alter table public.app_users drop constraint if exists app_users_tenant_id_email_key;

create unique index if not exists app_users_email_key on public.app_users (email);
