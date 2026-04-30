"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "./_lib/use-cart";

const money = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

export function CartButton({ slug }: { slug: string }) {
  const { totalQuantity, hydrated } = useCart(slug);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_6%,transparent)]"
        aria-label={`Abrir carrito (${totalQuantity} productos)`}
        title="Carrito"
        style={{ color: "var(--ts-text)" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
        </svg>
        {hydrated && totalQuantity > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none"
            style={{ backgroundColor: "var(--ts-primary)", color: "var(--ts-on-primary)" }}
          >
            {totalQuantity > 99 ? "99+" : totalQuantity}
          </span>
        )}
      </button>
      <CartDrawer slug={slug} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function CartDrawer({
  slug,
  open,
  onClose,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
}) {
  const { items, totalAmount, totalQuantity, setQuantity, removeItem, hydrated } = useCart(slug);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <div
        className={`fixed inset-0 z-50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ backgroundColor: "var(--ts-overlay-backdrop)" }}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-[min(24rem,92vw)] flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{
          backgroundColor: "var(--ts-surface)",
          boxShadow: open
            ? "-8px 0 32px color-mix(in srgb, var(--ts-text) 12%, transparent)"
            : undefined,
        }}
        aria-label="Carrito"
      >
        <header
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--ts-border)" }}
        >
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.24em]"
              style={{ color: "var(--ts-muted)" }}
            >
              Tu carrito
            </p>
            <p className="mt-0.5 text-sm font-semibold" style={{ color: "var(--ts-text)" }}>
              {hydrated ? `${totalQuantity} producto${totalQuantity === 1 ? "" : "s"}` : "…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_6%,transparent)]"
            aria-label="Cerrar carrito"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 1l12 12M13 1L1 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!hydrated ? null : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p
                className="text-[10px] font-bold uppercase tracking-[0.28em]"
                style={{ color: "var(--ts-muted)" }}
              >
                Carrito vacío
              </p>
              <p className="mt-3 text-sm" style={{ color: "var(--ts-muted)" }}>
                Sumá productos del catálogo para arrancar tu compra.
              </p>
              <Link
                href={`/tienda/${slug}/catalogo`}
                onClick={onClose}
                className="mt-6 inline-flex items-center gap-2 border-b py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] no-underline"
                style={{ borderColor: "var(--ts-text)", color: "var(--ts-text)" }}
              >
                <span>Ver catálogo</span>
                <span aria-hidden>→</span>
              </Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => (
                <li
                  key={item.variantId}
                  className="flex gap-3 border-b pb-4"
                  style={{ borderColor: "var(--ts-border)" }}
                >
                  <div
                    className="h-16 w-16 shrink-0 overflow-hidden rounded-md"
                    style={{ backgroundColor: "var(--ts-editorial-muted)" }}
                  >
                    {item.imageUrl?.trim() ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl.trim()}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/tienda/${slug}/p/${item.productId}`}
                      onClick={onClose}
                      className="block text-sm font-medium leading-snug no-underline hover:underline"
                      style={{ color: "var(--ts-text)" }}
                    >
                      {item.productName}
                    </Link>
                    {item.variantLabel ? (
                      <p
                        className="mt-1 text-[11px]"
                        style={{ color: "var(--ts-muted)" }}
                      >
                        {item.variantLabel}
                      </p>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div
                        className="flex items-center overflow-hidden rounded-md border"
                        style={{ borderColor: "var(--ts-border)" }}
                      >
                        <button
                          type="button"
                          onClick={() => setQuantity(item.variantId, item.quantity - 1)}
                          className="flex h-7 w-7 items-center justify-center text-sm transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_5%,transparent)] disabled:opacity-40"
                          disabled={item.quantity <= 1}
                          aria-label="Quitar uno"
                        >
                          −
                        </button>
                        <span
                          className="min-w-[28px] text-center text-xs font-semibold"
                          style={{ color: "var(--ts-text)" }}
                        >
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQuantity(item.variantId, item.quantity + 1)}
                          className="flex h-7 w-7 items-center justify-center text-sm transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_5%,transparent)] disabled:opacity-40"
                          disabled={item.availableStock > 0 && item.quantity >= item.availableStock}
                          aria-label="Sumar uno"
                        >
                          +
                        </button>
                      </div>
                      <span
                        className="text-sm font-semibold tabular-nums"
                        style={{ color: "var(--ts-text)" }}
                      >
                        {money(item.unitPrice * item.quantity)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.variantId)}
                      className="mt-1 text-[10px] font-medium uppercase tracking-wide transition-opacity hover:opacity-70"
                      style={{ color: "var(--ts-muted)" }}
                    >
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {hydrated && items.length > 0 && (
          <footer
            className="border-t px-5 py-4"
            style={{ borderColor: "var(--ts-border)" }}
          >
            <div className="flex items-baseline justify-between">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.24em]"
                style={{ color: "var(--ts-muted)" }}
              >
                Total
              </span>
              <span
                className="text-lg font-bold tabular-nums"
                style={{ color: "var(--ts-text)" }}
              >
                {money(totalAmount)}
              </span>
            </div>
            <p className="mt-1 text-[10px]" style={{ color: "var(--ts-muted)" }}>
              Costos de envío se coordinan después de la compra.
            </p>
            <Link
              href={`/tienda/${slug}/checkout`}
              onClick={onClose}
              className="mt-4 flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.16em] no-underline transition-opacity hover:opacity-90"
              style={{
                backgroundColor: "var(--ts-primary)",
                color: "var(--ts-on-primary)",
              }}
            >
              <span>Iniciar compra</span>
              <span aria-hidden>→</span>
            </Link>
          </footer>
        )}
      </aside>
    </>
  );
}
