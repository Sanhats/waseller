"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Badge, Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type Profile = {
  avgLength: number;
  emojiDensity: number;
  formality: string;
  topGreetings: string[] | unknown;
  topClosings: string[] | unknown;
  topEmojis: string[] | unknown;
  catchphrases: string[] | unknown;
  usesAbbreviations: boolean;
  sampleCount: number;
  computedAt: string;
};

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

const asArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

const formalityLabel = (f: string): string => {
  switch (f) {
    case "voseo":
      return "Voseo (tenés / querés / sos)";
    case "tuteo":
      return "Tuteo (tienes / quieres)";
    case "usted":
      return "Usted (formal)";
    case "mixed":
      return "Mixto";
    default:
      return "Sin datos suficientes";
  }
};

export default function StyleProfilePage() {
  const [isMobile, setIsMobile] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${getClientApiBase()}/ops/style-profile`, {
        headers: { Authorization: `Bearer ${auth.token}`, "x-tenant-id": auth.tenantId },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as { profile: Profile | null };
      setProfile(data.profile);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const recompute = async () => {
    const auth = authContext();
    if (!auth) return;
    setRecomputing(true);
    try {
      const r = await fetch(`${getClientApiBase()}/ops/style-profile/recompute`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "x-tenant-id": auth.tenantId },
      });
      if (!r.ok) throw new Error(await r.text());
      // El worker corre async; esperamos un par de segundos y recargamos.
      setTimeout(() => {
        void load();
        setRecomputing(false);
      }, 4000);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e instanceof Error ? e.message : "No se pudo encolar");
      setRecomputing(false);
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
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-display">Estilo del vendedor</h1>
            <p className="mt-1 text-body text-muted-ui">
              Patrones extraídos de tus mensajes salientes. Se inyectan en el prompt para que el copiloto suene como vos.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={recompute}
            loading={recomputing}
            disabled={loading}
          >
            Recalcular
          </Button>
        </header>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Spinner size="lg" label="Cargando perfil" />
          </div>
        ) : error ? (
          <p className="mt-6 text-body text-danger">{error}</p>
        ) : !profile ? (
          <div className="mt-8 rounded border border-border bg-surface p-6">
            <p className="text-body">
              Todavía no hay perfil computado. Apretá <strong>Recalcular</strong> y se generará a partir de los mensajes salientes existentes.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Stat title="Muestras" value={profile.sampleCount.toString()} hint="Mensajes salientes analizados" />
              <Stat title="Largo medio" value={`${profile.avgLength} chars`} />
              <Stat
                title="Densidad de emojis"
                value={`${profile.emojiDensity}/100`}
                hint={profile.emojiDensity > 0.3 ? "Usa emojis" : "Casi no usa"}
              />
              <Stat title="Tratamiento" value={formalityLabel(profile.formality)} />
            </div>

            <Section title="Aperturas frecuentes">
              <ChipList items={asArray(profile.topGreetings)} />
            </Section>
            <Section title="Cierres frecuentes">
              <ChipList items={asArray(profile.topClosings)} />
            </Section>
            <Section title="Frases recurrentes (3-gramas)">
              <ChipList items={asArray(profile.catchphrases)} />
            </Section>
            <Section title="Emojis frecuentes">
              <ChipList items={asArray(profile.topEmojis)} />
            </Section>
            <Section title="Abreviaturas">
              <p className="text-body">
                {profile.usesAbbreviations
                  ? "Sí — usás abreviaturas tipo q, xq, tb. El copiloto las va a usar."
                  : "No — escribís palabras completas. El copiloto evita abreviaturas."}
              </p>
            </Section>

            <p className="text-label-ui text-muted-ui">
              Última recomputación: {new Date(profile.computedAt).toLocaleString("es-AR")}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-label-ui text-muted-ui">{title}</p>
      <p className="mt-2 text-section font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-label-ui text-muted-ui">{hint}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-section">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-label-ui text-muted-ui">Sin datos suficientes.</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((it) => (
        <li key={it}>
          <Badge variant="default">{it}</Badge>
        </li>
      ))}
    </ul>
  );
}
