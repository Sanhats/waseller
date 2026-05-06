"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type ProductVariantRow = {
  variantId: string;
  productId: string;
  name: string;
  effectivePrice: number;
  sku: string;
  variantTalle?: string | null;
  variantColor?: string | null;
  variantMarca?: string | null;
  stock: number;
  reservedStock: number;
  availableStock: number;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  variantImageUrls?: string[] | null;
};

type GroupedProduct = {
  productId: string;
  name: string;
  imageUrl: string | null;
  variants: ProductVariantRow[];
};

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function formatPrice(value: number): string {
  return ARS.format(value);
}

function variantLabel(v: ProductVariantRow): string {
  const parts = [v.variantTalle, v.variantColor].filter((x): x is string => Boolean(x && x.trim()));
  return parts.length > 0 ? parts.join(" · ") : "Única";
}

function pickImage(v: ProductVariantRow): string | null {
  const variant = v.variantImageUrls?.find((u) => u && u.trim()) ?? null;
  if (variant) return variant;
  const fromList = v.imageUrls?.find((u) => u && u.trim()) ?? null;
  if (fromList) return fromList;
  return v.imageUrl?.trim() ? v.imageUrl : null;
}

function groupVariants(rows: ProductVariantRow[]): GroupedProduct[] {
  const map = new Map<string, GroupedProduct>();
  for (const row of rows) {
    let group = map.get(row.productId);
    if (!group) {
      group = {
        productId: row.productId,
        name: row.name,
        imageUrl: pickImage(row),
        variants: [],
      };
      map.set(row.productId, group);
    }
    if (!group.imageUrl) group.imageUrl = pickImage(row);
    group.variants.push(row);
  }
  return Array.from(map.values());
}

type Props = {
  /** Token JWT y tenantId actuales. */
  auth: { token: string; tenantId: string } | null;
  /** Llamado al apretar "Insertar precio" / "Insertar ficha": el padre lo agrega al draft. */
  onAppendDraft: (text: string) => void;
  /** Teléfono del lead actual (para crear/sumar a su pedido al reservar). */
  phone?: string;
  /** Avisa al padre que el pedido cambió (para refrescar la tab Pedido). */
  onOrderChanged?: () => void;
};

export function ProductsPanel({ auth, onAppendDraft, phone, onOrderChanged }: Props) {
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const [reserveOk, setReserveOk] = useState<string | null>(null);

  const reserveVariant = async (v: ProductVariantRow) => {
    if (!auth || !phone) return;
    setReservingId(v.variantId);
    setReserveError(null);
    setReserveOk(null);
    try {
      const res = await fetch(
        `${getClientApiBase()}/chat-orders/by-phone/${encodeURIComponent(phone)}/items`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
          body: JSON.stringify({ variantId: v.variantId, quantity: 1 }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      setReserveOk(`Reservada ${v.variantTalle ?? ""}${v.variantColor ? " · " + v.variantColor : ""}`.trim() || "Reservada");
      onOrderChanged?.();
      window.setTimeout(() => setReserveOk(null), 2500);
    } catch (err) {
      setReserveError(err instanceof Error ? err.message : "No se pudo reservar.");
    } finally {
      setReservingId(null);
    }
  };

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<ProductVariantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!auth) {
      setRows([]);
      return;
    }
    const myReq = ++requestId.current;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (debounced) params.set("q", debounced);
    fetch(`${getClientApiBase()}/products${params.toString() ? `?${params.toString()}` : ""}`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "x-tenant-id": auth.tenantId,
      },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return (await res.json()) as ProductVariantRow[];
      })
      .then((data) => {
        if (myReq !== requestId.current) return;
        setRows(Array.isArray(data) ? data : []);
      })
      .catch((err: unknown) => {
        if (myReq !== requestId.current) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "No se pudieron cargar los productos.");
        setRows([]);
      })
      .finally(() => {
        if (myReq === requestId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [auth, debounced]);

  const groups = useMemo(() => groupVariants(rows), [rows]);

  const insertPrice = (v: ProductVariantRow, productName: string) => {
    const variant = variantLabel(v);
    const text = `${productName} (${variant}) — ${formatPrice(v.effectivePrice)}`;
    onAppendDraft(text);
  };

  const insertPhoto = (v: ProductVariantRow) => {
    const img = pickImage(v);
    if (!img) {
      setReserveError("Esta variante no tiene foto.");
      window.setTimeout(() => setReserveError(null), 2500);
      return;
    }
    onAppendDraft(img);
  };

  const insertSheet = (v: ProductVariantRow, productName: string) => {
    const lines: string[] = [productName];
    const variant = variantLabel(v);
    if (variant !== "Única") lines.push(variant);
    lines.push(formatPrice(v.effectivePrice));
    const img = pickImage(v);
    if (img) lines.push(img);
    onAppendDraft(lines.join("\n"));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <h3 className="text-section">Productos</h3>
        <p className="mt-1 text-label-ui text-muted-ui">
          Buscá y pegá precio o ficha en el chat. Editás antes de mandar.
        </p>
        <div className="mt-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, marca…"
            className="w-full"
            disabled={!auth}
          />
        </div>
      </div>

      {reserveError ? (
        <p className="mt-2 rounded-md border border-error bg-error-bg px-3 py-2 text-label-ui text-error" role="alert">
          {reserveError}
        </p>
      ) : null}
      {reserveOk ? (
        <p className="mt-2 rounded-md border border-success bg-success-bg px-3 py-2 text-label-ui text-success">
          {reserveOk}
        </p>
      ) : null}

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {!auth ? (
          <p className="text-label-ui text-muted-ui">Iniciá sesión para ver el catálogo.</p>
        ) : loading && rows.length === 0 ? (
          <div className="py-6 text-center">
            <Spinner size="sm" label="Buscando productos" />
          </div>
        ) : error ? (
          <p className="rounded-md border border-error bg-error-bg px-3 py-2 text-label-ui text-error" role="alert">
            {error}
          </p>
        ) : groups.length === 0 ? (
          <p className="text-label-ui text-muted-ui">
            {debounced ? "Sin resultados para esa búsqueda." : "No hay productos en el catálogo todavía."}
          </p>
        ) : (
          groups.map((group) => {
            const isOpen = openProductId === group.productId;
            const totalAvailable = group.variants.reduce((acc, v) => acc + Math.max(0, v.availableStock), 0);
            return (
              <div
                key={group.productId}
                className="rounded-lg border border-border bg-canvas shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setOpenProductId(isOpen ? null : group.productId)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-t-lg px-3 py-2 text-left transition-colors hover:bg-surface",
                    isOpen ? "bg-surface" : ""
                  )}
                >
                  <div className="size-12 shrink-0 overflow-hidden rounded-md bg-disabled-bg">
                    {group.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={group.imageUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="grid size-full place-items-center text-label-ui text-muted-ui">
                        sin foto
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-[var(--color-text)]">
                      {group.name}
                    </p>
                    <p className="text-label-ui text-muted-ui">
                      {group.variants.length} variante{group.variants.length === 1 ? "" : "s"} ·{" "}
                      {totalAvailable} disp.
                    </p>
                  </div>
                  <span className="text-label-ui text-muted-ui">{isOpen ? "−" : "+"}</span>
                </button>

                {isOpen ? (
                  <ul className="divide-y divide-border border-t border-border">
                    {group.variants.map((v) => {
                      const out = v.availableStock <= 0;
                      return (
                        <li key={v.variantId} className="flex flex-col gap-2 px-3 py-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-body text-[var(--color-text)]">{variantLabel(v)}</p>
                            <p className="text-body font-medium text-[var(--color-text)] tabular-nums">
                              {formatPrice(v.effectivePrice)}
                            </p>
                          </div>
                          <p
                            className={cn(
                              "text-label-ui",
                              out ? "text-error" : "text-muted-ui"
                            )}
                          >
                            {out
                              ? "Sin stock"
                              : `${v.availableStock} disp.${
                                  v.reservedStock > 0 ? ` · ${v.reservedStock} reservada${v.reservedStock === 1 ? "" : "s"}` : ""
                                }`}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => insertPrice(v, group.name)}
                              className="h-8 px-2 text-label-ui"
                            >
                              Insertar precio
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => insertPhoto(v)}
                              disabled={!pickImage(v)}
                              className="h-8 px-2 text-label-ui"
                            >
                              Insertar foto
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => insertSheet(v, group.name)}
                              className="h-8 px-2 text-label-ui"
                            >
                              Insertar ficha
                            </Button>
                            <Button
                              type="button"
                              variant="primary"
                              onClick={() => reserveVariant(v)}
                              disabled={out || !phone || reservingId === v.variantId}
                              className="h-8 px-2 text-label-ui"
                            >
                              {reservingId === v.variantId ? "Reservando…" : "Reservar"}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
