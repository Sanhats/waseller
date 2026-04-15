"use client";

import { getClientApiBase } from "@/lib/api-base";
import { useEffect, useMemo, useState } from "react";
import {
  CONVERSATION_STAGE_LABELS_ES,
  CONVERSATION_STATE_LABELS_ES,
  labelConversationStage,
  labelConversationState,
} from "@waseller/shared";
import { LeadActions } from "./lead-actions";
import { AppSidebar } from "../../components/app-sidebar";
import {
  LeadsKanbanSkeleton,
  LeadsTableSkeleton,
} from "@/components/page-skeletons";
import { Spinner } from "@/components/ui";

type Lead = {
  id: string;
  phone: string;
  customerName?: string;
  status: string;
  leadClosed?: boolean;
  /** Uso interno del backend; no mostrar al operador. */
  score?: number;
  hasStockReservation?: boolean;
  reservationExpiresAt?: string;
  profilePictureUrl?: string;
  lastMessage?: string;
  conversationState?: string;
  conversationStage?: string | null;
};

type ViewMode = "table" | "kanban";
type LeadScope = "active" | "closed" | "all";
type PaymentScope = "all" | "pending" | "not_pending";
type ConversationStateFilter = "all" | string;
type ConversationStageFilter = "all" | string;

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";
const orderedStatuses = [
  "listo_para_cobrar",
  "caliente",
  "interesado",
  "consulta",
  "frio",
  "vendido",
  "cerrado",
];

const statusPill: Record<
  string,
  { label: string; border: string; bg: string; color: string }
> = {
  listo_para_cobrar: {
    label: "Pago a confirmar",
    bg: "var(--color-warning-bg)",
    border:
      "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
    color: "var(--color-warning)",
  },
  caliente: {
    label: "En gestión",
    bg: "var(--color-error-bg)",
    border: "1px solid color-mix(in srgb, var(--color-error) 28%, transparent)",
    color: "var(--color-error)",
  },
  interesado: {
    label: "Interesado",
    bg: "var(--color-growth-soft)",
    border:
      "1px solid color-mix(in srgb, var(--color-growth-strong) 45%, transparent)",
    color: "var(--color-text)",
  },
  consulta: {
    label: "Consulta",
    bg: "var(--color-primary-ultra-light)",
    border:
      "1px solid color-mix(in srgb, var(--color-primary) 22%, transparent)",
    color: "var(--color-primary)",
  },
  frio: {
    label: "Nuevo",
    bg: "var(--color-disabled-bg)",
    border: "1px solid var(--color-border)",
    color: "var(--color-muted)",
  },
  vendido: {
    label: "Vendido",
    bg: "var(--color-success-bg)",
    border:
      "1px solid color-mix(in srgb, var(--color-success) 35%, transparent)",
    color: "var(--color-success)",
  },
  cerrado: {
    label: "Descartado",
    bg: "var(--color-disabled-bg)",
    border: "1px solid var(--color-border)",
    color: "var(--color-muted)",
  },
};

const getAuthContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId =
    window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token) return null;
  return { token, tenantId };
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scope, setScope] = useState<LeadScope>("active");
  const [paymentScope, setPaymentScope] = useState<PaymentScope>("all");
  const [conversationStateFilter, setConversationStateFilter] =
    useState<ConversationStateFilter>("all");
  const [conversationStageFilter, setConversationStageFilter] =
    useState<ConversationStageFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [hoveredLeadId, setHoveredLeadId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const auth = getAuthContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }

    const loadLeads = async () => {
      setLoading(true);
      try {
        const includeClosed = scope !== "active";
        const response = await fetch(
          `${getClientApiBase()}/leads${includeClosed ? "?includeClosed=true" : ""}`,
          {
            headers: {
              "x-tenant-id": auth.tenantId,
              Authorization: `Bearer ${auth.token}`,
            },
            cache: "no-store",
          },
        );
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as Lead[];
        setLeads(data);
      } catch (error) {
        // eslint-disable-next-line no-alert
        alert("No se pudo cargar leads. Revisa la sesión y el backend.");
      } finally {
        setLoading(false);
      }
    };

    void loadLeads();
  }, [scope]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const scopeOk =
        scope === "all"
          ? true
          : scope === "active"
            ? !lead.leadClosed
            : Boolean(lead.leadClosed);
      const statusOk =
        statusFilter === "all" ? true : lead.status === statusFilter;
      const paymentOk =
        paymentScope === "all"
          ? true
          : paymentScope === "pending"
            ? lead.status === "listo_para_cobrar"
            : lead.status !== "listo_para_cobrar";
      const convStateOk =
        conversationStateFilter === "all"
          ? true
          : (lead.conversationState ?? "open") === conversationStateFilter;
      const convStageOk =
        conversationStageFilter === "all"
          ? true
          : (lead.conversationStage ?? "") === conversationStageFilter;
      const searchOk =
        search.trim().length === 0
          ? true
          : lead.phone.includes(search) ||
            (lead.customerName ?? "")
              .toLowerCase()
              .includes(search.toLowerCase()) ||
            (lead.lastMessage ?? "")
              .toLowerCase()
              .includes(search.toLowerCase());
      return (
        scopeOk &&
        statusOk &&
        paymentOk &&
        convStateOk &&
        convStageOk &&
        searchOk
      );
    });
  }, [
    leads,
    paymentScope,
    scope,
    search,
    statusFilter,
    conversationStateFilter,
    conversationStageFilter,
  ]);

  const kanbanColumns = useMemo(() => {
    return orderedStatuses.map((status) => ({
      status,
      title: statusPill[status]?.label ?? status,
      items: filteredLeads.filter((lead) => lead.status === status),
    }));
  }, [filteredLeads]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / pageSize));
  const paginatedLeads = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredLeads.slice(start, start + pageSize);
  }, [filteredLeads, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    statusFilter,
    pageSize,
    paymentScope,
    conversationStateFilter,
    conversationStageFilter,
    scope,
  ]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
      }}
    >
      <AppSidebar
        active="leads"
        leadsCount={filteredLeads.length}
        compact={isMobile}
      />

      <section
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--color-bg)",
        }}
      >
        <header
          style={{
            display: "flex",
            flexDirection: "column",
            padding: isMobile ? "14px" : "24px 32px 16px 32px",
            borderBottom: "1px solid var(--color-border)",
            backgroundColor: "var(--color-bg)",
            gap: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: isMobile ? "flex-start" : "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h1
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 600,
                color: "var(--color-text)",
              }}
            >
              Clientes
            </h1>

            <div
              style={{ display: "flex", gap: 8 }}
              role="group"
              aria-label="Tipo de vista"
            >
              <button
                type="button"
                onClick={() => setView("table")}
                style={{
                  border: "1px solid var(--color-border)",
                  backgroundColor:
                    view === "table"
                      ? "var(--color-primary)"
                      : "var(--color-surface)",
                  color:
                    view === "table"
                      ? "var(--color-surface)"
                      : "var(--color-text)",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                Vista tabla
              </button>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "flex-end",
            }}
          >
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Quién mostrar
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as LeadScope)}
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  minWidth: 160,
                }}
              >
                <option value="active">Solo activos (abiertos)</option>
                <option value="closed">Solo cerrados</option>
                <option value="all">Todos</option>
              </select>
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                flex: isMobile ? "1 1 100%" : "1 1 220px",
                minWidth: isMobile ? "100%" : 220,
              }}
            >
              Buscar
              <input
                placeholder="Nombre, WhatsApp o texto del último mensaje"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Etapa de venta
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  minWidth: 180,
                }}
              >
                <option value="all">Todas las etapas</option>
                {orderedStatuses.map((status) => (
                  <option key={status} value={status}>
                    {statusPill[status]?.label ?? status}
                  </option>
                ))}
              </select>
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Cobro
              <select
                value={paymentScope}
                onChange={(event) =>
                  setPaymentScope(event.target.value as PaymentScope)
                }
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  minWidth: 200,
                }}
              >
                <option value="all">Todos</option>
                <option value="pending">Solo con cobro por confirmar</option>
                <option value="not_pending">Sin cobro pendiente</option>
              </select>
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Estado del bot
              <select
                value={conversationStateFilter}
                onChange={(event) =>
                  setConversationStateFilter(
                    event.target.value as ConversationStateFilter,
                  )
                }
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  minWidth: 180,
                }}
              >
                <option value="all">Todos</option>
                {Object.entries(CONVERSATION_STATE_LABELS_ES).map(
                  ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Paso en la venta
              <select
                value={conversationStageFilter}
                onChange={(event) =>
                  setConversationStageFilter(
                    event.target.value as ConversationStageFilter,
                  )
                }
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  maxWidth: 280,
                  minWidth: 200,
                }}
              >
                <option value="all">Todos</option>
                {Object.entries(CONVERSATION_STAGE_LABELS_ES).map(
                  ([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        </header>

        <div
          style={{
            flex: 1,
            padding: isMobile ? "12px 14px" : "16px 24px",
            overflowY: "auto",
          }}
        >
          {loading ? (
            <div className="flex flex-col gap-4" aria-busy="true">
              <Spinner size="sm" label="Cargando clientes" />
              {view === "table" ? (
                <LeadsTableSkeleton />
              ) : (
                <LeadsKanbanSkeleton isMobile={isMobile} />
              )}
            </div>
          ) : view === "table" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  overflowX: "auto",
                  overflowY: "auto",
                  maxHeight: isMobile
                    ? "calc(100vh - 340px)"
                    : "calc(100vh - 300px)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  backgroundColor: "var(--color-surface)",
                  boxShadow:
                    "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
                }}
              >
                <table
                  aria-label="Listado de clientes"
                  style={{
                    width: "100%",
                    minWidth: 1100,
                    borderCollapse: "separate",
                    borderSpacing: 0,
                    textAlign: "left",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        color: "var(--color-muted)",
                        position: "sticky",
                        top: 0,
                        backgroundColor: "var(--color-surface)",
                        zIndex: 1,
                      }}
                    >
                      <th
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          fontSize: 11,
                        }}
                      >
                        Contacto
                      </th>
                      <th
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          fontSize: 11,
                        }}
                      >
                        WhatsApp
                      </th>
                      <th
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          fontSize: 11,
                        }}
                      >
                        Etapa de venta
                      </th>
                      <th
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          fontSize: 11,
                        }}
                      >
                        Estado del bot
                      </th>
                      <th
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          fontSize: 11,
                        }}
                      >
                        Paso en la venta
                      </th>
                      <th
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          fontSize: 11,
                        }}
                      >
                        Reserva de stock
                      </th>
                      <th
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          fontSize: 11,
                        }}
                      >
                        Cobro
                      </th>
                      <th
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          fontSize: 11,
                        }}
                      >
                        Último mensaje
                      </th>
                      <th
                        style={{
                          padding: "8px 10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          fontSize: 11,
                          width: 200,
                        }}
                      >
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLeads.map((lead) => {
                      const pill =
                        statusPill[lead.status] ?? statusPill.consulta;
                      const displayName =
                        lead.customerName?.trim() || lead.phone;
                      return (
                        <tr
                          key={lead.id}
                          onMouseEnter={() => setHoveredLeadId(lead.id)}
                          onMouseLeave={() => setHoveredLeadId(null)}
                          style={{
                            backgroundColor:
                              hoveredLeadId === lead.id
                                ? "var(--color-primary-ultra-light)"
                                : "transparent",
                            transition: "background-color 0.2s ease",
                          }}
                        >
                          <td
                            style={{
                              padding: "8px 10px",
                              color: "var(--color-text)",
                              fontWeight: 500,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              {lead.profilePictureUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={lead.profilePictureUrl}
                                  alt="Profile"
                                  style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: "50%",
                                    objectFit: "cover",
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: "50%",
                                    backgroundColor: "var(--color-disabled-bg)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "var(--color-muted)",
                                    fontSize: 10,
                                    fontWeight: 600,
                                  }}
                                >
                                  {displayName.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <span>{displayName}</span>
                            </div>
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              color: "var(--color-muted)",
                            }}
                          >
                            {lead.phone}
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <span
                              style={{
                                backgroundColor: pill.bg,
                                border: pill.border,
                                color: pill.color,
                                borderRadius: 999,
                                fontSize: 12,
                                padding: "2px 8px",
                                fontWeight: 500,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  backgroundColor: pill.color,
                                  display: "inline-block",
                                }}
                              />
                              {pill.label}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <span
                              style={{
                                backgroundColor: "var(--color-bg)",
                                border: "1px solid var(--color-border)",
                                color: "var(--color-muted)",
                                borderRadius: 999,
                                fontSize: 11,
                                padding: "2px 8px",
                                fontWeight: 500,
                              }}
                            >
                              {labelConversationState(lead.conversationState)}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px", maxWidth: 200 }}>
                            <span
                              style={{
                                backgroundColor: "var(--color-warning-bg)",
                                border:
                                  "1px solid color-mix(in srgb, var(--color-warning) 40%, transparent)",
                                color: "var(--color-warning)",
                                borderRadius: 999,
                                fontSize: 11,
                                padding: "2px 8px",
                                fontWeight: 500,
                                display: "inline-block",
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={labelConversationStage(
                                lead.conversationStage,
                              )}
                            >
                              {labelConversationStage(lead.conversationStage)}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <span
                              style={{
                                backgroundColor: lead.hasStockReservation
                                  ? "var(--color-success-bg)"
                                  : "var(--color-disabled-bg)",
                                border: lead.hasStockReservation
                                  ? "1px solid color-mix(in srgb, var(--color-success) 35%, transparent)"
                                  : "1px solid var(--color-border)",
                                color: lead.hasStockReservation
                                  ? "var(--color-success)"
                                  : "var(--color-muted)",
                                borderRadius: 999,
                                fontSize: 12,
                                padding: "2px 8px",
                                fontWeight: 500,
                              }}
                            >
                              {lead.hasStockReservation
                                ? "Reservado"
                                : "Sin reserva"}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <span
                              style={{
                                backgroundColor:
                                  lead.status === "listo_para_cobrar"
                                    ? "var(--color-primary-ultra-light)"
                                    : "var(--color-disabled-bg)",
                                border:
                                  lead.status === "listo_para_cobrar"
                                    ? "1px solid color-mix(in srgb, var(--color-primary) 28%, transparent)"
                                    : "1px solid var(--color-border)",
                                color:
                                  lead.status === "listo_para_cobrar"
                                    ? "var(--color-primary)"
                                    : "var(--color-muted)",
                                borderRadius: 999,
                                fontSize: 12,
                                padding: "2px 8px",
                                fontWeight: 500,
                              }}
                            >
                              {lead.status === "listo_para_cobrar"
                                ? "Pendiente confirmación"
                                : "Sin pendiente"}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              color: "var(--color-muted)",
                              maxWidth: 220,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {lead.lastMessage || "Sin mensajes recientes"}
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <LeadActions leadId={lead.id} phone={lead.phone} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ color: "var(--color-muted)", fontSize: 13 }}>
                  {filteredLeads.length === 0
                    ? "Mostrando 0 de 0"
                    : `Mostrando ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, filteredLeads.length)} de ${filteredLeads.length}`}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    style={{
                      border: "1px solid var(--color-border)",
                      backgroundColor: "var(--color-surface)",
                      color:
                        page === 1
                          ? "var(--color-disabled)"
                          : "var(--color-text)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: page === 1 ? "not-allowed" : "pointer",
                    }}
                  >
                    Anterior
                  </button>
                  <span style={{ color: "var(--color-muted)", fontSize: 8 }}>
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    style={{
                      border: "1px solid var(--color-border)",
                      backgroundColor: "var(--color-surface)",
                      color:
                        page >= totalPages
                          ? "var(--color-disabled)"
                          : "var(--color-text)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: page >= totalPages ? "not-allowed" : "pointer",
                    }}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "1fr"
                  : "repeat(3, minmax(260px, 1fr))",
                gap: 12,
              }}
            >
              {kanbanColumns.map((column) => {
                const pill = statusPill[column.status] ?? statusPill.consulta;
                return (
                  <section
                    key={column.status}
                    style={{
                      border: "1px solid var(--color-border)",
                      backgroundColor: "var(--color-surface)",
                      borderRadius: 12,
                      minHeight: 220,
                      padding: 10,
                      boxShadow:
                        "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
                    }}
                  >
                    <header
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 10,
                      }}
                    >
                      <span
                        style={{
                          backgroundColor: pill.bg,
                          border: pill.border,
                          color: pill.color,
                          borderRadius: 999,
                          fontSize: 12,
                          padding: "2px 8px",
                          fontWeight: 600,
                        }}
                      >
                        {column.title}
                      </span>
                      <span
                        style={{ color: "var(--color-muted)", fontSize: 12 }}
                      >
                        {column.items.length}
                      </span>
                    </header>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {column.items.map((lead) => {
                        const cardName =
                          lead.customerName?.trim() || lead.phone;
                        const showPhoneLine = Boolean(
                          lead.customerName?.trim(),
                        );
                        return (
                          <article
                            key={lead.id}
                            style={{
                              border: "1px solid var(--color-border)",
                              borderRadius: 10,
                              backgroundColor: "var(--color-surface)",
                              padding: 10,
                            }}
                          >
                            <div
                              style={{
                                color: "var(--color-text)",
                                fontSize: 14,
                                marginBottom: 4,
                                fontWeight: 600,
                              }}
                            >
                              {cardName}
                            </div>
                            {showPhoneLine ? (
                              <div
                                style={{
                                  color: "var(--color-muted)",
                                  fontSize: 12,
                                  marginBottom: 4,
                                }}
                              >
                                {lead.phone}
                              </div>
                            ) : null}
                            <div
                              style={{
                                color: "var(--color-muted)",
                                fontSize: 11,
                                marginBottom: 4,
                              }}
                            >
                              Bot:{" "}
                              {labelConversationState(lead.conversationState)} ·
                              Paso:{" "}
                              {labelConversationStage(lead.conversationStage)}
                            </div>
                            <div
                              style={{
                                color: lead.hasStockReservation
                                  ? "var(--color-success)"
                                  : "var(--color-muted)",
                                fontSize: 12,
                                marginBottom: 6,
                              }}
                            >
                              {lead.hasStockReservation
                                ? "Reserva: activa"
                                : "Reserva: sin asignar"}
                            </div>
                            {lead.status === "listo_para_cobrar" ? (
                              <div
                                style={{
                                  color: "var(--color-primary)",
                                  fontSize: 12,
                                  marginBottom: 6,
                                  fontWeight: 600,
                                }}
                              >
                                Pago pendiente de confirmación
                              </div>
                            ) : null}
                            <div
                              style={{
                                color: "var(--color-muted)",
                                fontSize: 12,
                                marginBottom: 8,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {lead.lastMessage || "Sin mensajes recientes"}
                            </div>
                            <LeadActions leadId={lead.id} phone={lead.phone} />
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
