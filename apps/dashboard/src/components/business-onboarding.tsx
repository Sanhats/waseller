"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { BusinessContextWizard } from "@/components/business-context-wizard";
import { BusinessOnboardingSkeleton } from "@/components/page-skeletons";
import { Badge, Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type OnboardingStep = {
  key: string;
  title: string;
  description: string;
  completed: boolean;
  href: string;
  metric: string;
};

type OnboardingStatus = {
  generatedAt: string;
  tenantName: string;
  allCompleted: boolean;
  completionPercent: number;
  tenantKnowledgePersisted?: boolean;
  crewCommercialContextComplete?: boolean;
  whatsapp: {
    tenantWhatsappNumber: string | null;
    sessionStatus:
      | "connecting"
      | "connected"
      | "disconnected"
      | "qr_required"
      | "not_connected";
    qrAvailable: boolean;
    lastConnectedAt?: string;
    retries?: number;
    lastError?: string;
  };
  mercadoPago: {
    provider: "mercadopago";
    configured: boolean;
    status: "disconnected" | "connected" | "expired" | "error";
    accountId: string | null;
    accountLabel: string | null;
    publicKey: string | null;
    connectedAt: string | null;
    expiresAt: string | null;
    lastError: string | null;
  };
  steps: OnboardingStep[];
};

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId =
    window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

const linkPrimaryClass = cn(
  "inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-[transform,colors] duration-fast",
  "bg-primary hover:bg-primary-hover active:bg-primary-active",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
);

function SetupCard({
  stepLabel,
  title,
  description,
  children,
}: {
  stepLabel: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/[0.02] md:p-6",
      )}
    >
      <p className="text-label-ui text-muted-ui">{stepLabel}</p>
      <h2 className="mt-1 text-section">{title}</h2>
      <p className="mt-2 text-body text-muted-ui">{description}</p>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

/**
 * Flujo de configuración del negocio (WhatsApp, Mercado Pago, contexto + crew, catálogo).
 * Pensado para la ruta /ops (Negocio). El estado “completo” viene de `allCompleted` en el backend (cuatro pasos).
 */
export function BusinessOnboarding() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectingWhatsapp, setConnectingWhatsapp] = useState(false);
  const [connectingMercadoPago, setConnectingMercadoPago] = useState(false);
  const [qrImageUrl, setQrImageUrl] = useState("");
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const reloadOnboardingRef = useRef<(() => Promise<void>) | null>(null);

  const loadQr = async (token: string, tenantId: string) => {
    try {
      const response = await fetch(`${getClientApiBase()}/onboarding/whatsapp/qr.png`, {
        headers: { Authorization: `Bearer ${token}`, "x-tenant-id": tenantId },
        cache: "no-store",
      });
      if (!response.ok) {
        setQrImageUrl("");
        return;
      }
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      setQrImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    } catch {
      setQrImageUrl("");
    }
  };

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }

    const load = async () => {
      try {
        const response = await fetch(`${getClientApiBase()}/onboarding/status`, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await response.text());
        const nextStatus = (await response.json()) as OnboardingStatus;
        setStatus(nextStatus);
        if (nextStatus.whatsapp.qrAvailable) {
          await loadQr(auth.token, auth.tenantId);
        } else {
          setQrImageUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return "";
          });
        }
        setError("");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo cargar el estado de configuración",
        );
      } finally {
        setLoading(false);
      }
    };

    reloadOnboardingRef.current = load;
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onMessage = () => {
      const auth = authContext();
      if (!auth) return;
      void fetch(`${getClientApiBase()}/onboarding/status`, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
        },
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return (await response.json()) as OnboardingStatus;
        })
        .then((nextStatus) => {
          setStatus(nextStatus);
          setError("");
        })
        .catch((err) =>
          setError(
            err instanceof Error
              ? err.message
              : "No se pudo refrescar Mercado Pago",
          ),
        )
        .finally(() => setConnectingMercadoPago(false));
    };
    const handler = (event: MessageEvent) => {
      if (event.data?.source !== "mercadopago-oauth") return;
      onMessage();
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    return () => {
      if (qrImageUrl) URL.revokeObjectURL(qrImageUrl);
    };
  }, [qrImageUrl]);

  const stepDone = (key: string) =>
    Boolean(status?.steps.find((s) => s.key === key)?.completed);
  const waDone = stepDone("connect_whatsapp");
  const mpDone = stepDone("connect_mercadopago");
  const businessDone = stepDone("configure_business");
  const catalogDone = stepDone("create_catalog");
  const businessStep = status?.steps.find((s) => s.key === "configure_business");
  const catalogStep = status?.steps.find((s) => s.key === "create_catalog");
  const completedCount = status?.steps.filter((s) => s.completed).length ?? 0;
  const totalSteps = status?.steps.length ?? 4;

  const showWhatsapp = Boolean(status && !waDone);
  const showMercadoPago = Boolean(status && waDone && !mpDone);
  const showBusinessContext = Boolean(
    status && waDone && mpDone && !businessDone,
  );
  const showCatalog = Boolean(
    status && waDone && mpDone && businessDone && !catalogDone,
  );
  /** Una sola fuente de verdad con el backend: no se muestra “completo” hasta los cuatro pasos. */
  const showAllDone = Boolean(status?.allCompleted);

  const connectWhatsapp = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setConnectingWhatsapp(true);
    try {
      const hasTenantNumber = Boolean(
        status?.whatsapp.tenantWhatsappNumber?.trim(),
      );
      let whatsappNumber = "";
      if (!hasTenantNumber) {
        const input = window.prompt(
          "Ingresá el número de WhatsApp del negocio (solo dígitos, con código de país):",
        );
        if (!input) {
          setConnectingWhatsapp(false);
          return;
        }
        whatsappNumber = input.trim();
      }
      const response = await fetch(`${getClientApiBase()}/onboarding/whatsapp/connect`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(whatsappNumber ? { whatsappNumber } : {}),
      });
      if (!response.ok) throw new Error(await response.text());
      const refresh = await fetch(`${getClientApiBase()}/onboarding/status`, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
        },
        cache: "no-store",
      });
      if (refresh.ok) {
        const nextStatus = (await refresh.json()) as OnboardingStatus;
        setStatus(nextStatus);
        if (nextStatus.whatsapp.qrAvailable) {
          await loadQr(auth.token, auth.tenantId);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(
        err instanceof Error
          ? err.message
          : "No se pudo iniciar conexion de WhatsApp",
      );
    } finally {
      setConnectingWhatsapp(false);
    }
  };

  const connectMercadoPago = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setConnectingMercadoPago(true);
    try {
      const response = await fetch(
        `${getClientApiBase()}/integrations/mercadopago/connect-url`,
        {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
        },
      );
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { url: string };
      const popup = window.open(
        body.url,
        "mercadopago-oauth",
        "width=540,height=720",
      );
      if (!popup) {
        window.location.href = body.url;
        return;
      }
    } catch (err) {
      setConnectingMercadoPago(false);
      // eslint-disable-next-line no-alert
      alert(
        err instanceof Error
          ? err.message
          : "No se pudo iniciar la conexión con Mercado Pago",
      );
    }
  };

  return (
    <>
      <header className="mb-6 min-w-0 md:mb-8">
        <h1 className="text-title mt-1">Configuración del negocio</h1>
        {status?.tenantName ? (
          <p className="mt-1 break-words text-section text-[var(--color-text)]">
            {status.tenantName}
          </p>
        ) : null}
      </header>

      {loading ? (
        <div className="space-y-4" aria-busy="true">
          <Spinner size="sm" label="Cargando configuración del negocio" />
          <BusinessOnboardingSkeleton />
        </div>
      ) : null}
      {error ? (
        <p
          className="rounded-md border border-error bg-error-bg px-3 py-2 text-body text-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {!loading && status && !showAllDone ? (
        <div className="mb-6 min-w-0 rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/[0.02] md:p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-label-ui text-muted-ui">Progreso</p>
              <p className="text-section mt-0.5">
                {completedCount}/{totalSteps} pasos · {status.completionPercent}
                %
              </p>
            </div>
            <Badge variant="active" className="w-fit">
              {completedCount === 0
                ? "Empezá por WhatsApp"
                : completedCount < totalSteps
                  ? "Seguí con el siguiente paso"
                  : ""}
            </Badge>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-pill bg-[var(--color-disabled-bg)]">
            <div
              className="h-full rounded-pill bg-primary transition-[width] duration-300 ease-default"
              style={{ width: `${status.completionPercent}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex min-w-0 w-full max-w-3xl flex-col gap-6">
        {showWhatsapp ? (
          <SetupCard
            stepLabel={`Paso 1 de ${totalSteps}`}
            title="Vincular WhatsApp"
            description="Conectá la sesión del negocio para recibir y enviar mensajes desde Waseller."
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="space-y-1 text-body">
                <p className="text-muted-ui">
                  Número del negocio:{" "}
                  <span className="font-medium text-[var(--color-text)]">
                    {status?.whatsapp.tenantWhatsappNumber ?? "—"}
                  </span>
                </p>
                <p>
                  Estado:{" "}
                  <span className="font-medium capitalize">
                    {status?.whatsapp.sessionStatus ?? "not_connected"}
                  </span>
                </p>
                {status?.whatsapp.lastError ? (
                  <p className="text-sm text-error">
                    Último error: {status.whatsapp.lastError}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="primary"
                onClick={() => void connectWhatsapp()}
                disabled={
                  connectingWhatsapp ||
                  status?.whatsapp.sessionStatus === "connected"
                }
                loading={connectingWhatsapp}
                className="shrink-0"
              >
                {status?.whatsapp.sessionStatus === "connected"
                  ? "WhatsApp conectado"
                  : "Conectar WhatsApp"}
              </Button>
            </div>

            {status?.whatsapp.qrAvailable ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div
                  className={cn(
                    "grid aspect-square w-full max-w-[220px] place-items-center overflow-hidden rounded-lg border border-border bg-surface",
                    isMobile && "mx-auto max-w-full",
                  )}
                >
                  {qrImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrImageUrl}
                      alt="Código QR de WhatsApp"
                      className="size-full object-contain"
                    />
                  ) : (
                    <Spinner size="lg" label="Cargando código QR de WhatsApp" />
                  )}
                </div>
                <p className="max-w-md text-body text-muted-ui">
                  Escaneá este código desde la app de WhatsApp del número del
                  negocio. El estado se actualiza solo.
                </p>
              </div>
            ) : null}
          </SetupCard>
        ) : null}

        {showMercadoPago ? (
          <SetupCard
            stepLabel={`Paso 2 de ${totalSteps}`}
            title="Conectar Mercado Pago"
            description="Vinculá tu cuenta para generar links de pago desde cada conversación."
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="space-y-1 text-body">
                <p>
                  Estado:{" "}
                  <span className="font-medium capitalize">
                    {status?.mercadoPago.status ?? "disconnected"}
                  </span>
                </p>
                {status?.mercadoPago.accountLabel ? (
                  <p className="text-sm text-muted-ui">
                    Cuenta: {status.mercadoPago.accountLabel}
                  </p>
                ) : null}
                {status?.mercadoPago.connectedAt ? (
                  <p className="text-sm text-muted-ui">
                    Conectado desde:{" "}
                    {new Date(status.mercadoPago.connectedAt).toLocaleString(
                      "es-AR",
                    )}
                  </p>
                ) : null}
                {status?.mercadoPago.lastError ? (
                  <p className="text-sm text-error">
                    Último error: {status.mercadoPago.lastError}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                onClick={() => void connectMercadoPago()}
                disabled={connectingMercadoPago}
                loading={connectingMercadoPago}
                className="shrink-0"
              >
                {status?.mercadoPago.status === "connected"
                  ? "Reconectar Mercado Pago"
                  : "Conectar Mercado Pago"}
              </Button>
            </div>
          </SetupCard>
        ) : null}

        {showBusinessContext ? (
          <SetupCard
            stepLabel={`Paso 3 de ${totalSteps}`}
            title="Contexto de la tienda"
            description={`Rubro, pagos, variantes y un bloque para el asistente (tono + entregas) que se envía a waseller-crew. El nombre “${status?.tenantName ?? "tu negocio"}” se usa por defecto si no cargás otro.`}
          >
            {status?.tenantKnowledgePersisted === true &&
            status?.crewCommercialContextComplete === false ? (
              <p
                className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] px-3 py-2 text-body text-[var(--color-text)]"
                role="status"
              >
                El onboarding sigue abierto en este paso: ya hay datos guardados, pero falta{" "}
                <strong className="font-semibold">tono</strong> y{" "}
                <strong className="font-semibold">entregas</strong> en el paso &quot;Asistente&quot; del formulario
                para cerrarlo y que el crew reciba el contexto completo.
              </p>
            ) : null}
            <div className="min-w-0 max-w-full overflow-x-auto">
              <BusinessContextWizard
                variant="embedded"
                hideMercadoPagoPanel={mpDone}
                onSaveSuccess={() => void reloadOnboardingRef.current?.()}
              />
            </div>
          </SetupCard>
        ) : null}

        {showCatalog ? (
          <SetupCard
            stepLabel={`Paso 4 de ${totalSteps}`}
            title="Cargar productos"
            description="Necesitamos al menos 3 productos en el catálogo para recomendaciones y stock coherentes."
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-body text-muted-ui">
                Progreso del catálogo:{" "}
                <span className="font-semibold text-[var(--color-text)]">
                  {catalogStep?.metric ?? "0/3 productos"}
                </span>
              </p>
              <Link href="/stock" className={linkPrimaryClass}>
                Ir a Stock
              </Link>
            </div>
          </SetupCard>
        ) : null}

        {showAllDone ? (
          <>
            <section className="min-w-0 rounded-lg border border-border bg-surface p-6 shadow-md ring-1 ring-primary/10 md:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--badge-active-bg)] text-primary">
                  <CheckCircle2 className="size-7" aria-hidden />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <h2 className="text-section">
                    Configuración inicial completa
                  </h2>
                  <p className="text-body text-muted-ui">
                    Los cuatro pasos están completos (incluido tono y entregas para el asistente). Podés operar desde
                    Leads y Conversaciones.
                  </p>
                  <div className="flex min-w-0 flex-wrap gap-3 pt-2">
                    <Link
                      href="/leads"
                      className={cn(
                        linkPrimaryClass,
                        "bg-growth text-[var(--color-text)] hover:bg-growth-hover active:bg-growth-strong",
                      )}
                    >
                      Ir a Leads
                    </Link>
                    <Link
                      href="/stock"
                      className={cn(
                        "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-[var(--color-text)] shadow-sm",
                        "hover:bg-canvas",
                      )}
                    >
                      Gestionar stock
                    </Link>
                    <Link
                      href="/conversations"
                      className={cn(
                        "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 py-2.5 text-sm font-medium text-primary shadow-sm",
                        "hover:bg-canvas",
                      )}
                    >
                      Ir a conversaciones
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
