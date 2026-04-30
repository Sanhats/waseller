"use client";

import { useMemo, useState } from "react";
import { Check, ShoppingCart } from "lucide-react";
import { useCart, type CartItem } from "../../_lib/use-cart";

export type VariantOption = {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  variantTalle?: string | null;
  variantColor?: string | null;
  variantMarca?: string | null;
  attributes?: Record<string, unknown> | null;
  unitPrice: number;
  availableStock: number;
  imageUrl?: string;
};

const money = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

function describeVariant(v: VariantOption): string {
  const bits: string[] = [];
  if (v.variantTalle?.trim()) bits.push(`Talle ${v.variantTalle.trim()}`);
  if (v.variantColor?.trim()) bits.push(`Color ${v.variantColor.trim()}`);
  if (v.variantMarca?.trim()) bits.push(`Marca ${v.variantMarca.trim()}`);
  return bits.length > 0 ? bits.join(" · ") : v.sku;
}

export function AddToCart({ slug, variants }: { slug: string; variants: VariantOption[] }) {
  const inStock = useMemo(() => variants.filter((v) => v.availableStock > 0), [variants]);
  const [selectedId, setSelectedId] = useState<string>(inStock[0]?.variantId ?? variants[0]?.variantId ?? "");
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const { addItem, items } = useCart(slug);

  const selected = variants.find((v) => v.variantId === selectedId) ?? variants[0];
  const inCart = items.find((it) => it.variantId === selected?.variantId)?.quantity ?? 0;
  const max = Math.max(0, (selected?.availableStock ?? 0) - inCart);
  const canAdd = !!selected && max > 0 && quantity > 0;

  const handleAdd = () => {
    if (!selected || !canAdd) return;
    const qty = Math.min(quantity, max);
    const cartItem: CartItem = {
      variantId: selected.variantId,
      productId: selected.productId,
      productName: selected.productName,
      variantSku: selected.sku,
      variantLabel: describeVariant(selected),
      imageUrl: selected.imageUrl,
      unitPrice: selected.unitPrice,
      quantity: qty,
      availableStock: selected.availableStock,
    };
    addItem(cartItem);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2200);
    setQuantity(1);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--ts-muted)]">
          {variants.length === 1 ? "Producto" : "Elegí variante"}
        </p>
        <ul className="space-y-2">
          {variants.map((v) => {
            const isSelected = v.variantId === selectedId;
            const out = v.availableStock <= 0;
            return (
              <li key={v.variantId}>
                <button
                  type="button"
                  onClick={() => !out && setSelectedId(v.variantId)}
                  disabled={out}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    borderColor: isSelected ? "var(--ts-primary)" : "var(--ts-border)",
                    backgroundColor: isSelected
                      ? "color-mix(in srgb, var(--ts-primary) 6%, var(--ts-surface))"
                      : "var(--ts-surface)",
                  }}
                  aria-pressed={isSelected}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--ts-text)]">
                      {describeVariant(v)}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-[var(--ts-muted)]">
                      {v.sku}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[var(--ts-text)] tabular-nums">
                      {money(v.unitPrice)}
                    </div>
                    <div className="text-[10px] text-[var(--ts-muted)]">
                      {out ? "Sin stock" : `${v.availableStock} u.`}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected && selected.availableStock > 0 ? (
        <>
          <div className="flex items-center gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--ts-muted)]">
              Cantidad
            </p>
            <div
              className="flex items-center overflow-hidden rounded-md border"
              style={{ borderColor: "var(--ts-border)" }}
            >
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="flex h-8 w-8 items-center justify-center text-sm transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_5%,transparent)] disabled:opacity-40"
                aria-label="Quitar uno"
              >
                −
              </button>
              <span className="min-w-[36px] text-center text-sm font-semibold tabular-nums text-[var(--ts-text)]">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(max, q + 1))}
                disabled={quantity >= max}
                className="flex h-8 w-8 items-center justify-center text-sm transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_5%,transparent)] disabled:opacity-40"
                aria-label="Sumar uno"
              >
                +
              </button>
            </div>
            {inCart > 0 ? (
              <span className="text-[10px] text-[var(--ts-muted)]">
                {inCart} ya en carrito
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-[11px] font-bold uppercase tracking-[0.16em] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: justAdded ? "color-mix(in srgb, var(--ts-primary) 80%, white)" : "var(--ts-primary)",
              color: "var(--ts-on-primary)",
            }}
          >
            {justAdded ? (
              <>
                <Check size={14} />
                Agregado al carrito
              </>
            ) : max <= 0 ? (
              "Sin más stock disponible"
            ) : (
              <>
                <ShoppingCart size={14} />
                Agregar al carrito
              </>
            )}
          </button>
        </>
      ) : (
        <p
          className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-[var(--ts-muted)]"
          style={{ borderColor: "var(--ts-border)" }}
        >
          Sin stock disponible. Próximamente reabastecemos.
        </p>
      )}
    </div>
  );
}
