"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getClientApiBase } from "@/lib/api-base";
import { cn } from "@/lib/cn";

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

function authHeaders(): HeadersInit | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { Authorization: `Bearer ${token}`, "x-tenant-id": tenantId };
}

type OnboardingStatus = {
  crewCommercialContextComplete?: boolean;
};

/**
 * Aviso fijo en todas las pantallas con sidebar: el crew recibe mejor contexto cuando el perfil comercial está completo.
 */
export function BusinessProfileIncompleteBanner() {
  const [show, setShow] = useState(false);

  const check = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) {
      setShow(false);
      return;
    }
    try {
      const res = await fetch(`${getClientApiBase()}/onboarding/status`, { headers });
      if (!res.ok) {
        setShow(false);
        return;
      }
      const data = (await res.json()) as OnboardingStatus;
      setShow(data.crewCommercialContextComplete === false);
    } catch {
      setShow(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [check]);

  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.paddingTop;
    document.body.style.paddingTop = "2.75rem";
    return () => {
      document.body.style.paddingTop = prev;
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      id="waseller-profile-incomplete-banner"
      role="status"
      className={cn(
        "fixed left-0 right-0 top-0 z-[200] flex min-h-[2.75rem] items-center justify-center gap-2 border-b border-[var(--color-warning)]/35",
        "bg-[var(--color-warning-bg)] px-3 py-2 text-center text-sm text-[var(--color-text)] shadow-sm",
      )}
    >
      <AlertTriangle className="size-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
      <span className="min-w-0 leading-snug">
        Completá el perfil de tu negocio (tono y entregas en <strong className="font-semibold">Negocio</strong>) para
        que waseller-crew responda alineado a tu operación.
      </span>
      <Link
        href="/ops"
        className="shrink-0 rounded-md bg-[var(--color-warning)] px-2.5 py-1 text-xs font-semibold text-white no-underline hover:opacity-95"
      >
        Ir a Negocio
      </Link>
    </div>
  );
}
