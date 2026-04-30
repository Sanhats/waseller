"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle, Loader2 } from "lucide-react";

const money = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

type OrderStatus =
  | "pending_payment"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "fulfilled"
  | "refunded";

type StatusResponse = {
  orderId: string;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  paidAt: string | null;
  expiresAt: string | null;
  itemCount: number;
};

const SHELL =
  "mx-auto w-full max-w-[min(40rem,calc(100%-1.5rem))] px-3 sm:px-5 lg:px-8";

export function CheckoutResult({
  slug,
  orderId,
  expected,
}: {
  slug: string;
  orderId: string | null;
  expected: "approved" | "pending" | "failure";
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/public/orders/${encodeURIComponent(orderId)}/status?slug=${encodeURIComponent(slug)}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        setStatus(data);
        setLoading(false);
        setPollCount((n) => n + 1);
        /** Si esperamos approved pero está pending, poleamos hasta 8 veces (40s aprox.). */
        const isTransient = expected === "approved" && data.status === "pending_payment";
        if (isTransient && pollCount < 8) {
          timeoutId = setTimeout(poll, 5000);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, slug, expected]);

  /** El title/copy se basa primero en lo que MP nos dijo (expected), pero si el polling lo confirma se ajusta. */
  const effective = status?.status ?? null;
  const expectedFallback: "success" | "pending" | "failure" =
    expected === "approved" ? "success" : expected;
  const variant: "success" | "pending" | "failure" =
    effective === "paid" || effective === "fulfilled"
      ? "success"
      : effective === "failed" || effective === "cancelled" || effective === "expired"
        ? "failure"
        : effective === "pending_payment"
          ? expected === "approved"
            ? "pending"
            : expectedFallback
          : expectedFallback;

  const config = {
    success: {
      Icon: CheckCircle2,
      iconColor: "#16a34a",
      title: "¡Pago confirmado!",
      body: "Recibimos tu pago. Te vamos a contactar por WhatsApp para coordinar la entrega.",
      cta: "Volver a la tienda",
    },
    pending: {
      Icon: Clock,
      iconColor: "var(--ts-primary)",
      title: "Pago pendiente",
      body: "Tu pago está en proceso. Apenas Mercado Pago lo confirme te avisamos por email y WhatsApp.",
      cta: "Volver a la tienda",
    },
    failure: {
      Icon: XCircle,
      iconColor: "#dc2626",
      title: "El pago no se completó",
      body: "Tu carrito no se cobró. Podés intentar nuevamente desde el catálogo.",
      cta: "Volver al catálogo",
    },
  }[variant];

  const ctaHref = variant === "failure" ? `/tienda/${slug}/catalogo` : `/tienda/${slug}`;

  return (
    <div className={`${SHELL} py-16`}>
      <div
        className="rounded-2xl border p-8 text-center"
        style={{
          borderColor: "var(--ts-border)",
          backgroundColor: "var(--ts-surface)",
        }}
      >
        <div className="flex justify-center">
          <config.Icon size={48} style={{ color: config.iconColor }} />
        </div>
        <h1
          className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl"
          style={{ color: "var(--ts-text)", letterSpacing: "-0.02em" }}
        >
          {config.title}
        </h1>
        <p
          className="mx-auto mt-3 max-w-md text-sm leading-relaxed"
          style={{ color: "var(--ts-muted)" }}
        >
          {config.body}
        </p>

        {loading && orderId ? (
          <p
            className="mt-5 inline-flex items-center gap-2 text-[11px]"
            style={{ color: "var(--ts-muted)" }}
          >
            <Loader2 size={12} className="animate-spin" />
            Consultando estado…
          </p>
        ) : status ? (
          <div
            className="mx-auto mt-6 max-w-xs space-y-1 rounded-md border px-4 py-3 text-left text-xs"
            style={{
              borderColor: "var(--ts-border)",
              backgroundColor: "var(--ts-bg)",
              color: "var(--ts-muted)",
            }}
          >
            <div className="flex justify-between gap-3">
              <span>Orden</span>
              <span className="font-mono text-[10px] text-[var(--ts-text)]">
                {status.orderId.slice(0, 8)}…
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Productos</span>
              <span style={{ color: "var(--ts-text)" }}>{status.itemCount}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Total</span>
              <span className="font-semibold tabular-nums" style={{ color: "var(--ts-text)" }}>
                {money(status.totalAmount)}
              </span>
            </div>
          </div>
        ) : null}

        <div className="mt-8">
          <Link
            href={ctaHref}
            className="group inline-flex items-center gap-3 border-b py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] no-underline"
            style={{ borderColor: "var(--ts-text)", color: "var(--ts-text)" }}
          >
            <span>{config.cta}</span>
            <span
              aria-hidden
              className="transition-transform duration-500 group-hover:translate-x-1.5"
            >
              →
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
