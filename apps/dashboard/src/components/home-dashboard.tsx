"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { StockProductThumb } from "@/components/stock-ui";
import { Skeleton, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

type ConversationRowState = "nuevo" | "activo" | "esperando";

type DashboardProductHighlight = {
  productId: string;
  name: string;
  imageUrl?: string | null;
  count: number;
};

type DashboardSummary = {
  generatedAt: string;
  tenantName: string;
  kpis: {
    leadsToday: number;
    openConversations: number;
    salesClosed7d: number;
    conversionPct: number;
  };
  productHighlights?: {
    rangeDays: number;
    rangeLabel: string;
    topSold: DashboardProductHighlight[];
    topReserved: DashboardProductHighlight[];
  };
  conversationList: Array<{
    id: string;
    phone: string;
    displayName: string;
    lastMessage: string;
    timeLabel: string;
    state: ConversationRowState;
  }>;
};

function authHeaders(): HeadersInit | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId =
    window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { Authorization: `Bearer ${token}`, "x-tenant-id": tenantId };
}

function greetingForHour(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

function conversationHref(phone: string): string {
  return `/conversations/${encodeURIComponent(phone)}`;
}

const card =
  "rounded-xl border border-border bg-surface shadow-sm ring-1 ring-black/[0.02]";

const stateBadge: Record<ConversationRowState, string> = {
  nuevo:
    "border border-growth-strong/35 bg-[var(--color-growth-soft)] text-[var(--color-text)]",
  activo:
    "border border-primary/25 bg-[var(--color-primary-ultra-light)] text-primary",
  esperando:
    "border border-growth-strong/50 bg-[var(--color-growth-base)]/40 font-medium text-[var(--color-text)]",
};

const stateLabel: Record<ConversationRowState, string> = {
  nuevo: "Nuevo",
  activo: "Activo",
  esperando: "Esperando",
};

const kpiCard = cn(
  "flex flex-col justify-center rounded-xl border border-border bg-surface px-4 py-4 shadow-sm ring-1 ring-black/[0.02]",
);

function KpiGridSkeleton() {
  return (
    <div
      className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-hidden
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className={kpiCard}>
          <Skeleton className="h-8 w-16" />
          <Skeleton className="mt-3 h-4 w-28" />
        </div>
      ))}
    </div>
  );
}

function ProductHighlightsSkeleton() {
  return (
    <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2" aria-hidden>
      {[0, 1].map((col) => (
        <div key={col} className={cn("divide-y divide-border", card)}>
          <div className="px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-full max-w-sm" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-11 w-11 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-[min(100%,14rem)]" />
              </div>
              <Skeleton className="h-6 w-10 shrink-0 rounded-pill" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ConversationListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className={cn("mt-4 divide-y divide-border", card)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-5 w-[min(100%,12rem)]" />
                <Skeleton className="h-5 w-20 rounded-pill" />
              </div>
              <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <Skeleton className="h-3 w-14 shrink-0 sm:text-right" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function HomeDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [headerGreeting, setHeaderGreeting] = useState<string | null>(null);
  const firstFetchPendingRef = useRef(true);

  const load = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) return;
    const isInitialFetch = firstFetchPendingRef.current;
    if (isInitialFetch) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const res = await fetch(`${getClientApiBase()}/dashboard/summary`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      setSummary((await res.json()) as DashboardSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el panel");
      setSummary(null);
    } finally {
      if (isInitialFetch) {
        setLoading(false);
        firstFetchPendingRef.current = false;
      }
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    setHeaderGreeting(greetingForHour(new Date()));
  }, []);

  const tenantName = summary?.tenantName?.trim() || "tu negocio";
  const conv = summary?.conversationList ?? [];
  const kpis = summary?.kpis;
  const highlights = summary?.productHighlights;

  return (
    <div
      className="mx-auto flex w-full min-w-0 max-w-[min(88rem,100%)] flex-col gap-7 pb-6 lg:gap-8"
      aria-busy={loading || refreshing}
    >
      <header className="min-w-0 border-b border-border pb-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-[min(100%,22rem)] max-w-full" />
            <Spinner size="sm" label="Cargando datos del panel" />
          </div>
        ) : (
          <>
            <h1 className="text-title text-[var(--color-text)] min-h-[1.4em]">
              {headerGreeting != null ? (
                `${headerGreeting}, ${tenantName}`
              ) : (
                <span className="text-muted-ui" aria-hidden>
                  …
                </span>
              )}
            </h1>
            {refreshing ? (
              <Spinner
                className="mt-3"
                size="sm"
                label="Actualizando datos del panel"
              />
            ) : null}
          </>
        )}
        {error ? (
          <p
            className="mt-2 rounded-md border border-error bg-error-bg px-3 py-2 text-sm text-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </header>

      <section aria-label="Indicadores" className="min-w-0">
        <h2 className="text-section text-[var(--color-text)]">Indicadores</h2>
        {loading ? (
          <KpiGridSkeleton />
        ) : (
          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={kpiCard}>
              <p className="text-2xl font-bold tabular-nums text-[var(--color-text)]">
                {kpis?.leadsToday ?? "—"}
              </p>
              <p className="mt-1 text-sm text-muted-ui">Leads hoy</p>
            </div>
            <div className={kpiCard}>
              <p className="text-2xl font-bold tabular-nums text-[var(--color-text)]">
                {kpis?.openConversations ?? "—"}
              </p>
              <p className="mt-1 text-sm text-muted-ui">
                Conversaciones abiertas
              </p>
            </div>
            <div className={kpiCard}>
              <p className="text-2xl font-bold tabular-nums text-[var(--color-text)]">
                {kpis?.salesClosed7d ?? "—"}
              </p>
              <p className="mt-1 text-sm text-muted-ui">
                Ventas cerradas (7 días)
              </p>
            </div>
            <div className={kpiCard}>
              <p className="text-2xl font-bold tabular-nums text-[var(--color-text)]">
                {kpis != null ? `${kpis.conversionPct}%` : "—"}
              </p>
              <p className="mt-1 text-sm text-muted-ui">Conversión</p>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="products-head" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="products-head"
              className="text-section text-[var(--color-text)]"
            >
              Producto destacado
            </h2>
            <p className="mt-1 max-w-4xl text-sm leading-relaxed text-muted-ui">
              Basado en movimientos de stock reales:{" "}
            </p>
          </div>
          <Link
            href="/stock"
            className={cn(
              "text-sm font-medium text-primary no-underline hover:underline",
              loading && "pointer-events-none opacity-60",
            )}
            tabIndex={loading ? -1 : undefined}
            aria-disabled={loading}
          >
            Ver catálogo
          </Link>
        </div>

        {loading ? (
          <ProductHighlightsSkeleton />
        ) : (
          <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
            <div className={cn("min-w-0 divide-y divide-border", card)}>
              <div className="px-4 py-3">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  Más vendido
                </h3>
              </div>
              {(highlights?.topSold?.length ?? 0) === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-ui">
                  Todavía no hay ventas registradas en este período.
                </p>
              ) : (
                (highlights?.topSold ?? []).map((row) => (
                  <div
                    key={row.productId}
                    className="flex min-w-0 items-center gap-3 px-4 py-3"
                  >
                    <StockProductThumb
                      imageUrl={row.imageUrl}
                      name={row.name}
                    />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)]">
                      {row.name}
                    </p>
                    <span className="shrink-0 rounded-pill border border-growth-strong/35 bg-[var(--color-growth-soft)] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--color-text)]">
                      {row.count}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className={cn("min-w-0 divide-y divide-border", card)}>
              <div className="px-4 py-3">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  Más solicitado
                </h3>
              </div>
              {(highlights?.topReserved?.length ?? 0) === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-ui">
                  Sin reservas en este período.
                </p>
              ) : (
                (highlights?.topReserved ?? []).map((row) => (
                  <div
                    key={`r-${row.productId}`}
                    className="flex min-w-0 items-center gap-3 px-4 py-3"
                  >
                    <StockProductThumb
                      imageUrl={row.imageUrl}
                      name={row.name}
                    />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)]">
                      {row.name}
                    </p>
                    <span className="shrink-0 rounded-pill border border-primary/25 bg-[var(--color-primary-ultra-light)] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {row.count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="conv-head" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="conv-head"
              className="text-section text-[var(--color-text)]"
            >
              Conversaciones activas
            </h2>
          </div>
          <Link
            href="/conversations"
            className={cn(
              "text-sm font-medium text-primary no-underline hover:underline",
              loading && "pointer-events-none opacity-60",
            )}
            tabIndex={loading ? -1 : undefined}
            aria-disabled={loading}
          >
            Ver todas
          </Link>
        </div>

        {loading ? (
          <ConversationListSkeleton rows={6} />
        ) : (
          <ul className={cn("mt-4 divide-y divide-border", card)}>
            {conv.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-muted-ui">
                No hay conversaciones abiertas.
              </li>
            ) : (
              conv.map((row) => (
                <li key={row.id}>
                  <Link
                    href={conversationHref(row.phone)}
                    className="flex min-w-0 flex-col gap-2 px-4 py-3 no-underline transition-colors hover:bg-[var(--color-growth-soft)]/40 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--color-text)]">
                          {row.displayName}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-ui">
                        {row.lastMessage}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-ui sm:text-right">
                      {row.timeLabel}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
