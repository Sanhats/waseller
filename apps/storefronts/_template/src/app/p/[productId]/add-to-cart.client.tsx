"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart, type CartItem } from "@/lib/use-cart";
import { money } from "@/lib/money";

type Variant = {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  variantTalle?: string | null;
  variantColor?: string | null;
  variantMarca?: string | null;
  unitPrice: number;
  availableStock: number;
  imageUrl?: string;
};

function describe(v: Variant): string {
  const bits: string[] = [];
  if (v.variantTalle?.trim()) bits.push(`Talle ${v.variantTalle}`);
  if (v.variantColor?.trim()) bits.push(`Color ${v.variantColor}`);
  if (v.variantMarca?.trim()) bits.push(`Marca ${v.variantMarca}`);
  return bits.length > 0 ? bits.join(" · ") : v.sku;
}

export function AddToCart({ variants }: { variants: Variant[] }) {
  const inStock = useMemo(() => variants.filter((v) => v.availableStock > 0), [variants]);
  const [selectedId, setSelectedId] = useState(inStock[0]?.variantId ?? variants[0]?.variantId ?? "");
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const { addItem, items } = useCart();
  const router = useRouter();

  const selected = variants.find((v) => v.variantId === selectedId) ?? variants[0];
  const inCart = items.find((it) => it.variantId === selected?.variantId)?.quantity ?? 0;
  const max = Math.max(0, (selected?.availableStock ?? 0) - inCart);

  const handleAdd = () => {
    if (!selected || max <= 0) return;
    const item: CartItem = {
      variantId: selected.variantId,
      productId: selected.productId,
      productName: selected.productName,
      variantSku: selected.sku,
      variantLabel: describe(selected),
      imageUrl: selected.imageUrl,
      unitPrice: selected.unitPrice,
      quantity: Math.min(qty, max),
      availableStock: selected.availableStock,
    };
    addItem(item);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    setQty(1);
  };

  return (
    <div>
      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        {variants.map((v) => {
          const isSelected = v.variantId === selectedId;
          const out = v.availableStock <= 0;
          return (
            <button
              key={v.variantId}
              type="button"
              onClick={() => !out && setSelectedId(v.variantId)}
              disabled={out}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                background: isSelected ? "#f5f5f5" : "#fff",
                border: `1px solid ${isSelected ? "#1a1a1a" : "#ddd"}`,
                cursor: out ? "not-allowed" : "pointer",
                opacity: out ? 0.5 : 1,
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 14 }}>{describe(v)}</span>
              <span style={{ fontSize: 13, color: "#666" }}>
                {money(v.unitPrice)} · {out ? "sin stock" : `${v.availableStock} u.`}
              </span>
            </button>
          );
        })}
      </div>

      {selected && selected.availableStock > 0 ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666" }}>Cantidad</span>
            <div style={{ display: "inline-flex", border: "1px solid #ccc" }}>
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} style={qtyBtn} disabled={qty <= 1}>−</button>
              <span style={{ minWidth: 36, textAlign: "center", lineHeight: "32px" }}>{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(max, q + 1))} style={qtyBtn} disabled={qty >= max}>+</button>
            </div>
            {inCart > 0 && <span style={{ fontSize: 11, color: "#888" }}>{inCart} ya en carrito</span>}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={handleAdd} className="btn btn-primary" disabled={max <= 0}>
              {added ? "✓ Agregado" : "Agregar al carrito"}
            </button>
            <button type="button" onClick={() => router.push("/carrito")} className="btn">
              Ver carrito
            </button>
          </div>
        </>
      ) : (
        <p style={{ color: "#888" }}>Sin stock disponible.</p>
      )}
    </div>
  );
}

const qtyBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  background: "transparent",
  border: "none",
  fontSize: 16,
};
