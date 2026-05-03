"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/use-cart";
import { api } from "@/lib/api";
import { money } from "@/lib/money";

export default function CheckoutPage() {
  const { items, totalAmount, totalQuantity, clear, hydrated } = useCart();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit =
    items.length > 0 &&
    name.trim().length > 1 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    phone.trim().length >= 6 &&
    !submitting;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await api.checkout(
        items.map((it) => ({ variantId: it.variantId, quantity: it.quantity })),
        { name: name.trim(), email: email.trim(), phone: phone.trim(), notes: notes.trim() || undefined }
      );
      /** Limpiamos el carrito DESPUÉS de tener checkoutUrl. Si el redirect falla, el comprador no pierde el carrito. */
      clear();
      window.location.href = res.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setSubmitting(false);
    }
  };

  if (!hydrated) return <div className="container" style={{ padding: 40 }}>Cargando…</div>;

  if (items.length === 0) {
    return (
      <div className="container" style={{ padding: "48px 16px", textAlign: "center" }}>
        <h1>No hay nada para pagar</h1>
        <Link href="/catalogo" className="btn btn-primary" style={{ marginTop: 16 }}>Ver catálogo</Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "32px 16px" }}>
      <h1>Iniciar compra</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginTop: 24 }}>
        <div style={{ display: "grid", gap: 16 }}>
          <Field label="Nombre *">
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoComplete="name" />
          </Field>
          <Field label="Email *">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="email" />
          </Field>
          <Field label="Teléfono / WhatsApp *">
            <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} autoComplete="tel" />
          </Field>
          <Field label="Notas (dirección, horario, comentarios)">
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
          </Field>
          {error && <div style={{ padding: 12, background: "#fde2e2", color: "#a00", fontSize: 13 }}>{error}</div>}
        </div>
        <aside style={{ alignSelf: "start", padding: 16, background: "#f9f9f9" }}>
          <h3 style={{ marginTop: 0 }}>Resumen ({totalQuantity})</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: "16px 0", borderBottom: "1px solid #e5e5e5", paddingBottom: 16 }}>
            {items.map((it) => (
              <li key={it.variantId} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
                <span>{it.productName} ×{it.quantity}</span>
                <strong>{money(it.unitPrice * it.quantity)}</strong>
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 700 }}>
            <span>Total</span>
            <span>{money(totalAmount)}</span>
          </div>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit} style={{ marginTop: 16, width: "100%" }}>
            {submitting ? "Generando link…" : "Pagar con Mercado Pago →"}
          </button>
          <p style={{ fontSize: 11, color: "#888", marginTop: 8 }}>
            Stock reservado por 15 minutos. Te redirigimos al checkout seguro de MP.
          </p>
        </aside>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = { padding: "10px 12px", border: "1px solid #ccc", fontSize: 14, background: "#fff" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#666" }}>
      {label}
      {children}
    </label>
  );
}
