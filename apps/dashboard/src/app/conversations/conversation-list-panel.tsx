"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConversationSidebarListSkeleton } from "@/components/page-skeletons";
import { Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";
import { digitsOnlyPhone } from "@waseller/shared";

type Lead = {
  id: string;
  phone: string;
  customerName?: string;
  profilePictureUrl?: string;
  lastMessage?: string;
  status?: string;
};

/** Etiqueta corta del pipeline de ventas (`leads.status`). */
const LEAD_STATUS_LABEL_ES: Record<string, string> = {
  frio: "Nuevo",
  consulta: "Consulta",
  interesado: "Interesado",
  caliente: "En gestión",
  listo_para_cobrar: "Pago a confirmar",
  vendido: "Vendido",
  cerrado: "Cerrado",
};

function labelLeadStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return LEAD_STATUS_LABEL_ES[status] ?? status;
}

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId =
    window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

export function ConversationListPanel() {
  const pathname = usePathname();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const selectedPhone = useMemo(() => {
    const m = pathname.match(/^\/conversations\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }, [pathname]);

  useEffect(() => {
    const auth = authContext();
    if (!auth) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const qs = new URLSearchParams({
          includeClosed: "true",
          includeArchived: "true",
          includeOrphanConversations: "true"
        });
        const response = await fetch(`${getClientApiBase()}/leads?${qs.toString()}`, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as Lead[];
        setLeads(data);
        setError("");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los contactos",
        );
      } finally {
        setLoading(false);
      }
    };

    void load();
    const t = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(t);
  }, []);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (l) =>
        l.phone.includes(q) || (l.customerName ?? "").toLowerCase().includes(q),
    );
  }, [leads, search]);

  return (
    <aside
      className={cn(
        "flex max-h-[42vh] w-full shrink-0 flex-col overflow-hidden border-b border-border bg-surface",
        "shadow-sm ring-1 ring-black/[0.03]",
        "lg:h-full lg:max-h-none lg:w-80 lg:max-w-[20rem] lg:border-b-0 lg:border-r",
      )}
      aria-busy={loading}
    >
      {/* Header */}
      <div
        className="shrink-0 border-b border-border px-4 pb-3 pt-4"
        style={{
          background:
            "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-light) 100%)",
        }}
      >
        <h2 className="text-sm font-bold tracking-wide text-white">
          Conversaciones
        </h2>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o teléfono…"
          aria-label="Buscar conversación"
          className="w-full"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <>
            <div className="flex justify-center px-4 pb-2 pt-4">
              <Spinner size="sm" label="Cargando conversaciones" />
            </div>
            <ConversationSidebarListSkeleton rows={9} />
          </>
        ) : null}
        {error && !loading ? (
          <p className="px-4 py-3 text-center text-body text-error" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error && filteredLeads.length === 0 ? (
          <p className="px-4 py-8 text-center text-body text-muted-ui">
            {leads.length === 0
              ? "No hay conversaciones todavía."
              : "No hay contactos que coincidan."}
          </p>
        ) : null}
        {!loading &&
          !error &&
          filteredLeads.length > 0 &&
          filteredLeads.map((lead) => {
            const displayName = lead.customerName?.trim() || lead.phone;
            const href = `/conversations/${encodeURIComponent(lead.phone)}`;
            const isSelected =
              selectedPhone !== null &&
              digitsOnlyPhone(lead.phone) === digitsOnlyPhone(selectedPhone);
            const initials =
              displayName
                .split(" ")
                .slice(0, 2)
                .map((w: string) => (w[0] ?? "").toUpperCase())
                .join("") || "?";
            const PALETTES = [
              "#2d6e8a","#3d7a6a","#5a7d3a","#7c6a3a","#5a4d8a",
              "#3a6a7c","#6a5a3a","#3a7c5a",
            ];
            const bgColor =
              PALETTES[
                displayName
                  .split("")
                  .reduce((a: number, c: string) => a + c.charCodeAt(0), 0) %
                  PALETTES.length
              ] ?? "#2d6e8a";

            return (
              <Link
                key={lead.id}
                href={href}
                className={cn(
                  "flex items-center gap-3 border-l-[3px] px-3 py-2.5 no-underline transition-colors duration-fast",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                  isSelected
                    ? "border-l-[var(--color-primary)] bg-[var(--color-primary-ultra-light)]"
                    : "border-transparent text-[var(--color-text)] hover:bg-canvas",
                )}
              >
                {/* Avatar */}
                {lead.profilePictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={lead.profilePictureUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: bgColor }}
                  >
                    {initials}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "truncate text-sm font-semibold",
                        isSelected ? "text-primary" : "text-[var(--color-text)]",
                      )}
                    >
                      {displayName}
                    </span>
                    <span
                      className="shrink-0 rounded-pill border border-border bg-disabled-bg px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-ui"
                      title="Estado del lead"
                    >
                      {labelLeadStatus(lead.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-ui">
                    {lead.lastMessage?.trim() || "Sin mensajes"}
                  </p>
                </div>
              </Link>
            );
          })}
      </div>
    </aside>
  );
}
