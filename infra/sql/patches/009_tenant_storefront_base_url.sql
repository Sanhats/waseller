-- Origen público del storefront del tenant (sin barra final).
-- Se usa para construir back_urls de Mercado Pago al iniciar el checkout.
-- Si es NULL, se cae a PUBLIC_STOREFRONT_BASE_URL global.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS storefront_base_url TEXT;
