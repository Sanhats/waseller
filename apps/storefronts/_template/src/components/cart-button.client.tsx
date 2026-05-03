"use client";

import Link from "next/link";
import { useCart } from "@/lib/use-cart";

export function CartButton() {
  const { totalQuantity, hydrated } = useCart();
  return (
    <Link
      href="/carrito"
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}
      aria-label={`Carrito (${totalQuantity} productos)`}
    >
      <span>Carrito</span>
      {hydrated && totalQuantity > 0 && (
        <span
          style={{
            display: "inline-flex",
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 9,
            background: "#1a1a1a",
            color: "#ffffff",
            fontSize: 10,
            fontWeight: 700,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {totalQuantity}
        </span>
      )}
    </Link>
  );
}
