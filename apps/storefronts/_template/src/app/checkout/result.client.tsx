"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/money";
import type { OrderStatusResponse } from "@waseller/storefront-sdk";

type Variant = "success" | "pending" | "failure";

const COPY: Record<Variant, { title: string; body: string; cta: string }> = {
  success: {
    title: "¡Pago confirmado!",
    body: "Recibimos tu pago. Te contactamos por WhatsApp para coordinar la entrega.",
    cta: "Volver a la tienda",
  },
  pending: {
    title: "Pago pendiente",
    body: "Tu pago está en proceso. Apenas Mercado Pago lo confirme te avisamos.",
    cta: "Volver a la tienda",
  },
  failure: {
    title: "El pago no se completó",
    body: "Tu carrito no se cobró. Podés intentar nuevamente desde el catálogo.",
    cta: "Ver catálogo",
  },
};

export function CheckoutResult({ orderId, expected }: { orderId: string | null; expected: Variant | "approved" }) {
  const [status, setStatus] = useState<OrderStatusResponse | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const data = await api.getOrderStatus(orderId);
        if (cancelled) return;
        setStatus(data);
        setCount((n) => n + 1);
        const isTransient = expected === "approved" && data.status === "pending_payment";
        if (isTransient && count < 8) timer = setTimeout(poll, 5000);
      } catch {
        /* ignore */
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, expected]);

  const expectedNorm: Variant = expected === "approved" ? "success" : expected;
  const variant: Variant =
    status?.status === "paid" || status?.status === "fulfilled"
      ? "success"
      : status?.status === "failed" || status?.status === "cancelled" || status?.status === "expired"
        ? "failure"
        : status?.status === "pending_payment"
          ? expected === "approved"
            ? "pending"
            : expectedNorm
          : expectedNorm;

  const copy = COPY[variant];

  return (
    <div className="container" style={{ padding: "64px 16px", textAlign: "center", maxWidth: 560 }}>
      <h1>{copy.title}</h1>
      <p style={{ color: "#666" }}>{copy.body}</p>
      {status && (
        <div style={{ display: "inline-block", textAlign: "left", padding: 16, background: "#f9f9f9", marginTop: 24, fontSize: 13 }}>
          <div>Orden: <code>{status.orderId.slice(0, 8)}…</code></div>
          <div>Productos: {status.itemCount}</div>
          <div>Total: <strong>{money(status.totalAmount)}</strong></div>
        </div>
      )}
      <div style={{ marginTop: 32 }}>
        <Link href={variant === "failure" ? "/catalogo" : "/"} className="btn btn-primary">{copy.cta}</Link>
      </div>
    </div>
  );
}
