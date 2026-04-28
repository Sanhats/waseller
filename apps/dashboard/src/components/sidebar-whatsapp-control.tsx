"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, MessageCircleOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

type WhatsappState = {
  tenantWhatsappNumber: string | null;
  sessionStatus:
    | "connecting"
    | "connected"
    | "disconnected"
    | "qr_required"
    | "not_connected";
  qrAvailable: boolean;
};

function authHeaders(): HeadersInit | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { Authorization: `Bearer ${token}`, "x-tenant-id": tenantId };
}

function readJwtRole(): string | null {
  try {
    const token = window.localStorage.getItem("ws_auth_token") ?? "";
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

function isConnectedLike(s: WhatsappState | null): boolean {
  if (!s) return false;
  return (
    s.sessionStatus === "connected" ||
    s.sessionStatus === "connecting" ||
    s.sessionStatus === "qr_required"
  );
}

export function SidebarWhatsappControl({ compact = false }: { compact?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [state, setState] = useState<WhatsappState | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
    setRole(readJwtRole());
  }, []);

  const load = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) {
      setLoading(false);
      return;
    }
    setError("");
    try {
      const res = await fetch(`${getClientApiBase()}/onboarding/whatsapp/session`, {
        headers,
        cache: "no-store"
      });
      if (!res.ok) throw new Error(await res.text());
      setState((await res.json()) as WhatsappState);
    } catch {
      setState(null);
      setError("No se pudo leer el estado de WhatsApp.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggle = async () => {
    const headers = authHeaders();
    if (!headers) return;
    setError("");
    setActing(true);
    try {
      if (isConnectedLike(state)) {
        const ok = window.confirm(
          "¿Desconectar WhatsApp? El sistema dejará de recibir y enviar mensajes hasta que vuelvas a conectar."
        );
        if (!ok) {
          setActing(false);
          return;
        }
        const res = await fetch(`${getClientApiBase()}/onboarding/whatsapp/disconnect`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: "{}"
        });
        if (!res.ok) throw new Error(await res.text());
        setState((await res.json()) as WhatsappState);
      } else {
        const res = await fetch(`${getClientApiBase()}/onboarding/whatsapp/connect`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: "{}"
        });
        if (!res.ok) throw new Error(await res.text());
        setState((await res.json()) as WhatsappState);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setActing(false);
    }
  };

  // Evita mismatch de hidratación: en SSR no existe `window/localStorage`.
  // Renderizamos null hasta montar, y recién ahí decidimos si mostrar el control.
  if (!mounted) return null;
  if (role === "viewer") return null;
  const headersOnClient = authHeaders();
  if (!headersOnClient) return null;

  const connectedLike = isConnectedLike(state);
  const statusLabel =
    state?.sessionStatus === "connected"
      ? "Conectado"
      : state?.sessionStatus === "qr_required"
        ? "Esperando QR"
        : state?.sessionStatus === "connecting"
          ? "Conectando…"
          : state?.sessionStatus === "disconnected"
            ? "Desconectado"
            : "Sin sesión";

  return (
    <div
      className={cn(
        "border-t border-white/15",
        compact ? "mt-1 px-0.5 pt-2" : "mt-auto px-1 pt-4",
      )}
    >
      <div
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/55",
          compact && "justify-center",
        )}
      >
        <MessageCircle size={12} className="shrink-0 text-white/70" aria-hidden />
        {!compact ? <span>WhatsApp</span> : null}
      </div>
      {loading ? (
        <p className={cn("text-xs text-white/65", compact ? "text-center" : "px-1")}>Cargando estado…</p>
      ) : (
        <>
          {!compact ? (
            <p className="mb-2 truncate px-0.5 text-xs text-white/80" title={state?.tenantWhatsappNumber ?? ""}>
              {state?.tenantWhatsappNumber ? `Número: ${state.tenantWhatsappNumber}` : "Sin número en perfil"}
            </p>
          ) : null}
          <p className={cn("mb-2 text-[11px] text-white/70", compact ? "text-center" : "px-0.5")}>{statusLabel}</p>
          <Button
            type="button"
            variant="secondary"
            loading={acting}
            disabled={!state?.tenantWhatsappNumber && !connectedLike}
            className={cn(
              "w-full border border-white/25 bg-white/10 text-white shadow-none",
              "hover:bg-white/18 hover:text-white",
              "focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
              compact ? "!min-h-9 !px-2 !py-2 !text-xs" : "!text-sm",
            )}
            onClick={() => void onToggle()}
          >
            {connectedLike ? (
              <>
                <MessageCircleOff size={16} className="shrink-0" aria-hidden />
                Desconectar
              </>
            ) : (
              <>
                <MessageCircle size={16} className="shrink-0" aria-hidden />
                Conectar
              </>
            )}
          </Button>
          {error ? (
            <p className="mt-1.5 px-0.5 text-center text-[11px] leading-snug text-amber-200/95" role="alert">
              {error}
            </p>
          ) : null}
          {!state?.tenantWhatsappNumber && !connectedLike ? (
            <p className="mt-1 px-0.5 text-center text-[11px] leading-snug text-white/60">
              Configurá el número en registro u onboarding para conectar.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
