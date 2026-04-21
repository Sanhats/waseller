"use client";

import Link from "next/link";
import {
  MessageSquare,
  Percent,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
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

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words
    .slice(0, 2)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("") || "?";
}

const AVATAR_PALETTES = [
  "#2d6e8a",
  "#3d7a6a",
  "#5a7d3a",
  "#7c6a3a",
  "#5a4d8a",
  "#3a6a7c",
  "#6a5a3a",
  "#3a7c5a",
];

function avatarBg(name: string): string {
  const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length] ?? "#2d6e8a";
}

const card =
  "rounded-xl border border-border bg-surface shadow-sm ring-1 ring-black/[0.03]";

const stateBadge: Record<ConversationRowState, string> = {
  nuevo:
    "border border-[var(--color-growth-strong)]/30 bg-[var(--color-growth-soft)] text-[var(--color-text)]",
  activo:
    "border border-primary/20 bg-[var(--color-primary-ultra-light)] text-primary",
  esperando:
    "border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] text-[var(--color-warning)]",
};

const stateLabel: Record<ConversationRowState, string> = {
  nuevo: "Nuevo",
  activo: "Activo",
  esperando: "Esperando",
};

const stateDot: Record<ConversationRowState, string> = {
  nuevo: "bg-[var(--color-growth-strong)]",
  activo: "bg-primary",
  esperando: "bg-[var(--color-warning)]",
};

/* ── Skeletons ─────────────────────────────────────────── */

function KpiGridSkeleton() {
  return (
    <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col justify-center rounded-xl border border-border bg-surface px-5 py-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-2">
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductHighlightsSkeleton() {
  return (
    <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2" aria-hidden>
      {[0, 1].map((col) => (
        <div key={col} className={cn("divide-y divide-border overflow-hidden", card)}>
          <div className="px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-[min(100%,14rem)]" />
              </div>
              <Skeleton className="h-6 w-9 shrink-0 rounded-pill" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ConversationListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className={cn("mt-4 divide-y divide-border overflow-hidden", card)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-[min(100%,12rem)]" />
            <Skeleton className="h-3.5 w-full max-w-xs" />
          </div>
          <Skeleton className="h-3 w-12 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

/* ── KPI card config ───────────────────────────────────── */

type KpiConfig = {
  value: string | number;
  label: string;
  Icon: typeof TrendingUp;
  accentBorder: string;
  iconWrapperBg: string;
  iconColor: string;
};

/* ── Main component ────────────────────────────────────── */

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
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    setHeaderGreeting(greetingForHour(new Date()));
  }, []);

  const tenantName = summary?.tenantName?.trim() || "tu negocio";
  const conv = summary?.conversationList ?? [];
  const kpis = summary?.kpis;
  const highlights = summary?.productHighlights;

  const kpiCards: KpiConfig[] = [
    {
      value: kpis?.leadsToday ?? "—",
      label: "Leads hoy",
      Icon: TrendingUp,
      accentBorder: "border-l-[3px] border-l-[var(--color-growth-strong)]",
      iconWrapperBg: "bg-[var(--color-growth-soft)]",
      iconColor: "text-[var(--color-growth-strong)]",
    },
    {
      value: kpis?.openConversations ?? "—",
      label: "Conversaciones abiertas",
      Icon: MessageSquare,
      accentBorder: "border-l-[3px] border-l-primary",
      iconWrapperBg: "bg-[var(--color-primary-ultra-light)]",
      iconColor: "text-primary",
    },
    {
      value: kpis?.salesClosed7d ?? "—",
      label: "Ventas (7 días)",
      Icon: ShoppingBag,
      accentBorder: "border-l-[3px] border-l-[var(--color-success)]",
      iconWrapperBg: "bg-[var(--color-success-bg)]",
      iconColor: "text-[var(--color-success)]",
    },
    {
      value: kpis != null ? `${kpis.conversionPct}%` : "—",
      label: "Conversión",
      Icon: Percent,
      accentBorder: "border-l-[3px] border-l-[var(--color-warning)]",
      iconWrapperBg: "bg-[var(--color-warning-bg)]",
      iconColor: "text-[var(--color-warning)]",
    },
  ];

  return (
    <div
      className="mx-auto flex w-full min-w-0 max-w-[min(88rem,100%)] flex-col gap-7 pb-6 lg:gap-8"
      aria-busy={loading || refreshing}
    >
      {/* ── Header ─────────────────────────────────────── */}
      <header className="min-w-0 animate-fade-in-up">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-[min(100%,22rem)] max-w-full" />
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="mb-0.5 text-sm text-muted-ui">
                {headerGreeting ?? "…"}
              </p>
              <h1 className="text-2xl font-black leading-tight text-[var(--color-text)] sm:text-3xl">
                <span
                  className="text-primary"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-light) 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  {tenantName}
                </span>
              </h1>
            </div>
            {refreshing && (
              <Spinner
                className="mt-1 shrink-0"
                size="sm"
                label="Actualizando datos del panel"
              />
            )}
          </div>
        )}
        {error ? (
          <p
            className="mt-3 rounded-lg border border-error bg-error-bg px-3 py-2.5 text-sm text-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </header>

      {/* ── KPIs ───────────────────────────────────────── */}
      <section aria-label="Indicadores" className="min-w-0">
        <h2 className="text-section text-[var(--color-text)]">Indicadores</h2>

        {loading ? (
          <KpiGridSkeleton />
        ) : (
          <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kpiCards.map((cfg, i) => (
              <div
                key={cfg.label}
                className={cn(
                  "flex flex-col justify-center rounded-xl border border-border bg-surface px-5 py-4 shadow-sm",
                  "ring-1 ring-black/[0.03] transition-shadow hover:shadow-md",
                  "animate-fade-in-up",
                  cfg.accentBorder,
                )}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-3xl font-black tabular-nums leading-none text-[var(--color-text)]">
                      {cfg.value}
                    </p>
                    <p className="mt-2 text-[13px] leading-snug text-muted-ui">
                      {cfg.label}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      cfg.iconWrapperBg,
                    )}
                  >
                    <cfg.Icon size={18} className={cfg.iconColor} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Product highlights ─────────────────────────── */}
      <section aria-labelledby="products-head" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="products-head"
            className="text-section text-[var(--color-text)]"
          >
            Productos destacados
          </h2>
          <Link
            href="/stock"
            className={cn(
              "text-sm font-medium text-primary no-underline hover:underline",
              loading && "pointer-events-none opacity-60",
            )}
            tabIndex={loading ? -1 : undefined}
            aria-disabled={loading}
          >
            Ver catálogo →
          </Link>
        </div>

        {loading ? (
          <ProductHighlightsSkeleton />
        ) : (
          <div className="mt-3 grid min-w-0 gap-4 lg:grid-cols-2">
            {/* Más vendido */}
            <div
              className={cn(
                "min-w-0 divide-y divide-border overflow-hidden animate-fade-in-up",
                card,
              )}
              style={{ animationDelay: "120ms" }}
            >
              <div
                className="px-4 py-3"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-light) 100%)",
                }}
              >
                <h3 className="text-sm font-semibold text-white">
                  Más vendido
                </h3>
              </div>
              {(highlights?.topSold?.length ?? 0) === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-ui">
                  Todavía no hay ventas registradas en este período.
                </p>
              ) : (
                (highlights?.topSold ?? []).map((row, i) => (
                  <div
                    key={row.productId}
                    className="flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-growth-soft)]/60"
                    style={{ animationDelay: `${140 + i * 40}ms` }}
                  >
                    <StockProductThumb
                      imageUrl={row.imageUrl}
                      name={row.name}
                    />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)]">
                      {row.name}
                    </p>
                    <span className="shrink-0 rounded-pill border border-[var(--color-growth-strong)]/30 bg-[var(--color-growth-soft)] px-2.5 py-0.5 text-xs font-bold tabular-nums text-[var(--color-text)]">
                      {row.count}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Más solicitado */}
            <div
              className={cn(
                "min-w-0 divide-y divide-border overflow-hidden animate-fade-in-up",
                card,
              )}
              style={{ animationDelay: "180ms" }}
            >
              <div
                className="px-4 py-3"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-growth-strong) 0%, var(--color-growth-base) 100%)",
                }}
              >
                <h3 className="text-sm font-semibold text-[var(--color-primary-active)]">
                  Más solicitado
                </h3>
              </div>
              {(highlights?.topReserved?.length ?? 0) === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-ui">
                  Sin reservas en este período.
                </p>
              ) : (
                (highlights?.topReserved ?? []).map((row, i) => (
                  <div
                    key={`r-${row.productId}`}
                    className="flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-primary-ultra-light)]/70"
                    style={{ animationDelay: `${200 + i * 40}ms` }}
                  >
                    <StockProductThumb
                      imageUrl={row.imageUrl}
                      name={row.name}
                    />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)]">
                      {row.name}
                    </p>
                    <span className="shrink-0 rounded-pill border border-primary/20 bg-[var(--color-primary-ultra-light)] px-2.5 py-0.5 text-xs font-bold tabular-nums text-primary">
                      {row.count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Conversaciones activas ─────────────────────── */}
      <section aria-labelledby="conv-head" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="conv-head"
            className="text-section text-[var(--color-text)]"
          >
            Conversaciones activas
          </h2>
          <Link
            href="/conversations"
            className={cn(
              "text-sm font-medium text-primary no-underline hover:underline",
              loading && "pointer-events-none opacity-60",
            )}
            tabIndex={loading ? -1 : undefined}
            aria-disabled={loading}
          >
            Ver todas →
          </Link>
        </div>

        {loading ? (
          <ConversationListSkeleton rows={6} />
        ) : (
          <ul
            className={cn("mt-3 divide-y divide-border overflow-hidden", card)}
          >
            {conv.length === 0 ? (
              <li className="px-4 py-10 text-center text-sm text-muted-ui">
                No hay conversaciones abiertas.
              </li>
            ) : (
              conv.map((row, i) => (
                <li
                  key={row.id}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${240 + i * 45}ms` }}
                >
                  <Link
                    href={conversationHref(row.phone)}
                    className={cn(
                      "flex min-w-0 items-center gap-3 px-4 py-3 no-underline",
                      "transition-colors hover:bg-[var(--color-growth-soft)]/50",
                    )}
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                        style={{ backgroundColor: avatarBg(row.displayName) }}
                      >
                        {getInitials(row.displayName)}
                      </div>
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--color-surface)]",
                          stateDot[row.state],
                        )}
                      />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-[var(--color-text)]">
                          {row.displayName}
                        </span>
                        <span
                          className={cn(
                            "rounded-pill px-2 py-px text-[10px] font-semibold leading-snug",
                            stateBadge[row.state],
                          )}
                        >
                          {stateLabel[row.state]}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-ui">
                        {row.lastMessage}
                      </p>
                    </div>

                    {/* Time */}
                    <span className="shrink-0 text-xs tabular-nums text-muted-ui">
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
