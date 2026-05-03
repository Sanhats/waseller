"use client";

import { useCallback, useEffect, useState } from "react";

export type CartItem = {
  variantId: string;
  productId: string;
  productName: string;
  variantSku: string;
  variantLabel?: string;
  imageUrl?: string;
  unitPrice: number;
  quantity: number;
  /** Stock visto al momento de agregar — usado para capear cantidad. */
  availableStock: number;
};

const STORAGE_KEY = "ws_storefront_cart_v1";
const STORAGE_EVENT = "ws_storefront_cart_changed";

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is CartItem =>
        x !== null && typeof x === "object" && "variantId" in x && "quantity" in x
    );
  } catch {
    return [];
  }
}

function write(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    /* localStorage puede fallar en modo privado / cuota — ignoramos */
  }
}

/** Hook de carrito con persistencia local y sync entre componentes/tabs. */
export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(read());
    setHydrated(true);
  }, []);

  useEffect(() => {
    const onChange = () => setItems(read());
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === STORAGE_KEY) setItems(read());
    };
    window.addEventListener(STORAGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STORAGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const persist = useCallback((next: CartItem[]) => {
    setItems(next);
    write(next);
  }, []);

  const addItem = useCallback(
    (item: CartItem) => {
      persist((() => {
        const cur = read();
        const idx = cur.findIndex((x) => x.variantId === item.variantId);
        if (idx >= 0) {
          const merged = { ...cur[idx], ...item };
          merged.quantity = Math.min(
            Math.max(1, cur[idx].quantity + item.quantity),
            Math.max(item.availableStock, cur[idx].availableStock)
          );
          const next = [...cur];
          next[idx] = merged;
          return next;
        }
        return [
          ...cur,
          {
            ...item,
            quantity: Math.min(Math.max(1, item.quantity), Math.max(1, item.availableStock)),
          },
        ];
      })());
    },
    [persist]
  );

  const setQuantity = useCallback(
    (variantId: string, quantity: number) => {
      persist((() => {
        const cur = read();
        const idx = cur.findIndex((x) => x.variantId === variantId);
        if (idx < 0) return cur;
        const q = Math.max(0, Math.floor(quantity));
        if (q === 0) {
          const next = [...cur];
          next.splice(idx, 1);
          return next;
        }
        const max = Math.max(1, cur[idx].availableStock || q);
        const next = [...cur];
        next[idx] = { ...cur[idx], quantity: Math.min(q, max) };
        return next;
      })());
    },
    [persist]
  );

  const removeItem = useCallback(
    (variantId: string) => {
      persist(read().filter((x) => x.variantId !== variantId));
    },
    [persist]
  );

  const clear = useCallback(() => persist([]), [persist]);

  const totalQuantity = items.reduce((acc, it) => acc + it.quantity, 0);
  const totalAmount = items.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);

  return {
    items,
    totalQuantity,
    totalAmount,
    hydrated,
    addItem,
    setQuantity,
    removeItem,
    clear,
  };
}
