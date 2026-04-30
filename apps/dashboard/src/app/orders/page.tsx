"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { getClientApiBase } from "@/lib/api-base";

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

type OrderStatus =
  | "pending_payment"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "fulfilled"
  | "refunded";

type OrderRow = {
  id: string;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerNotes: string | null;
  externalReference: string;
  expiresAt: string | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

type OrderItemDetail = {
  id: string;
  productVariantId: string;
  productName: string;
  variantSku: string;
  variantAttributes: Record<string, unknown> | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

type PaymentAttemptDetail = {
  id: string;
  status: string;
  provider: string;
  amount: number;
  currency: string;
  checkoutUrl: string | null;
  externalPaymentId: string | null;
  createdAt: string;
  paidAt: string | null;
  lastWebhookAt: string | null;
};

type OrderDetail = {
  order: OrderRow;
  items: OrderItemDetail[];
  paymentAttempts: PaymentAttemptDetail[];
};

const PAGE_SIZE = 25;

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Pago pendiente",
  paid: "Pagada",
  fulfilled: "Despachada",
  failed: "Pago rechazado",
  cancelled: "Cancelada",
  expired: "Expirada",
  refunded: "Reembolsada",
};

const STATUS_PILL: Record<
  OrderStatus,
  { bg: string; color: string; border: string }
> = {
  pending_payment: {
    bg: "var(--color-warning-bg)",
    color: "var(--color-warning)",
    border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
  },
  paid: {
    bg: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
    color: "var(--color-primary)",
    border: "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)",
  },
  fulfilled: {
    bg: "var(--color-success-bg)",
    color: "var(--color-success)",
    border: "1px solid color-mix(in srgb, var(--color-success) 35%, transparent)",
  },
  failed: {
    bg: "var(--color-error-bg)",
    color: "var(--color-error)",
    border: "1px solid color-mix(in srgb, var(--color-error) 28%, transparent)",
  },
  cancelled: {
    bg: "var(--color-disabled-bg)",
    color: "var(--color-muted)",
    border: "1px solid var(--color-border)",
  },
  expired: {
    bg: "var(--color-disabled-bg)",
    color: "var(--color-muted)",
    border: "1px solid var(--color-border)",
  },
  refunded: {
    bg: "var(--color-disabled-bg)",
    color: "var(--color-muted)",
    border: "1px solid var(--color-border)",
  },
};

const STATUS_OPTIONS: Array<{ value: "all" | OrderStatus; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "pending_payment", label: "Pago pendiente" },
  { value: "paid", label: "Pagadas" },
  { value: "fulfilled", label: "Despachadas" },
  { value: "expired", label: "Expiradas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "failed", label: "Rechazadas" },
  { value: "refunded", label: "Reembolsadas" },
];

const money = (n: number, currency = "ARS") =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(n)));

const dateShort = (s: string) => {
  const d = new Date(s);
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const dateLong = (s: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleString("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function getAuthContext(): { token: string; tenantId: string } | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token) return null;
  return { token, tenantId };
}

export default function OrdersPage() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** Debounce de la búsqueda para no spamear la API mientras el usuario escribe. */
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchOrders = useCallback(async () => {
    const ctx = getAuthContext();
    if (!ctx) return;
    setLoading(true);
    setError("");
    try {
      const url = new URL(`${getClientApiBase()}/orders`, window.location.origin);
      if (statusFilter !== "all") url.searchParams.set("status", statusFilter);
      if (debouncedSearch) url.searchParams.set("search", debouncedSearch);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          "x-tenant-id": ctx.tenantId,
        },
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(d.message ?? "No se pudieron cargar las ventas.");
      }
      const data = (await res.json()) as { rows: OrderRow[]; total: number };
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, offset]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const handleStatusChange = (next: "all" | OrderStatus) => {
    setStatusFilter(next);
    setOffset(0);
  };

  const counts = useMemo(() => {
    /** Conteos por status calculados sobre la página actual — el total real lo trae la API. */
    const byStatus = new Map<OrderStatus, number>();
    for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    return byStatus;
  }, [rows]);

  return (
    <div
      className="flex h-[100dvh] w-full overflow-hidden"
      style={{ flexDirection: isMobile ? "column-reverse" : "row" }}
    >
      <AppSidebar active="orders" compact={isMobile} />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--color-bg)]">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-6 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <ShoppingBag size={20} className="text-[var(--color-primary)]" />
            <div>
              <h1 className="text-base font-semibold text-[var(--color-text)]">
                Ventas online
              </h1>
              <p className="text-xs text-[var(--color-muted)]">
                Pedidos iniciados desde la tienda pública
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void fetchOrders()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-60"
          >
            {loading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Actualizar
          </button>
        </header>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <div
            className="flex flex-1 items-center gap-2 rounded-lg border bg-[var(--color-surface)] px-3 py-2"
            style={{ borderColor: "var(--color-border)", maxWidth: 360 }}
          >
            <Search size={14} className="text-[var(--color-muted)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, email, teléfono o ID…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpiar búsqueda"
                className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                <X size={13} />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_OPTIONS.map((opt) => {
              const isActive = statusFilter === opt.value;
              const count =
                opt.value !== "all" ? counts.get(opt.value as OrderStatus) ?? 0 : null;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleStatusChange(opt.value)}
                  className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors"
                  style={{
                    backgroundColor: isActive
                      ? "var(--color-primary)"
                      : "var(--color-surface)",
                    color: isActive ? "white" : "var(--color-muted)",
                    border: isActive
                      ? "1px solid var(--color-primary)"
                      : "1px solid var(--color-border)",
                  }}
                >
                  {opt.label}
                  {count !== null && count > 0 ? (
                    <span className="ml-1.5 opacity-80">({count})</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        {/* Tabla */}
        <div className="mx-6 mb-6 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    color: "var(--color-muted)",
                    backgroundColor: "var(--color-bg)",
                  }}
                >
                  <th className="px-4 py-3">Pedido</th>
                  <th className="px-4 py-3">Comprador</th>
                  <th className="px-4 py-3 text-center">Items</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <Loader2
                        size={20}
                        className="mx-auto animate-spin text-[var(--color-muted)]"
                      />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--color-muted)]">
                      Aún no hay pedidos {statusFilter !== "all" ? `con estado "${STATUS_LABELS[statusFilter]}"` : ""}.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const pill = STATUS_PILL[r.status];
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelectedId(r.id)}
                        className="cursor-pointer border-t transition-colors hover:bg-[var(--color-bg)]"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs text-[var(--color-text)]">
                            #{r.id.slice(0, 8)}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-[var(--color-muted)]">
                            {r.externalReference.slice(0, 24)}…
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-[var(--color-text)]">
                            {r.buyerName}
                          </div>
                          <div className="text-xs text-[var(--color-muted)]">{r.buyerEmail}</div>
                        </td>
                        <td className="px-4 py-3 text-center text-sm text-[var(--color-text)] tabular-nums">
                          {r.itemCount}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-[var(--color-text)] tabular-nums">
                          {money(r.totalAmount, r.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold"
                            style={{
                              backgroundColor: pill.bg,
                              color: pill.color,
                              border: pill.border,
                            }}
                          >
                            {STATUS_LABELS[r.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--color-muted)] tabular-nums">
                          {dateShort(r.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--color-muted)]">
                          <ChevronRight size={14} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {total > PAGE_SIZE && (
            <div
              className="flex items-center justify-between border-t px-4 py-3 text-xs text-[var(--color-muted)]"
              style={{ borderColor: "var(--color-border)" }}
            >
              <span>
                Mostrando {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0 || loading}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg)] disabled:opacity-40"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total || loading}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg)] disabled:opacity-40"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {selectedId && (
        <OrderDetailDrawer
          orderId={selectedId}
          onClose={() => setSelectedId(null)}
          onMutated={() => void fetchOrders()}
        />
      )}
    </div>
  );
}

function OrderDetailDrawer({
  orderId,
  onClose,
  onMutated,
}: {
  orderId: string;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<"fulfill" | "cancel" | null>(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    const ctx = getAuthContext();
    if (!ctx) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${getClientApiBase()}/orders/${orderId}`, {
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          "x-tenant-id": ctx.tenantId,
        },
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(d.message ?? "No se pudo cargar el detalle");
      }
      setDetail((await res.json()) as OrderDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const performAction = async (action: "fulfill" | "cancel") => {
    const ctx = getAuthContext();
    if (!ctx) return;
    setActionLoading(action);
    setActionError("");
    try {
      const res = await fetch(`${getClientApiBase()}/orders/${orderId}/${action}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          "x-tenant-id": ctx.tenantId,
        },
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(d.message ?? "Error en la acción");
      }
      await load();
      onMutated();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setActionLoading(null);
    }
  };

  const order = detail?.order;
  const status = order?.status;
  const canFulfill = status === "paid";
  const canCancel = status === "pending_payment";

  return (
    <>
      <div
        className="fixed inset-0 z-40 backdrop-blur-sm transition-opacity"
        style={{ backgroundColor: "rgba(20, 30, 40, 0.42)" }}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-[min(34rem,96vw)] flex-col bg-[var(--color-surface)]"
        style={{ boxShadow: "-8px 0 32px rgba(0,0,0,0.18)" }}
        aria-label="Detalle de venta"
      >
        <header
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Pedido
            </p>
            <p className="mt-0.5 truncate font-mono text-sm font-semibold text-[var(--color-text)]">
              #{orderId.slice(0, 8)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bg)]"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-[var(--color-muted)]" size={20} />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle size={15} />
              {error}
            </div>
          ) : detail && order ? (
            <>
              {/* Status + total */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span
                    className="inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold"
                    style={{
                      backgroundColor: STATUS_PILL[order.status].bg,
                      color: STATUS_PILL[order.status].color,
                      border: STATUS_PILL[order.status].border,
                    }}
                  >
                    {STATUS_LABELS[order.status]}
                  </span>
                  <p className="mt-2 text-xs text-[var(--color-muted)]">
                    Creado {dateLong(order.createdAt)}
                  </p>
                  {order.paidAt && (
                    <p className="text-xs text-[var(--color-muted)]">
                      Pagado {dateLong(order.paidAt)}
                    </p>
                  )}
                  {order.fulfilledAt && (
                    <p className="text-xs text-[var(--color-muted)]">
                      Despachado {dateLong(order.fulfilledAt)}
                    </p>
                  )}
                  {order.expiresAt && order.status === "pending_payment" && (
                    <p className="text-xs text-[var(--color-warning)]">
                      Vence {dateLong(order.expiresAt)}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                    Total
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--color-text)]">
                    {money(order.totalAmount, order.currency)}
                  </p>
                </div>
              </div>

              {/* Comprador */}
              <section>
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                  Comprador
                </h3>
                <div
                  className="rounded-lg border p-3 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="font-medium text-[var(--color-text)]">{order.buyerName}</div>
                  <div className="mt-1 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                    <a
                      href={`mailto:${order.buyerEmail}`}
                      className="text-[var(--color-primary)] hover:underline"
                    >
                      {order.buyerEmail}
                    </a>
                    <a
                      href={`https://wa.me/${order.buyerPhone.replace(/[^\d]/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-primary)] hover:underline"
                    >
                      {order.buyerPhone}
                    </a>
                  </div>
                  {order.buyerNotes && (
                    <div
                      className="mt-3 rounded-md border border-dashed p-3 text-xs leading-relaxed text-[var(--color-text)]"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                        Notas
                      </p>
                      <p className="whitespace-pre-wrap">{order.buyerNotes}</p>
                    </div>
                  )}
                </div>
              </section>

              {/* Items */}
              <section>
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                  Productos ({detail.items.length})
                </h3>
                <ul
                  className="divide-y rounded-lg border"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  {detail.items.map((it) => {
                    const attrs = it.variantAttributes
                      ? Object.entries(it.variantAttributes)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")
                      : "";
                    return (
                      <li key={it.id} className="flex items-start justify-between gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-[var(--color-text)]">
                            {it.productName}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-[var(--color-muted)]">
                            {it.variantSku}
                          </div>
                          {attrs && (
                            <div className="mt-1 text-[11px] text-[var(--color-muted)]">{attrs}</div>
                          )}
                          <div className="mt-1.5 text-xs text-[var(--color-muted)]">
                            {it.quantity} × {money(it.unitPrice, order.currency)}
                          </div>
                        </div>
                        <div className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-text)]">
                          {money(it.lineTotal, order.currency)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* Payment attempts */}
              {detail.paymentAttempts.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                    Intentos de pago
                  </h3>
                  <ul
                    className="divide-y rounded-lg border"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    {detail.paymentAttempts.map((p) => (
                      <li key={p.id} className="space-y-1 p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] uppercase text-[var(--color-muted)]">
                            {p.provider}
                          </span>
                          <span className="font-semibold text-[var(--color-text)]">{p.status}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[var(--color-muted)]">
                          <span>{dateShort(p.createdAt)}</span>
                          {p.checkoutUrl && (
                            <a
                              href={p.checkoutUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline"
                            >
                              Link MP
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        {p.externalPaymentId && (
                          <div className="font-mono text-[10px] text-[var(--color-muted)]">
                            payment_id: {p.externalPaymentId}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {actionError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle size={13} />
                  {actionError}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Acciones */}
        {!loading && !error && detail && (canFulfill || canCancel) && (
          <footer
            className="flex items-center gap-2 border-t px-5 py-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            {canCancel && (
              <button
                type="button"
                onClick={() => void performAction("cancel")}
                disabled={actionLoading !== null}
                className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-xs font-semibold text-[var(--color-muted)] transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50"
              >
                {actionLoading === "cancel" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <X size={13} />
                )}
                Cancelar y liberar stock
              </button>
            )}
            {canFulfill && (
              <button
                type="button"
                onClick={() => void performAction("fulfill")}
                disabled={actionLoading !== null}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {actionLoading === "fulfill" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                Marcar como despachado
              </button>
            )}
          </footer>
        )}
      </aside>
    </>
  );
}
