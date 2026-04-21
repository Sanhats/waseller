"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    if (!email.trim()) {
      setFormError("Ingresá tu email.");
      return;
    }
    if (!password) {
      setFormError("Ingresá tu contraseña.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${getClientApiBase()}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { token: string; tenantId: string; email?: string };
      window.localStorage.setItem("ws_auth_token", body.token);
      window.localStorage.setItem("ws_tenant_id", body.tenantId);
      if (body.email) window.localStorage.setItem("ws_user_email", body.email);
      window.location.href = "/";
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  const registerTenant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    const normalizedWhatsapp = whatsappNumber.replace(/[^\d]/g, "");
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!tenantName.trim()) {
      setFormError("Ingresá el nombre del negocio.");
      return;
    }
    if (normalizedWhatsapp.length < 10) {
      setFormError("Ingresá un WhatsApp válido con código de país.");
      return;
    }
    if (!emailRegex.test(email.trim())) {
      setFormError("Ingresá un email válido.");
      return;
    }
    if (password.length < 6) {
      setFormError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("La confirmación de contraseña no coincide.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${getClientApiBase()}/auth/register-tenant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ tenantName, whatsappNumber: normalizedWhatsapp, email, password })
      });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as { tenantId: string; token: string; email?: string };
      window.localStorage.setItem("ws_auth_token", body.token);
      window.localStorage.setItem("ws_tenant_id", body.tenantId);
      if (body.email) window.localStorage.setItem("ws_user_email", body.email);
      window.location.href = "/ops";
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo crear el tenant");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-8 text-[var(--color-text)]"
      style={{
        background:
          "radial-gradient(ellipse 90% 70% at 50% -10%, rgba(25,72,95,0.12) 0%, transparent 70%), var(--color-bg)",
      }}
    >
      <div className="flex w-full max-w-[400px] flex-col gap-0 animate-fade-in-up">
        {/* Brand mark */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl shadow-md ring-1 ring-white/20"
            style={{
              background:
                "linear-gradient(145deg, var(--color-primary) 0%, var(--color-primary-active) 100%)",
            }}
          >
            <span className="text-xl font-black text-[var(--color-growth-base)]">W</span>
          </div>
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-ui">
              {mode === "login" ? "Bienvenido de vuelta" : "Nuevo negocio"}
            </p>
          </div>
        </div>

        <form
          onSubmit={mode === "login" ? submit : registerTenant}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6 shadow-md ring-1 ring-black/[0.03]"
        >
          {/* Mode tabs */}
          <div className="flex overflow-hidden rounded-lg border border-border bg-canvas">
            <button
              type="button"
              onClick={() => { setMode("login"); setFormError(""); }}
              className={cn(
                "flex-1 border-none px-3 py-2 text-sm font-semibold transition-colors duration-fast",
                mode === "login"
                  ? "bg-primary text-white shadow-sm"
                  : "bg-transparent text-muted hover:text-[var(--color-text)]",
              )}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => { setMode("register"); setFormError(""); }}
              className={cn(
                "flex-1 border-l border-border px-3 py-2 text-sm font-semibold transition-colors duration-fast",
                mode === "register"
                  ? "bg-primary text-white shadow-sm"
                  : "bg-transparent text-muted hover:text-[var(--color-text)]",
              )}
            >
              Crear cuenta
            </button>
          </div>

          {mode === "register" ? (
            <>
              <Input
                label="Nombre del negocio"
                placeholder="Mi tienda"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                autoComplete="organization"
              />
              <Input
                label="WhatsApp del negocio"
                placeholder="Ej: 549112345678"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                inputMode="numeric"
              />
            </>
          ) : null}

          <Input
            label="Email"
            type="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <Input
            label="Contraseña"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {mode === "register" ? (
            <Input
              label="Confirmar contraseña"
              type="password"
              placeholder="Repetir contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          ) : null}

          {mode === "register" ? (
            <p className="text-xs leading-relaxed text-muted">
              Al crear la cuenta ingresás directo al panel de configuración para
              conectar WhatsApp, Mercado Pago y tu catálogo.
            </p>
          ) : null}

          {formError ? (
            <div
              className="rounded-lg border border-error bg-error-bg px-3 py-2.5 text-xs font-medium text-error"
              role="alert"
            >
              {formError}
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            className="mt-1 w-full"
            loading={loading}
            disabled={loading}
          >
            {mode === "login" ? "Iniciar sesión" : "Crear cuenta e ingresar"}
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] text-muted-ui">
          Waseller &mdash; Ventas por WhatsApp con IA
        </p>
      </div>
    </main>
  );
}
