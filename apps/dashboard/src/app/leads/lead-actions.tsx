"use client";

import { useEffect, useRef, useState } from "react";

interface LeadActionsProps {
  leadId: string;
  phone: string;
}

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api";
const fallbackTenantId = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

export function LeadActions({ leadId, phone }: LeadActionsProps) {
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [token, setToken] = useState("");
  const [tenantId, setTenantId] = useState(fallbackTenantId);
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
    const authToken = window.localStorage.getItem("ws_auth_token") ?? "";
    const authTenant = window.localStorage.getItem("ws_tenant_id") ?? fallbackTenantId;
    setToken(authToken);
    setTenantId(authTenant);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!containerRef.current || !target) return;
      if (!containerRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  const call = async (path: string, method: "PATCH" | "POST", body?: Record<string, string>) => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBase}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-tenant-id": tenantId
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!response.ok) throw new Error(await response.text());
      setMenuOpen(false);
      window.location.reload();
    } catch (error) {
      // eslint-disable-next-line no-alert
      alert(error instanceof Error ? error.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return <div style={{ height: 26 }} />;

  if (!token) {
    return (
      <button
        style={{
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-muted)",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 12
        }}
        onClick={() => {
          window.location.href = "/login";
        }}
      >
        Iniciar sesión
      </button>
    );
  }

  const menuItemBase = {
    width: "100%",
    textAlign: "left" as const,
    border: "none",
    backgroundColor: "transparent",
    padding: "8px 10px",
    fontSize: 12,
    color: "var(--color-text)",
    cursor: "pointer" as const
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        disabled={loading}
        onClick={() => setMenuOpen((open) => !open)}
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          backgroundColor: "var(--color-surface)",
          color: "var(--color-text)",
          fontSize: 18,
          lineHeight: "18px",
          cursor: "pointer",
          display: "grid",
          placeItems: "center"
        }}
      >
        ⋯
      </button>

      {menuOpen ? (
        <div
          style={{
            position: "absolute",
            top: 34,
            right: 0,
            minWidth: 180,
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            backgroundColor: "var(--color-surface)",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
            overflow: "hidden",
            zIndex: 30
          }}
        >
          <button
            type="button"
            disabled={loading}
            onClick={() => call(`/leads/${leadId}/mark-cobrado`, "PATCH")}
            style={{ ...menuItemBase, color: "var(--color-success)", fontWeight: 600 }}
          >
            Confirmar pago y cerrar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => call(`/leads/${leadId}/mark-despachado`, "PATCH")}
            style={menuItemBase}
          >
            Despachar (marcar en gestión)
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => call(`/leads/${leadId}/release-reservation`, "PATCH")}
            style={menuItemBase}
          >
            Liberar reserva
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              const message = window.prompt("Mensaje manual para el cliente:");
              if (!message) return;
              void call(`/conversations/${phone}/reply`, "POST", { message });
            }}
            style={menuItemBase}
          >
            Responder manualmente
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setMenuOpen(false);
              window.open(`/conversations/${encodeURIComponent(phone)}`, "_blank");
            }}
            style={{ ...menuItemBase, borderTop: "1px solid var(--color-border)" }}
          >
            Ver conversación
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              // eslint-disable-next-line no-alert
              const ok = window.confirm(
                "¿Ocultar este contacto del listado? No se borran mensajes ni datos; dejará de aparecer en Clientes y en la lista de conversaciones. Para recuperarlo, abrí el chat con el enlace directo del teléfono y usá «Volver a mostrar en el listado»."
              );
              if (!ok) return;
              void call(`/leads/${leadId}/hide-from-inbox`, "POST");
            }}
            style={{ ...menuItemBase, borderTop: "1px solid var(--color-border)", color: "var(--color-error)" }}
          >
            Ocultar del listado
          </button>
        </div>
      ) : null}
    </div>
  );
}
