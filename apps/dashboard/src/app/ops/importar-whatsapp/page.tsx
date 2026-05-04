"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Badge, Button, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type SpeakerStat = { name: string; count: number; charCount: number };

type Preview = {
  ok: boolean;
  totalMessages?: number;
  speakers?: SpeakerStat[];
  reason?: string;
};

type ImportResult = {
  ok: boolean;
  inserted?: number;
  totalParsed?: number;
  sellerSpeaker?: string;
  contactPhone?: string;
  importTag?: string;
  reason?: string;
};

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

export default function ImportWhatsappPage() {
  const [isMobile, setIsMobile] = useState(false);
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [seller, setSeller] = useState<string>("");
  const [contactPhone, setContactPhone] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setContent(text);
    setPreview(null);
    setSeller("");
    setResult(null);
    setError("");
  };

  const runPreview = async () => {
    const auth = authContext();
    if (!auth) return;
    setPreviewing(true);
    setError("");
    try {
      const r = await fetch(`${getClientApiBase()}/ops/whatsapp-import/preview`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as Preview;
      setPreview(data);
      // Default: speaker con más mensajes
      if (data.speakers && data.speakers.length > 0) {
        setSeller(data.speakers[0].name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const runImport = async () => {
    const auth = authContext();
    if (!auth || !seller) return;
    setImporting(true);
    setError("");
    try {
      const r = await fetch(`${getClientApiBase()}/ops/whatsapp-import`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, sellerSpeaker: seller, contactPhone }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as ImportResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <main
      className={cn(
        "flex min-h-0 bg-canvas text-[var(--color-text)]",
        "h-[100dvh] max-h-[100dvh]",
        "flex-col-reverse lg:flex-row lg:items-stretch",
      )}
    >
      <AppSidebar active="ops" compact={isMobile} />
      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain",
          "px-4 py-5 md:px-6 md:py-6 lg:py-8",
        )}
      >
        <header>
          <h1 className="text-display">Importar historial de WhatsApp</h1>
          <p className="mt-1 text-body text-muted-ui">
            Subí el .txt exportado desde WhatsApp para entrenar el estilo del copiloto sin esperar a generar conversaciones nuevas.
          </p>
        </header>

        <div className="mt-6 space-y-6">
          <div className="rounded border border-border bg-surface p-4">
            <h2 className="text-section">1. Cargar archivo</h2>
            <p className="mt-1 text-label-ui text-muted-ui">
              En WhatsApp: abrí el chat → menú → <em>Más</em> → <em>Exportar chat</em> → <em>Sin archivos multimedia</em>. Te llega un .txt.
            </p>
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={onFile}
              className="mt-3 block w-full text-body"
            />
            {content ? (
              <p className="mt-2 text-label-ui text-muted-ui">
                {Math.round(content.length / 1024)} KB cargados.
              </p>
            ) : null}
            <Button
              type="button"
              variant="primary"
              className="mt-3"
              onClick={runPreview}
              loading={previewing}
              disabled={!content}
            >
              Analizar archivo
            </Button>
          </div>

          {preview?.ok && preview.speakers ? (
            <div className="rounded border border-border bg-surface p-4">
              <h2 className="text-section">2. ¿Cuál sos vos?</h2>
              <p className="mt-1 text-label-ui text-muted-ui">
                Detectamos {preview.totalMessages} mensajes. Marcá quién es el vendedor (vos / tu equipo).
              </p>
              <ul className="mt-3 space-y-2">
                {preview.speakers.map((sp) => (
                  <li key={sp.name}>
                    <button
                      type="button"
                      onClick={() => setSeller(sp.name)}
                      className={cn(
                        "flex w-full items-center justify-between rounded border px-3 py-2 text-left",
                        seller === sp.name
                          ? "border-primary bg-primary/10"
                          : "border-border bg-canvas"
                      )}
                    >
                      <span className="text-body font-medium">{sp.name}</span>
                      <span className="text-label-ui text-muted-ui">
                        {sp.count} mensajes · {Math.round(sp.charCount / 1000)}k chars
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <label className="text-label-ui text-muted-ui">
                  Teléfono del cliente (opcional, solo dígitos)
                </label>
                <Input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="5491123456789"
                  className="mt-1"
                />
                <p className="mt-1 text-label-ui text-muted-ui">
                  Si no lo sabés, dejalo vacío y se le asigna un identificador interno.
                </p>
              </div>

              <Button
                type="button"
                variant="primary"
                className="mt-4"
                onClick={runImport}
                loading={importing}
                disabled={!seller}
              >
                Importar como histórico
              </Button>
            </div>
          ) : null}

          {result?.ok ? (
            <div className="rounded border border-border bg-surface p-4">
              <h2 className="text-section">Listo</h2>
              <p className="mt-2 text-body">
                Importamos <Badge variant="default">{result.inserted}</Badge> mensajes (de {result.totalParsed} parseados).
              </p>
              <p className="mt-1 text-label-ui text-muted-ui">
                Encolamos un recálculo del style profile. En unos segundos vas a ver el perfil actualizado en{" "}
                <a className="underline" href="/ops/estilo">
                  Estilo del vendedor
                </a>
                .
              </p>
            </div>
          ) : null}

          {error ? <p className="text-body text-danger">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
