"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type InboxItem = {
  suggestionId: string;
  conversationId: string;
  phone: string | null;
  customerName: string | null;
  intent: string | null;
  leadStatus: string | null;
  leadScore: number | null;
  summaryForSeller: string | null;
  nextSellerAction: string | null;
  actionReason: string | null;
  actionUrgency: string | null;
  suggestedLeadStatus: string | null;
  generatedAt: string;
};

type InboxResponse = {
  items: InboxItem[];
  total: number;
};

type UrgencyKey = "all" | "now" | "today" | "this_week" | "low";

const URGENCY_LABEL_ES: Record<string, string> = {
  now: "Ahora",
  today: "Hoy",
  this_week: "Esta semana",
  low: "Baja"
};

const URGENCY_BADGE_CLASS: Record<string, string> = {
  now: "bg-red-100 text-red-800 border-red-300",
  today: "bg-orange-100 text-orange-800 border-orange-300",
  this_week: "bg-yellow-100 text-yellow-800 border-yellow-300",
  low: "bg-slate-100 text-slate-700 border-slate-300"
};

const NEXT_ACTION_LABEL_ES: Record<string, string> = {
  send_payment_link: "Mandar link de pago",
  request_missing_info: "Pedir info faltante",
  confirm_stock_and_reserve: "Confirmar y reservar stock",
  offer_alternative: "Ofrecer alternativa",
  share_catalog_link: "Mandar catálogo",
  schedule_followup: "Agendar follow-up",
  mark_cold: "Marcar como frío",
  escalate_human: "Escalar a humano",
  close_won: "Cerrar como vendido",
  close_lost: "Cerrar como descartado",
  no_action: "Esperar respuesta"
};

const URGENCY_TABS: Array<{ key: UrgencyKey; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "now", label: "Ahora" },
  { key: "today", label: "Hoy" },
  { key: "this_week", label: "Esta semana" },
  { key: "low", label: "Baja" }
];

const getAuth = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

export default function BandejaAccionesPage() {
  const [isMobile, setIsMobile] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [urgency, setUrgency] = useState<UrgencyKey>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = async (selectedUrgency: UrgencyKey, selectedAction: string) => {
    const auth = getAuth();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (selectedUrgency !== "all") params.set("urgency", selectedUrgency);
      if (selectedAction !== "all") params.set("action", selectedAction);
      const qs = params.toString();
      const response = await fetch(
        `${getClientApiBase()}/suggestions/inbox${qs ? `?${qs}` : ""}`,
        {
          headers: {
            "x-tenant-id": auth.tenantId,
            Authorization: `Bearer ${auth.token}`
          },
          cache: "no-store"
        }
      );
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as InboxResponse;
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la bandeja.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(urgency, actionFilter);
  }, [urgency, actionFilter]);

  const counts = useMemo(() => {
    const out: Record<UrgencyKey, number> = { all: items.length, now: 0, today: 0, this_week: 0, low: 0 };
    for (const it of items) {
      const k = (it.actionUrgency as UrgencyKey) ?? "low";
      if (k in out) out[k] += 1;
    }
    return out;
  }, [items]);

  const distinctActions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.nextSellerAction) set.add(it.nextSellerAction);
    return Array.from(set).sort();
  }, [items]);

  return (
    <main
      className={cn(
        "flex bg-canvas text-[var(--color-text)]",
        "h-[100dvh] max-h-[100dvh]",
        isMobile ? "flex-col-reverse" : "flex-row items-stretch"
      )}
    >
      <AppSidebar active="todo" compact={isMobile} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-canvas px-4 py-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-display">Para hacer</h1>
          <p className="mt-1 text-body text-muted-ui">
            Acciones recomendadas por el copiloto sobre conversaciones activas. Ordenado por urgencia.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {URGENCY_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setUrgency(tab.key)}
              className={cn(
                "rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors",
                urgency === tab.key
                  ? "border-primary/30 bg-[var(--badge-active-bg)] text-primary"
                  : "border-border bg-surface text-[var(--color-text)] hover:bg-canvas"
              )}
            >
              {tab.label}
              <span className="ml-1.5 text-muted-ui">({counts[tab.key] ?? 0})</span>
            </button>
          ))}

          {distinctActions.length > 0 ? (
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="ml-auto rounded-md border border-border bg-canvas px-3 py-1.5 text-xs text-[var(--color-text)]"
            >
              <option value="all">Todas las acciones</option>
              {distinctActions.map((a) => (
                <option key={a} value={a}>
                  {NEXT_ACTION_LABEL_ES[a] ?? a}
                </option>
              ))}
            </select>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            onClick={() => void load(urgency, actionFilter)}
            loading={loading}
          >
            Actualizar
          </Button>
        </div>

        {error ? (
          <div className="mb-4 rounded-md border border-error bg-error-bg px-3 py-2 text-body text-error">
            {error}
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size="md" label="Cargando bandeja…" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <p className="text-section">Nada urgente</p>
            <p className="mt-2 text-body text-muted-ui">
              No hay sugerencias frescas que requieran tu acción ahora.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.suggestionId}
                className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/[0.02]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body font-semibold text-[var(--color-text)]">
                        {item.customerName || item.phone || "Cliente"}
                      </span>
                      {item.actionUrgency ? (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            URGENCY_BADGE_CLASS[item.actionUrgency] ??
                              "bg-slate-100 text-slate-700 border-slate-300"
                          )}
                        >
                          {URGENCY_LABEL_ES[item.actionUrgency] ?? item.actionUrgency}
                        </span>
                      ) : null}
                      {item.leadStatus ? (
                        <span className="rounded-full border border-border bg-canvas px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-ui">
                          {item.leadStatus.replace(/_/g, " ")}
                        </span>
                      ) : null}
                    </div>
                    {item.phone && item.customerName ? (
                      <p className="mt-0.5 text-label-ui text-muted-ui">{item.phone}</p>
                    ) : null}
                  </div>
                  {item.phone ? (
                    <Link
                      href={`/conversations/${encodeURIComponent(item.phone)}`}
                      className="rounded-md border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:border-primary/30"
                    >
                      Abrir chat
                    </Link>
                  ) : null}
                </div>

                <div className="mt-3">
                  <p className="text-body font-medium text-[var(--color-text)]">
                    {item.nextSellerAction
                      ? NEXT_ACTION_LABEL_ES[item.nextSellerAction] ?? item.nextSellerAction
                      : "Sin acción sugerida"}
                  </p>
                  {item.actionReason ? (
                    <p className="mt-1 text-label-ui text-muted-ui">{item.actionReason}</p>
                  ) : null}
                </div>

                {item.summaryForSeller ? (
                  <p className="mt-2 text-body text-[var(--color-text)]">{item.summaryForSeller}</p>
                ) : null}

                {item.suggestedLeadStatus ? (
                  <p className="mt-2 text-label-ui text-muted-ui">
                    Sugerencia: mover a{" "}
                    <span className="font-medium text-[var(--color-text)]">
                      {item.suggestedLeadStatus.replace(/_/g, " ")}
                    </span>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
