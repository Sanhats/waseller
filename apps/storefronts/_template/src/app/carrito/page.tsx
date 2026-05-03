"use client";

import Link from "next/link";
import { useCart } from "@/lib/use-cart";
import { money } from "@/lib/money";

export default function CartPage() {
  const { items, totalAmount, totalQuantity, setQuantity, removeItem, hydrated } = useCart();

  if (!hydrated) return <div className="container" style={{ padding: 40 }}>Cargando…</div>;

  if (items.length === 0) {
    return (
      <div className="container" style={{ padding: "48px 16px", textAlign: "center" }}>
        <h1>Tu carrito está vacío</h1>
        <p style={{ color: "#888" }}>Sumá productos del catálogo para empezar.</p>
        <Link href="/catalogo" className="btn btn-primary" style={{ marginTop: 16 }}>Ver catálogo</Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "32px 16px" }}>
      <h1>Tu carrito ({totalQuantity})</h1>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #e5e5e5", textAlign: "left", fontSize: 12, color: "#666" }}>
            <th style={{ padding: "12px 0" }}>Producto</th>
            <th style={{ padding: "12px 0" }}>Cantidad</th>
            <th style={{ padding: "12px 0", textAlign: "right" }}>Subtotal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.variantId} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "12px 0" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imageUrl} alt="" style={{ width: 48, height: 48, objectFit: "cover" }} />
                  )}
                  <div>
                    <div style={{ fontWeight: 500 }}>{it.productName}</div>
                    {it.variantLabel && <div style={{ fontSize: 12, color: "#666" }}>{it.variantLabel}</div>}
                  </div>
                </div>
              </td>
              <td style={{ padding: "12px 0" }}>
                <div style={{ display: "inline-flex", border: "1px solid #ccc" }}>
                  <button onClick={() => setQuantity(it.variantId, it.quantity - 1)} style={qtyBtn}>−</button>
                  <span style={{ minWidth: 32, textAlign: "center", lineHeight: "28px" }}>{it.quantity}</span>
                  <button onClick={() => setQuantity(it.variantId, it.quantity + 1)} style={qtyBtn}>+</button>
                </div>
              </td>
              <td style={{ padding: "12px 0", textAlign: "right", fontWeight: 600 }}>
                {money(it.unitPrice * it.quantity)}
              </td>
              <td style={{ padding: "12px 0", textAlign: "right" }}>
                <button onClick={() => removeItem(it.variantId)} style={{ background: "none", border: "none", color: "#888", fontSize: 12, cursor: "pointer" }}>
                  Quitar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32 }}>
        <div>
          <div style={{ fontSize: 12, color: "#666", textTransform: "uppercase" }}>Total</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{money(totalAmount)}</div>
        </div>
        <Link href="/checkout" className="btn btn-primary">Continuar al pago →</Link>
      </div>
    </div>
  );
}

const qtyBtn: React.CSSProperties = { width: 28, height: 28, background: "transparent", border: "none", fontSize: 14 };
