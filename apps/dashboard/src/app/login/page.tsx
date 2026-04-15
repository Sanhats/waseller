"use client";

import { FormEvent, useEffect, useState } from "react";
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
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
    <main className="grid min-h-screen place-items-center bg-canvas px-3 py-8 text-[var(--color-text)]">
      <form
        onSubmit={mode === "login" ? submit : registerTenant}
        className={cn(
          "flex w-full max-w-[390px] flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-md",
          isMobile && "mx-auto"
        )}
      >
        <h1 className="text-[1.375rem] font-bold leading-tight tracking-tight text-[var(--color-text)]">
          Ingreso Waseller
        </h1>
        <p className="text-sm text-muted">
          {mode === "login"
            ? "Accedé con tu usuario existente."
            : "Creá tu tenant y administrador en un solo paso."}
        </p>

        <div className="mt-1 flex overflow-hidden rounded-md border border-border">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setFormError("");
            }}
            className={cn(
              "flex-1 border-none px-3 py-2 text-sm font-semibold transition-colors duration-fast",
              mode === "login"
                ? "bg-[var(--badge-active-bg)] text-primary"
                : "bg-surface text-muted hover:bg-canvas"
            )}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setFormError("");
            }}
            className={cn(
              "flex-1 border-l border-border px-3 py-2 text-sm font-semibold transition-colors duration-fast",
              mode === "register"
                ? "bg-[var(--badge-active-bg)] text-primary"
                : "bg-surface text-muted hover:bg-canvas"
            )}
          >
            Crear tenant
          </button>
        </div>

        {mode === "register" ? (
          <>
            <Input
              label="Negocio / tenant"
              placeholder="Nombre del negocio"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              autoComplete="organization"
            />
            <Input
              label="WhatsApp del negocio"
              placeholder="Ej: 54911..."
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
          <p className="text-xs text-muted">
            Al crear el tenant, ingresás a Negocio para conectar WhatsApp, Mercado Pago, contexto de la tienda y
            catálogo.
          </p>
        ) : null}

        {formError ? (
          <div
            className="rounded-md border border-error bg-error-bg px-3 py-2 text-xs font-medium text-error"
            role="alert"
          >
            {formError}
          </div>
        ) : null}

        <Button type="submit" variant="primary" className="mt-2 w-full" loading={loading} disabled={loading}>
          {mode === "login" ? "Iniciar sesión" : "Crear tenant e ingresar"}
        </Button>
      </form>
    </main>
  );
}
