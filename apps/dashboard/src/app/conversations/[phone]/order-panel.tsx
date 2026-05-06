"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type ChatOrderItem = {
  id: string;
  productVariantId: string;
  productName: string;
  variantSku: string;
  variantAttributes: Record<string, unknown> | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

type PaymentMethod = "alias" | "link_mp" | "efectivo" | null;

type ChatOrderRecord = {
  id: string;
  status: string;
  totalAmount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  paidAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: ChatOrderItem[];
  paymentAttempts: Array<{ id: string; status: string; checkoutUrl: string | null; createdAt: string }>;
};

type Snapshot = {
  open: ChatOrderRecord | null;
  history: ChatOrderRecord[];
};

const ARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fmt = (n: number) => ARS.format(n);

function variantSummary(it: ChatOrderItem): string {
  const a = (it.variantAttributes ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["talle", "color", "marca", "modelo"]) {
    const v = a[k];
    if (v && String(v).trim()) parts.push(String(v).trim());
  }
  return parts.join(" · ") || it.variantSku;
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Pendiente de pago",
  paid: "Pagada",
  cancelled: "Cancelada",
  fulfilled: "Entregada",
  failed: "Fallida",
  expired: "Expirada",
  refunded: "Reembolsada"
};

type Props = {
  auth: { token: string; tenantId: string } | null;
  phone: string;
  /** Token que cambia cuando alguien externo (ej. ProductsPanel) suma items. */
  reloadKey: number;
  /** Pega texto al draft del composer del padre. */
  onAppendDraft: (text: string) => void;
  /** Reporta cantidad de ítems en la orden abierta (0 si no hay). */
  onOpenItemsCount?: (n: number) => void;
};

export function OrderPanel({ auth, phone, reloadKey, onAppendDraft, onOpenItemsCount }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [aliasInput, setAliasInput] = useState("");
  const [aliasSavedAt, setAliasSavedAt] = useState<number | null>(null);
  const [aliasSaving, setAliasSaving] = useState(false);
  const [tenantAlias, setTenantAlias] = useState("");

  const apiBase = getClientApiBase();

  const headers = useCallback(() => {
    if (!auth) return null;
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
      "x-tenant-id": auth.tenantId
    } as Record<string, string>;
  }, [auth]);

  const loadSnapshot = useCallback(async () => {
    if (!auth) return;
    try {
      const res = await fetch(`${apiBase}/chat-orders/by-phone/${encodeURIComponent(phone)}`, {
        headers: headers()!,
        cache: "no-store"
      });
      if (!res.ok) throw new Error(await res.text());
      const snap = (await res.json()) as Snapshot;
      setSnapshot(snap);
      const count = snap.open?.items.reduce((acc, it) => acc + Number(it.quantity), 0) ?? 0;
      onOpenItemsCount?.(count);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el pedido.");
    } finally {
      setLoading(false);
    }
  }, [auth, phone, apiBase, headers, onOpenItemsCount]);

  const loadAlias = useCallback(async () => {
    if (!auth) return;
    try {
      const res = await fetch(`${apiBase}/chat-orders/payment-info`, {
        headers: headers()!,
        cache: "no-store"
      });
      if (!res.ok) return;
      const j = (await res.json()) as { transferAlias?: string };
      const a = String(j.transferAlias ?? "");
      setTenantAlias(a);
      setAliasInput(a);
    } catch {
      // ignorable
    }
  }, [auth, apiBase, headers]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot, reloadKey]);

  useEffect(() => {
    void loadAlias();
  }, [loadAlias]);

  const saveAlias = async () => {
    if (!auth) return;
    setAliasSaving(true);
    try {
      const res = await fetch(`${apiBase}/chat-orders/payment-info`, {
        method: "PUT",
        headers: headers()!,
        body: JSON.stringify({ transferAlias: aliasInput.trim() })
      });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { transferAlias: string };
      setTenantAlias(j.transferAlias);
      setAliasSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el alias.");
    } finally {
      setAliasSaving(false);
    }
  };

  const order = snapshot?.open ?? null;

  const pasteAlias = async () => {
    if (!order) return;
    if (!tenantAlias.trim()) {
      setError("Configurá un alias primero.");
      return;
    }
    setBusyAction("alias");
    try {
      await fetch(`${apiBase}/chat-orders/${order.id}/payment-method`, {
        method: "POST",
        headers: headers()!,
        body: JSON.stringify({ method: "alias" })
      });
      const text = `Te paso los datos para transferir:\nAlias: ${tenantAlias}\nMonto: ${fmt(order.totalAmount)}\n\nCuando hagas la transferencia mandame el comprobante para confirmar el pedido.`;
      onAppendDraft(text);
      await loadSnapshot();
    } finally {
      setBusyAction(null);
    }
  };

  const pasteMpLink = async () => {
    if (!order) return;
    setBusyAction("mp");
    try {
      const res = await fetch(`${apiBase}/chat-orders/${order.id}/mp-link`, {
        method: "POST",
        headers: headers()!
      });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { checkoutUrl: string };
      const text = `Link de pago Mercado Pago — ${fmt(order.totalAmount)}\n${j.checkoutUrl}\n\nCualquier duda, avisame!`;
      onAppendDraft(text);
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el link de MP.");
    } finally {
      setBusyAction(null);
    }
  };

  const markEfectivo = async () => {
    if (!order) return;
    setBusyAction("efectivo");
    try {
      await fetch(`${apiBase}/chat-orders/${order.id}/payment-method`, {
        method: "POST",
        headers: headers()!,
        body: JSON.stringify({ method: "efectivo" })
      });
      const text = `Reservado, lo abonás en efectivo cuando retires/recibas. Total: ${fmt(order.totalAmount)}.`;
      onAppendDraft(text);
      await loadSnapshot();
    } finally {
      setBusyAction(null);
    }
  };

  const confirmPaid = async () => {
    if (!order) return;
    if (!confirm("¿Confirmar el pago de este pedido?")) return;
    setBusyAction("paid");
    try {
      const res = await fetch(`${apiBase}/chat-orders/${order.id}/confirm-paid`, {
        method: "POST",
        headers: headers()!
      });
      if (!res.ok) throw new Error(await res.text());
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar el pago.");
    } finally {
      setBusyAction(null);
    }
  };

  const cancel = async () => {
    if (!order) return;
    if (!confirm("¿Cancelar el pedido y liberar el stock?")) return;
    setBusyAction("cancel");
    try {
      const res = await fetch(`${apiBase}/chat-orders/${order.id}/cancel`, {
        method: "POST",
        headers: headers()!
      });
      if (!res.ok) throw new Error(await res.text());
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar.");
    } finally {
      setBusyAction(null);
    }
  };

  const updateItemQty = async (itemId: string, nextQty: number) => {
    if (!order) return;
    if (nextQty < 0 || nextQty > 99) return;
    setBusyAction(`item:${itemId}`);
    try {
      const res = await fetch(`${apiBase}/chat-orders/${order.id}/items/${itemId}`, {
        method: "PATCH",
        headers: headers()!,
        body: JSON.stringify({ quantity: nextQty })
      });
      if (!res.ok) throw new Error(await res.text());
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la cantidad.");
    } finally {
      setBusyAction(null);
    }
  };

  const removeItem = async (itemId: string) => {
    if (!order) return;
    if (!confirm("¿Quitar este ítem del pedido?")) return;
    setBusyAction(`item:${itemId}`);
    try {
      const res = await fetch(`${apiBase}/chat-orders/${order.id}/items/${itemId}`, {
        method: "DELETE",
        headers: headers()!
      });
      if (!res.ok) throw new Error(await res.text());
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar el ítem.");
    } finally {
      setBusyAction(null);
    }
  };

  const fulfill = async (orderId: string) => {
    if (!confirm("¿Marcar como entregado?")) return;
    setBusyAction("fulfill");
    try {
      const res = await fetch(`${apiBase}/chat-orders/${orderId}/fulfill`, {
        method: "POST",
        headers: headers()!
      });
      if (!res.ok) throw new Error(await res.text());
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo marcar entregado.");
    } finally {
      setBusyAction(null);
    }
  };

  if (!auth) {
    return <p className="text-label-ui text-muted-ui">Iniciá sesión.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Quick alias */}
      <details className="rounded-md border border-border bg-canvas px-3 py-2">
        <summary className="cursor-pointer text-label-ui text-muted-ui">
          Alias de transferencia: {tenantAlias.trim() ? <span className="font-medium text-[var(--color-text)]">{tenantAlias}</span> : <span className="italic">sin configurar</span>}
        </summary>
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            placeholder="ej. tu.alias.mp"
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void saveAlias()}
            disabled={aliasSaving || aliasInput.trim() === tenantAlias.trim()}
            className="h-8 px-3 text-label-ui"
          >
            {aliasSaving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
        {aliasSavedAt ? <p className="mt-1 text-label-ui text-success">Guardado.</p> : null}
      </details>

      {error ? (
        <p className="rounded-md border border-error bg-error-bg px-3 py-2 text-label-ui text-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !snapshot ? (
        <div className="py-6 text-center">
          <Spinner size="sm" label="Cargando pedido" />
        </div>
      ) : !order ? (
        <p className="rounded-md border border-border bg-canvas px-3 py-3 text-label-ui text-muted-ui">
          No hay pedido abierto. Tocá <strong>Reservar</strong> en una variante para empezar uno.
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-canvas p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-label-ui text-muted-ui">Pedido abierto</p>
            <span className="rounded-pill border border-border bg-disabled-bg px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-ui">
              {STATUS_LABEL[order.status] ?? order.status}
            </span>
          </div>
          <ul className="mt-2 divide-y divide-border">
            {order.items.map((it) => {
              const itemBusy = busyAction === `item:${it.id}`;
              return (
                <li key={it.id} className="flex flex-col gap-1 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-body text-[var(--color-text)]">{it.productName}</p>
                      <p className="text-label-ui text-muted-ui">{variantSummary(it)}</p>
                    </div>
                    <p className="text-body font-medium tabular-nums">{fmt(it.lineTotal)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void updateItemQty(it.id, it.quantity - 1)}
                        disabled={itemBusy || busyAction !== null || it.quantity <= 1}
                        className="size-6 px-0 text-label-ui"
                        aria-label="Quitar uno"
                      >
                        −
                      </Button>
                      <span className="min-w-[1.5rem] text-center text-label-ui tabular-nums">{it.quantity}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void updateItemQty(it.id, it.quantity + 1)}
                        disabled={itemBusy || busyAction !== null}
                        className="size-6 px-0 text-label-ui"
                        aria-label="Sumar uno"
                      >
                        +
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void removeItem(it.id)}
                      disabled={itemBusy || busyAction !== null}
                      className="h-6 px-1 text-label-ui text-error hover:bg-error-bg"
                    >
                      Quitar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <p className="text-label-ui text-muted-ui">Total</p>
            <p className="text-section font-semibold tabular-nums">{fmt(order.totalAmount)}</p>
          </div>
          {order.paymentMethod ? (
            <p className="mt-1 text-label-ui text-muted-ui">
              Método: <span className="font-medium text-[var(--color-text)]">
                {order.paymentMethod === "alias" ? "Transferencia" : order.paymentMethod === "link_mp" ? "Mercado Pago" : "Efectivo"}
              </span>
            </p>
          ) : null}

          <div className="mt-3 grid grid-cols-1 gap-2">
            <p className="text-label-ui font-semibold text-muted-ui">Pegar al chat</p>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void pasteAlias()}
                disabled={busyAction !== null}
                className="h-8 px-2 text-label-ui"
              >
                Alias
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void pasteMpLink()}
                disabled={busyAction !== null}
                className="h-8 px-2 text-label-ui"
              >
                {busyAction === "mp" ? "…" : "Link MP"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void markEfectivo()}
                disabled={busyAction !== null}
                className="h-8 px-2 text-label-ui"
              >
                Efectivo
              </Button>
            </div>
            <p className="mt-2 text-label-ui font-semibold text-muted-ui">Estado</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => void confirmPaid()}
                disabled={busyAction !== null}
                className="h-8 px-2 text-label-ui"
              >
                Confirmar pago
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void cancel()}
                disabled={busyAction !== null}
                className={cn("h-8 px-2 text-label-ui", "text-error hover:bg-error-bg")}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {snapshot?.history && snapshot.history.length > 0 ? (
        <div className="mt-2">
          <p className="text-label-ui font-semibold text-muted-ui">Pedidos anteriores</p>
          <ul className="mt-2 flex flex-col gap-2">
            {snapshot.history.map((h) => (
              <li key={h.id} className="rounded-md border border-border bg-canvas px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-label-ui text-muted-ui">
                    {new Date(h.createdAt).toLocaleDateString("es-AR")}
                  </span>
                  <span className="rounded-pill border border-border bg-disabled-bg px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-ui">
                    {STATUS_LABEL[h.status] ?? h.status}
                  </span>
                  <span className="text-body font-medium tabular-nums">{fmt(h.totalAmount)}</span>
                </div>
                {h.status === "paid" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void fulfill(h.id)}
                    disabled={busyAction !== null}
                    className="mt-2 h-7 px-2 text-label-ui"
                  >
                    Marcar entregado
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
