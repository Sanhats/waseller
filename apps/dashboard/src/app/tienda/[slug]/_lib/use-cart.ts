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
  /** Stock disponible al momento de agregar — se usa para capear la cantidad. */
  availableStock: number;
};

const STORAGE_PREFIX = "ws_cart_v1_";
const STORAGE_EVENT = "ws_cart_changed";

function storageKey(slug: string): string {
  return `${STORAGE_PREFIX}${slug}`;
}

function readCart(slug: string): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
      .map((x) => ({
        variantId: String(x.variantId ?? ""),
        productId: String(x.productId ?? ""),
        productName: String(x.productName ?? ""),
        variantSku: String(x.variantSku ?? ""),
        variantLabel: x.variantLabel ? String(x.variantLabel) : undefined,
        imageUrl: x.imageUrl ? String(x.imageUrl) : undefined,
        unitPrice: Number(x.unitPrice ?? 0),
        quantity: Math.max(1, Math.floor(Number(x.quantity ?? 1))),
        availableStock: Math.max(0, Math.floor(Number(x.availableStock ?? 0))),
      }))
      .filter((item) => item.variantId && item.quantity > 0);
  } catch {
    return [];
  }
}

function writeCart(slug: string, items: CartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: { slug } }));
  } catch {
    /* localStorage puede fallar en modo privado / cuota — ignoramos */
  }
}

export function useCart(slug: string): {
  items: CartItem[];
  totalQuantity: number;
  totalAmount: number;
  addItem: (item: CartItem) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  removeItem: (variantId: string) => void;
  clear: () => void;
  hydrated: boolean;
} {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  /** Hidratación lazy: el server-render arranca con [], el cliente carga desde localStorage. */
  useEffect(() => {
    setItems(readCart(slug));
    setHydrated(true);
  }, [slug]);

  /** Sync entre tabs y entre componentes en la misma página (drawer + add button). */
  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === storageKey(slug)) setItems(readCart(slug));
    };
    const onLocal = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { slug?: string } | undefined;
      if (detail?.slug === slug) setItems(readCart(slug));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(STORAGE_EVENT, onLocal as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(STORAGE_EVENT, onLocal as EventListener);
    };
  }, [slug]);

  const persist = useCallback(
    (next: CartItem[]) => {
      setItems(next);
      writeCart(slug, next);
    },
    [slug]
  );

  const addItem = useCallback(
    (item: CartItem) => {
      persist((() => {
        const cur = readCart(slug);
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
    [persist, slug]
  );

  const setQuantity = useCallback(
    (variantId: string, quantity: number) => {
      persist((() => {
        const cur = readCart(slug);
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
    [persist, slug]
  );

  const removeItem = useCallback(
    (variantId: string) => {
      persist(readCart(slug).filter((x) => x.variantId !== variantId));
    },
    [persist, slug]
  );

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  const totalQuantity = items.reduce((acc, it) => acc + it.quantity, 0);
  const totalAmount = items.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);

  return { items, totalQuantity, totalAmount, addItem, setQuantity, removeItem, clear, hydrated };
}
