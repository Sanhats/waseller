"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button, Spinner, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type TenantPresetOption = {
  id: "general" | "indumentaria_calzado" | "electronica" | "hogar_deco" | "belleza_salud";
  label: string;
  profile: Record<string, unknown>;
};

type TenantKnowledgeOverview = {
  knowledge: Record<string, unknown>;
  tenantName?: string;
  persisted?: boolean;
};

export type BusinessContextWizardProps = {
  /**
   * `page`: sidebar + scroll (ruta dedicada con chrome propio).
   * `embedded`: solo el formulario (dentro del paso 3 del onboarding).
   * `content`: mismo cuerpo que page pero sin sidebar ni main (cuando el padre ya es /ops).
   */
  variant?: "page" | "embedded" | "content";
  /** Si MP ya se conectó en onboarding, ocultar el bloque duplicado del paso 2. */
  hideMercadoPagoPanel?: boolean;
  onSaveSuccess?: () => void;
};

type TenantKnowledgeForm = {
  businessCategory: TenantPresetOption["id"];
  businessLabelsCsv: string;
  paymentMethodsCsv: string;
  variantDimensionsCsv: string;
  reservationTtlMinutes: string;
  supportHours: string;
  policyNotes: string;
  allowExchange: boolean;
  allowReturns: boolean;
};

type MercadoPagoStatus = {
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


const ALLOWED_PAYMENT_IDS = ["link_pago", "efectivo_retiro"] as const;
type AllowedPaymentId = (typeof ALLOWED_PAYMENT_IDS)[number];

const PAYMENT_METHOD_OPTIONS: Array<{ id: AllowedPaymentId; label: string }> = [
  { id: "link_pago", label: "Mercado Pago" },
  { id: "efectivo_retiro", label: "Efectivo" }
];
const VARIANT_OPTIONS = ["talle", "color", "modelo", "capacidad", "material"];

const splitCsv = (value: string): string[] =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const joinCsv = (value: unknown): string =>
  Array.isArray(value) ? value.map((item) => String(item)).join(", ") : "";

const toggleValue = (currentCsv: string, value: string): string => {
  const current = splitCsv(currentCsv);
  const lower = value.toLowerCase();
  const exists = current.some((item) => item.toLowerCase() === lower);
  const next = exists ? current.filter((item) => item.toLowerCase() !== lower) : [...current, value];
  return next.join(", ");
};

const DEFAULT_FORM: TenantKnowledgeForm = {
  businessCategory: "general",
  businessLabelsCsv: "",
  paymentMethodsCsv: "link_pago, efectivo_retiro",
  variantDimensionsCsv: "talle, color",
  reservationTtlMinutes: "30",
  supportHours: "",
  policyNotes: "",
  allowExchange: true,
  allowReturns: false
};

type WizardStep = 1 | 2;

const STEP_INDEX: Record<WizardStep, string> = { 1: "1", 2: "2" };

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip content={text} side="bottom" className="ml-1.5 align-middle">
      <button
        type="button"
        className="inline-grid size-[18px] place-items-center rounded-pill border border-border bg-surface text-[11px] font-semibold text-muted transition-colors hover:border-primary/30 hover:text-[var(--color-text)]"
        aria-label="Ayuda"
      >
        i
      </button>
    </Tooltip>
  );
}

function chipClass(active: boolean) {
  return cn(
    "rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors duration-fast",
    active
      ? "border-primary/30 bg-[var(--badge-active-bg)] text-primary"
      : "border-border bg-surface text-[var(--color-text)] hover:bg-canvas"
  );
}

const getAuth = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

const formFromKnowledge = (knowledge: Record<string, unknown>): TenantKnowledgeForm => {
  const payment =
    (knowledge.payment as Record<string, unknown> | undefined) ??
    (knowledge.paymentMethods as Record<string, unknown> | undefined) ??
    {};
  const policy =
    (knowledge.policy as Record<string, unknown> | undefined) ??
    (knowledge.businessPolicy as Record<string, unknown> | undefined) ??
    {};

  return {
    businessCategory: String(knowledge.businessCategory ?? "general") as TenantKnowledgeForm["businessCategory"],
    businessLabelsCsv: joinCsv(knowledge.businessLabels),
    paymentMethodsCsv: (() => {
      const raw = payment.methods ?? payment.available;
      const list = Array.isArray(raw)
        ? raw
            .map((item) => String(item ?? "").trim().toLowerCase())
            .filter((item): item is AllowedPaymentId => ALLOWED_PAYMENT_IDS.includes(item as AllowedPaymentId))
        : [];
      const unique = Array.from(new Set(list));
      return unique.length > 0 ? unique.join(", ") : "link_pago, efectivo_retiro";
    })(),
    variantDimensionsCsv: joinCsv(
      knowledge.productVariantAxes ?? (knowledge.productAttributes as Record<string, unknown> | undefined)?.dimensions
    ),
    reservationTtlMinutes: String(policy.reservationTtlMinutes ?? 30),
    supportHours: String(policy.supportHours ?? ""),
    policyNotes: String(policy.notes ?? ""),
    allowExchange: Boolean(policy.allowExchange ?? true),
    allowReturns: Boolean(policy.allowReturns ?? false)
  };
};

const knowledgeFromForm = (form: TenantKnowledgeForm): Record<string, unknown> => ({
  businessCategory: form.businessCategory,
  businessLabels: splitCsv(form.businessLabelsCsv),
  payment: {
    methods: Array.from(
      new Set(
        splitCsv(form.paymentMethodsCsv)
          .map((item) => item.toLowerCase())
          .filter((item): item is AllowedPaymentId => ALLOWED_PAYMENT_IDS.includes(item as AllowedPaymentId))
      )
    )
  },
  shipping: { methods: [], zones: [], sameDay: false },
  productVariantAxes: splitCsv(form.variantDimensionsCsv),
  policy: {
    reservationTtlMinutes: Math.max(5, Number(form.reservationTtlMinutes || 30)),
    supportHours: form.supportHours.trim() || undefined,
    notes: form.policyNotes.trim() || undefined,
    allowExchange: form.allowExchange,
    allowReturns: form.allowReturns
  }
});

export function BusinessContextWizard({
  variant = "page",
  hideMercadoPagoPanel = false,
  onSaveSuccess
}: BusinessContextWizardProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [presets, setPresets] = useState<TenantPresetOption[]>([]);
  const [form, setForm] = useState<TenantKnowledgeForm>(DEFAULT_FORM);
  const [mercadoPago, setMercadoPago] = useState<MercadoPagoStatus | null>(null);
  const [connectingMercadoPago, setConnectingMercadoPago] = useState(false);
  const [disconnectingMercadoPago, setDisconnectingMercadoPago] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const auth = getAuth();
    if (!auth) {
      window.location.href = "/login";
      return;
    }

    const load = async () => {
      try {
        const [knowledgeRes, presetsRes, mercadoPagoRes] = await Promise.all([
          fetch(`${getClientApiBase()}/ops/tenant-knowledge`, {
            headers: {
              "x-tenant-id": auth.tenantId,
              Authorization: `Bearer ${auth.token}`
            },
            cache: "no-store"
          }),
          fetch(`${getClientApiBase()}/ops/tenant-knowledge/presets`, {
            headers: {
              "x-tenant-id": auth.tenantId,
              Authorization: `Bearer ${auth.token}`
            },
            cache: "no-store"
          }),
          fetch(`${getClientApiBase()}/integrations/mercadopago/status`, {
            headers: {
              "x-tenant-id": auth.tenantId,
              Authorization: `Bearer ${auth.token}`
            },
            cache: "no-store"
          })
        ]);

        if (!knowledgeRes.ok) throw new Error(await knowledgeRes.text());
        if (!presetsRes.ok) throw new Error(await presetsRes.text());
        if (!mercadoPagoRes.ok) throw new Error(await mercadoPagoRes.text());

        const knowledgeBody = (await knowledgeRes.json()) as TenantKnowledgeOverview;
        const presetsBody = (await presetsRes.json()) as { categories: TenantPresetOption[] };
        const mercadoPagoBody = (await mercadoPagoRes.json()) as MercadoPagoStatus;

        setForm(formFromKnowledge((knowledgeBody.knowledge ?? {}) as Record<string, unknown>));
        setPresets(Array.isArray(presetsBody.categories) ? presetsBody.categories : []);
        setMercadoPago(mercadoPagoBody);
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo cargar la configuración.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (event.data?.source !== "mercadopago-oauth") return;
      const auth = getAuth();
      if (!auth) return;
      try {
        const response = await fetch(`${getClientApiBase()}/integrations/mercadopago/status`, {
          headers: {
            "x-tenant-id": auth.tenantId,
            Authorization: `Bearer ${auth.token}`
          },
          cache: "no-store"
        });
        if (!response.ok) throw new Error(await response.text());
        setMercadoPago((await response.json()) as MercadoPagoStatus);
        setMessage("Mercado Pago actualizado correctamente.");
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "No se pudo refrescar Mercado Pago.");
      } finally {
        setConnectingMercadoPago(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const save = async () => {
    const auth = getAuth();
    if (!auth) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${getClientApiBase()}/ops/tenant-knowledge`, {
        method: "PUT",
        headers: {
          "x-tenant-id": auth.tenantId,
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ knowledge: knowledgeFromForm(form) })
      });
      if (!response.ok) throw new Error(await response.text());
      setMessage("Configuración guardada correctamente.");
      onSaveSuccess?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (presetId: TenantPresetOption["id"]) => {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    const next = formFromKnowledge(preset.profile);
    next.businessCategory = presetId;
    setForm(next);
    setMessage(`Preset aplicado: ${preset.label}`);
  };

  const connectMercadoPago = async () => {
    const auth = getAuth();
    if (!auth) return;
    setConnectingMercadoPago(true);
    try {
      const response = await fetch(`${getClientApiBase()}/integrations/mercadopago/connect-url`, {
        headers: {
          "x-tenant-id": auth.tenantId,
          Authorization: `Bearer ${auth.token}`
        }
      });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { url: string };
      const popup = window.open(body.url, "mercadopago-oauth", "width=540,height=720");
      if (!popup) {
        window.location.href = body.url;
        return;
      }
    } catch (err) {
      setConnectingMercadoPago(false);
      setMessage(err instanceof Error ? err.message : "No se pudo iniciar la conexión con Mercado Pago.");
    }
  };

  const disconnectMercadoPago = async () => {
    const auth = getAuth();
    if (!auth) return;
    setDisconnectingMercadoPago(true);
    try {
      const response = await fetch(`${getClientApiBase()}/integrations/mercadopago/disconnect`, {
        method: "POST",
        headers: {
          "x-tenant-id": auth.tenantId,
          Authorization: `Bearer ${auth.token}`
        }
      });
      if (!response.ok) throw new Error(await response.text());
      const statusResponse = await fetch(`${getClientApiBase()}/integrations/mercadopago/status`, {
        headers: {
          "x-tenant-id": auth.tenantId,
          Authorization: `Bearer ${auth.token}`
        },
        cache: "no-store"
      });
      if (!statusResponse.ok) throw new Error(await statusResponse.text());
      setMercadoPago((await statusResponse.json()) as MercadoPagoStatus);
      setMessage("Mercado Pago desconectado.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo desconectar Mercado Pago.");
    } finally {
      setDisconnectingMercadoPago(false);
    }
  };

  const steps: Array<{ id: WizardStep; title: string }> = [
    { id: 1, title: "Rubro" },
    { id: 2, title: "Tienda" }
  ];
  const progressPercent = Math.round((currentStep / steps.length) * 100);
  const selectedPayments = splitCsv(form.paymentMethodsCsv);
  const selectedVariants = splitCsv(form.variantDimensionsCsv);

  const stepValidationErrors: Record<WizardStep, string[]> = {
    1: form.businessCategory ? [] : ["Seleccioná un rubro."],
    2: [
      ...(selectedPayments.length === 0 ? ["Seleccioná al menos un medio de pago."] : []),
      ...(selectedVariants.length === 0 ? ["Seleccioná al menos una variante de producto."] : [])
    ]
  };

  const canGoToStep = (step: WizardStep): boolean => stepValidationErrors[step].length === 0;

  const shell = (
    <section
      className={cn(
        "flex min-w-0 flex-1 flex-col text-[var(--color-text)]",
        variant === "embedded"
          ? "bg-transparent"
          : "overflow-y-auto overscroll-y-contain bg-canvas px-3.5 py-4 md:px-7 md:py-7 lg:min-h-0"
      )}
    >
      {variant !== "embedded" ? (
        <header className="mb-5 min-w-0 md:mb-6">
          <p className="text-label-ui text-muted-ui">Configuración única del sistema</p>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-title">Contexto de la tienda</h1>
              <p className="mt-2 max-w-2xl text-body text-muted-ui">
                Rubro, medios de pago y variantes del catálogo. El nombre del negocio viene del registro.
              </p>
            </div>
            <Button type="button" onClick={() => void save()} disabled={saving} loading={saving} className="shrink-0">
              Guardar cambios
            </Button>
          </div>
        </header>
      ) : null}

      <div className="mb-4 min-w-0 rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/[0.02] md:p-5">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <p className="text-label-ui text-muted-ui">Progreso del asistente</p>
            <p className="text-section mt-0.5">
              Paso {currentStep} de {steps.length}
            </p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-pill bg-[var(--color-disabled-bg)]">
          <div
            className="h-full rounded-pill bg-primary transition-[width] duration-300 ease-default"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {steps.map((step) => {
            const active = currentStep === step.id;
            const completed = currentStep > step.id;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => {
                  if (step.id > currentStep && !canGoToStep(currentStep)) {
                    setMessage(stepValidationErrors[currentStep].join(" "));
                    return;
                  }
                  setCurrentStep(step.id);
                }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors duration-fast",
                  active
                    ? "border-primary/30 bg-[var(--badge-active-bg)] text-primary"
                    : completed
                      ? "border-primary/20 bg-primary/[0.06] text-[var(--color-text)]"
                      : "border-border bg-surface text-muted hover:bg-canvas hover:text-[var(--color-text)]"
                )}
              >
                <span
                  className={cn(
                    "grid size-[18px] place-items-center rounded-pill text-[11px] font-bold",
                    completed || active ? "bg-primary text-white" : "bg-disabled-bg text-muted"
                  )}
                >
                  {completed ? "✓" : STEP_INDEX[step.id]}
                </span>
                {step.title}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <Spinner className="mb-3" size="sm" label="Cargando configuración de la tienda" />
      ) : null}
      {error ? (
        <p className="mb-3 rounded-md border border-error bg-error-bg px-3 py-2 text-body text-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <div className="mb-3 rounded-md border border-border bg-[var(--badge-active-bg)] px-3 py-2 text-body text-primary">
          {message}
        </div>
      ) : null}

      <div
        className={cn(
          "grid min-w-0 gap-4",
          isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_min(280px,32%)]"
        )}
      >
        <div className="min-w-0">
          {currentStep === 1 ? (
            <section className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/[0.02] md:p-6">
              <h2 className="flex items-center text-section">
                Rubro del negocio
                <InfoTip text="Define el marco base del catálogo y las sugerencias del bot para ese rubro." />
              </h2>
              <p className="mt-2 text-body text-muted-ui">
                Elegí el rubro que mejor describe tu tienda; cargamos una base recomendada (etiquetas y ejes típicos).
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {presets.map((preset) => {
                  const active = form.businessCategory === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset.id)}
                      className={chipClass(active)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <section className="rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/[0.02] md:p-6">
              <h2 className="flex items-center text-section">
                Pagos y variantes
                <InfoTip text="Qué puede ofrecer el bot en conversación: medios de cobro y ejes de variante del catálogo." />
              </h2>
              <p className="mt-2 text-body text-muted-ui">
                Mercado Pago y efectivo. El cobro con MP se confirma por webhook; el efectivo lo marcás vos desde la
                conversación. Los envíos se acuerdan por WhatsApp (no se configuran acá).
              </p>

              <div className="mt-5">
                <p className="text-label-ui font-semibold text-[var(--color-text)]">Medios de pago</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PAYMENT_METHOD_OPTIONS.map((option) => {
                    const active = selectedPayments.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            paymentMethodsCsv: toggleValue(current.paymentMethodsCsv, option.id)
                          }))
                        }
                        className={chipClass(active)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedPayments.includes("link_pago") && !hideMercadoPagoPanel ? (
                <div className="mt-5 rounded-lg border border-border bg-canvas p-4">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <p className="text-body font-semibold text-[var(--color-text)]">Mercado Pago</p>
                      <p className="mt-1 text-body text-muted-ui">
                        Conectá la cuenta para generar links de pago reales al cerrar una reserva.
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="bg-primary text-white hover:bg-primary-hover"
                        onClick={() => void connectMercadoPago()}
                        disabled={connectingMercadoPago}
                        loading={connectingMercadoPago}
                      >
                        {mercadoPago?.status === "connected" ? "Reconectar" : "Conectar"}
                      </Button>
                      {mercadoPago?.configured ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void disconnectMercadoPago()}
                          disabled={disconnectingMercadoPago}
                          loading={disconnectingMercadoPago}
                        >
                          Desconectar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-3 text-label-ui text-[var(--color-text)]">
                    Estado:{" "}
                    <span className="font-medium capitalize">{mercadoPago?.status ?? "disconnected"}</span>
                  </p>
                  {mercadoPago?.accountLabel ? (
                    <p className="mt-1 text-label-ui text-primary">Cuenta: {mercadoPago.accountLabel}</p>
                  ) : null}
                  {mercadoPago?.lastError ? (
                    <p className="mt-1 text-label-ui text-error">Último error: {mercadoPago.lastError}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5">
                <p className="text-label-ui font-semibold text-[var(--color-text)]">Variantes del catálogo</p>
                <p className="mt-1 text-body text-muted-ui">Ejes que el bot va a pedir al cotizar (talle, color, etc.).</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {VARIANT_OPTIONS.map((option) => {
                    const active = selectedVariants.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            variantDimensionsCsv: toggleValue(current.variantDimensionsCsv, option)
                          }))
                        }
                        className={chipClass(active)}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {stepValidationErrors[currentStep].length > 0 ? (
            <div
              className="mt-3 rounded-md border border-error bg-error-bg px-3 py-2 text-body text-error"
              role="status"
            >
              {stepValidationErrors[currentStep].join(" ")}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pb-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCurrentStep((prev) => (prev > 1 ? ((prev - 1) as WizardStep) : prev))}
              disabled={currentStep === 1}
            >
              Anterior
            </Button>
            {currentStep === 1 ? (
              <Button
                type="button"
                onClick={() => {
                  if (!canGoToStep(1)) {
                    setMessage(stepValidationErrors[1].join(" "));
                    return;
                  }
                  setCurrentStep(2);
                }}
              >
                Siguiente
              </Button>
            ) : (
              <Button type="button" onClick={() => void save()} disabled={saving || !canGoToStep(2)} loading={saving}>
                Guardar y finalizar
              </Button>
            )}
          </div>
        </div>

        <aside className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-sm ring-1 ring-black/[0.02] lg:sticky lg:top-4 lg:self-start">
          <h3 className="text-section">Resumen</h3>
          <dl className="mt-3 space-y-2 text-body text-[var(--color-text)]">
            <div>
              <dt className="text-label-ui text-muted-ui">Rubro</dt>
              <dd className="mt-0.5 font-medium capitalize">{form.businessCategory.replace(/_/g, " ")}</dd>
            </div>
            <div>
              <dt className="text-label-ui text-muted-ui">Medios de pago</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{selectedPayments.length}</dd>
            </div>
            <div>
              <dt className="text-label-ui text-muted-ui">Variantes</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{selectedVariants.length}</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-border pt-4 text-label-ui text-muted-ui">
            Completá cada paso en orden; podés volver atrás para corregir antes de guardar.
          </p>
        </aside>
      </div>
    </section>
  );

  if (variant === "embedded") {
    return <div className="w-full">{shell}</div>;
  }

  if (variant === "content") {
    return shell;
  }

  return (
    <main
      className={cn(
        "flex min-h-0 bg-canvas text-[var(--color-text)]",
        "h-[100dvh] max-h-[100dvh] flex-col",
        "lg:flex-row lg:items-stretch"
      )}
    >
      <AppSidebar active="ops" compact={isMobile} />
      {shell}
    </main>
  );
}
