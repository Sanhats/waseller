-- Ventas iniciadas desde la tienda pública (carrito + checkout MP).
-- Aplicar manualmente a Supabase. Idempotente: usa IF NOT EXISTS / DO blocks.

-- 1) Enum order_status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM (
      'pending_payment',
      'paid',
      'failed',
      'cancelled',
      'expired',
      'fulfilled',
      'refunded'
    );
  END IF;
END$$;

-- 2) Tabla orders
CREATE TABLE IF NOT EXISTS orders (
  id                 UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status             order_status NOT NULL DEFAULT 'pending_payment',
  total_amount       NUMERIC(10,2) NOT NULL,
  currency           TEXT         NOT NULL DEFAULT 'ARS',
  buyer_name         TEXT         NOT NULL,
  buyer_email        TEXT         NOT NULL,
  buyer_phone        TEXT         NOT NULL,
  buyer_notes        TEXT,
  external_reference TEXT         NOT NULL UNIQUE,
  expires_at         TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  fulfilled_at       TIMESTAMPTZ,
  metadata           JSONB,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_tenant_status_created_idx
  ON orders (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS orders_tenant_created_idx
  ON orders (tenant_id, created_at);

-- 3) Tabla order_items
CREATE TABLE IF NOT EXISTS order_items (
  id                  UUID          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_variant_id  UUID          NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name        TEXT          NOT NULL,
  variant_sku         TEXT          NOT NULL,
  variant_attributes  JSONB,
  quantity            INTEGER       NOT NULL CHECK (quantity > 0),
  unit_price          NUMERIC(10,2) NOT NULL,
  line_total          NUMERIC(10,2) NOT NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_variant_idx ON order_items (product_variant_id);

-- 4) Sumar order_id a payment_attempts (FK + index)
ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payment_attempts_tenant_order_created_idx
  ON payment_attempts (tenant_id, order_id, created_at);

-- 5) Sumar order_id a stock_movements (FK + index, para auditar reservas/commits del carrito)
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stock_movements_tenant_order_created_idx
  ON stock_movements (tenant_id, order_id, created_at);
