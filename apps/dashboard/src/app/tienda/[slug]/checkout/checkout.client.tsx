"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCart } from "../_lib/use-cart";

const money = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

const SHELL =
  "mx-auto w-full max-w-[min(70rem,calc(100%-1.5rem))] px-3 sm:px-5 lg:px-8";

export function CheckoutClient({ slug }: { slug: string }) {
  const { items, totalAmount, totalQuantity, clear, hydrated } = useCart(slug);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/public/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          items: items.map((it) => ({ variantId: it.variantId, quantity: it.quantity })),
          buyer: {
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            notes: notes.trim() || undefined,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        message?: string;
      };
      if (!res.ok || !data.checkoutUrl) {
        throw new Error(data.message ?? "No se pudo iniciar la compra. Probá de nuevo.");
      }
      /** Limpiar el carrito recién después de tener el checkoutUrl: si el redirect falla, no perdemos los items. */
      clear();
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
      setSubmitting(false);
    }
  };

  if (!hydrated) {
    return (
      <div className={`${SHELL} py-16 text-center`}>
        <Loader2 className="mx-auto animate-spin text-[var(--ts-muted)]" size={20} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`${SHELL} py-16 text-center`}>
        <p
          className="text-[10px] font-bold uppercase tracking-[0.32em]"
          style={{ color: "var(--ts-muted)" }}
        >
          Carrito vacío
        </p>
        <p
          className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl"
          style={{ color: "var(--ts-text)", letterSpacing: "-0.02em" }}
        >
          No hay nada para pagar
        </p>
        <p className="mt-3 text-sm" style={{ color: "var(--ts-muted)" }}>
          Volvé al catálogo y sumá productos para continuar.
        </p>
        <div className="mt-7">
          <Link
            href={`/tienda/${slug}/catalogo`}
            className="group inline-flex items-center gap-3 border-b py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] no-underline"
            style={{ borderColor: "var(--ts-text)", color: "var(--ts-text)" }}
          >
            <span>Ver catálogo</span>
            <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-1.5">→</span>
          </Link>
        </div>
      </div>
    );
  }

  const inputCls =
    "w-full rounded-md border bg-transparent px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ts-primary)]/20 focus:border-[var(--ts-primary)]";

  return (
    <div className={`${SHELL} py-10`}>
      <nav
        className="mb-6 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.24em]"
        aria-label="Breadcrumb"
      >
        <Link
          href={`/tienda/${slug}`}
          className="no-underline transition-opacity hover:opacity-70"
          style={{ color: "var(--ts-muted)" }}
        >
          Inicio
        </Link>
        <span aria-hidden style={{ color: "var(--ts-border)" }}>/</span>
        <span style={{ color: "var(--ts-text)" }}>Checkout</span>
      </nav>

      <h1
        className="text-3xl font-bold tracking-tight sm:text-4xl"
        style={{ color: "var(--ts-text)", letterSpacing: "-0.02em" }}
      >
        Iniciar compra
      </h1>
      <p className="mt-2 max-w-lg text-sm" style={{ color: "var(--ts-muted)" }}>
        Completá tus datos y te redirigimos a Mercado Pago para abonar de forma segura.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_0.8fr]"
      >
        {/* Datos del comprador */}
        <div className="space-y-5">
          <fieldset
            className="rounded-2xl border p-5"
            style={{
              borderColor: "var(--ts-border)",
              backgroundColor: "var(--ts-surface)",
            }}
          >
            <legend
              className="px-2 text-[10px] font-bold uppercase tracking-[0.24em]"
              style={{ color: "var(--ts-muted)" }}
            >
              Tus datos
            </legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-[var(--ts-text)]">
                  Nombre y apellido *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                  style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
                  placeholder="Juana Pérez"
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--ts-text)]">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
                  placeholder="tu@email.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--ts-text)]">
                  Teléfono / WhatsApp *
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputCls}
                  style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
                  placeholder="+54 9 11 1234-5678"
                  autoComplete="tel"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-semibold text-[var(--ts-text)]">
                  Notas (dirección de envío, horario, comentarios)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className={`${inputCls} resize-none leading-relaxed`}
                  style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
                  placeholder="Calle, altura, ciudad, CP. Aclaraciones para el envío."
                />
                <p className="mt-1.5 text-[10px]" style={{ color: "var(--ts-muted)" }}>
                  La logística se coordina por WhatsApp después del pago.
                </p>
              </div>
            </div>
          </fieldset>

          {error && (
            <div
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              role="alert"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Resumen */}
        <aside>
          <div
            className="sticky top-20 rounded-2xl border p-5"
            style={{
              borderColor: "var(--ts-border)",
              backgroundColor: "var(--ts-surface)",
            }}
          >
            <p
              className="text-[10px] font-bold uppercase tracking-[0.24em]"
              style={{ color: "var(--ts-muted)" }}
            >
              Tu compra ({totalQuantity} prod.)
            </p>
            <ul
              className="mt-4 space-y-3 border-b pb-4"
              style={{ borderColor: "var(--ts-border)" }}
            >
              {items.map((it) => (
                <li key={it.variantId} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p
                      className="line-clamp-2 font-medium leading-snug"
                      style={{ color: "var(--ts-text)" }}
                    >
                      {it.productName}
                    </p>
                    {it.variantLabel ? (
                      <p
                        className="mt-0.5 text-[11px]"
                        style={{ color: "var(--ts-muted)" }}
                      >
                        {it.variantLabel} · ×{it.quantity}
                      </p>
                    ) : (
                      <p
                        className="mt-0.5 text-[11px]"
                        style={{ color: "var(--ts-muted)" }}
                      >
                        ×{it.quantity}
                      </p>
                    )}
                  </div>
                  <span
                    className="shrink-0 text-sm font-semibold tabular-nums"
                    style={{ color: "var(--ts-text)" }}
                  >
                    {money(it.unitPrice * it.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-baseline justify-between">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.24em]"
                style={{ color: "var(--ts-muted)" }}
              >
                Total
              </span>
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: "var(--ts-text)" }}
              >
                {money(totalAmount)}
              </span>
            </div>
            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.16em] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                backgroundColor: "var(--ts-primary)",
                color: "var(--ts-on-primary)",
              }}
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Generando link…
                </>
              ) : (
                <>Pagar con Mercado Pago →</>
              )}
            </button>
            <p
              className="mt-3 text-[10px] leading-relaxed"
              style={{ color: "var(--ts-muted)" }}
            >
              Te redirigimos al checkout seguro de Mercado Pago. Tu stock queda reservado por 15 minutos.
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}
