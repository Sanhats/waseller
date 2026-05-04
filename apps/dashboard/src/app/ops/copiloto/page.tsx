"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Badge, Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type Range = "today" | "7d" | "30d" | "all";

type RecentSample = {
  draftReply: string | null;
  sentMessage: string;
  editDistance: number;
  usedAsIs: boolean;
  draftWasOffered: boolean;
  createdAt: string;
};

type Metrics = {
  range: { days: number; since: string };
  totals: { replies: number; withDraftOffered: number; usedAsIs: number };
  rates: { draftCoverage: number; acceptanceAsIs: number };
  edits: {
    avgEditDistance: number;
    medianEditDistance: number;
    totalTokensAdded: number;
    totalTokensRemoved: number;
  };
  recentSamples: RecentSample[];
};

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

export default function CopilotQualityPage() {
  const [isMobile, setIsMobile] = useState(false);
  const [range, setRange] = useState<Range>("7d");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    setLoading(true);
    fetch(`${getClientApiBase()}/ops/copilot-quality?range=${range}`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "x-tenant-id": auth.tenantId,
      },
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as Metrics;
      })
      .then(setMetrics)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [range]);

  const draftCoveragePct = useMemo(
    () => (metrics ? Math.round(metrics.rates.draftCoverage * 100) : 0),
    [metrics],
  );
  const acceptancePct = useMemo(
    () => (metrics ? Math.round(metrics.rates.acceptanceAsIs * 100) : 0),
    [metrics],
  );

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
            <h1 className="text-display">Calidad del copiloto</h1>
            <p className="mt-1 text-body text-muted-ui">
              Cuánto se está usando el borrador sugerido y cuánto lo edita el vendedor.
            </p>
          </div>
          <div className="flex gap-2">
            {(["today", "7d", "30d", "all"] as const).map((r) => (
              <Button
                key={r}
                type="button"
                variant={range === r ? "primary" : "ghost"}
                onClick={() => setRange(r)}
              >
                {r === "today" ? "Hoy" : r === "all" ? "Todo" : r}
              </Button>
            ))}
          </div>
        </header>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Spinner size="lg" label="Cargando métricas" />
          </div>
        ) : error ? (
          <p className="mt-6 text-body text-danger">{error}</p>
        ) : !metrics ? null : (
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                title="Respuestas enviadas"
                value={metrics.totals.replies.toString()}
                hint={`Últimos ${metrics.range.days} día(s)`}
              />
              <KpiCard
                title="Cobertura del copiloto"
                value={`${draftCoveragePct}%`}
                hint={`${metrics.totals.withDraftOffered} / ${metrics.totals.replies} con borrador disponible`}
              />
              <KpiCard
                title="Aceptación tal cual"
                value={`${acceptancePct}%`}
                hint={`${metrics.totals.usedAsIs} envíos sin editar el draft`}
              />
              <KpiCard
                title="Edit distance medio"
                value={metrics.edits.avgEditDistance.toString()}
                hint={`Mediana: ${metrics.edits.medianEditDistance} · +${metrics.edits.totalTokensAdded} / -${metrics.edits.totalTokensRemoved} tokens`}
              />
            </div>

            <h2 className="mt-10 text-section">Últimos envíos</h2>
            <p className="mt-1 text-label-ui text-muted-ui">
              Comparativo borrador ↔ enviado. Útil para detectar patrones de edición.
            </p>

            <ul className="mt-4 space-y-3">
              {metrics.recentSamples.length === 0 ? (
                <li className="rounded border border-border bg-surface p-4 text-body text-muted-ui">
                  Sin envíos en este rango.
                </li>
              ) : (
                metrics.recentSamples.map((s, i) => (
                  <li
                    key={i}
                    className="rounded border border-border bg-surface p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-label-ui text-muted-ui">
                        {new Date(s.createdAt).toLocaleString("es-AR")}
                      </span>
                      <div className="flex gap-2">
                        {!s.draftWasOffered ? (
                          <Badge variant="default">Sin borrador</Badge>
                        ) : s.usedAsIs ? (
                          <Badge variant="default">Tal cual</Badge>
                        ) : (
                          <Badge variant="default">Editado · ed={s.editDistance}</Badge>
                        )}
                      </div>
                    </div>
                    {s.draftWasOffered ? (
                      <div className="mt-2">
                        <p className="text-label-ui text-muted-ui">Borrador</p>
                        <p className="whitespace-pre-wrap text-body">
                          {s.draftReply}
                        </p>
                      </div>
                    ) : null}
                    <div className="mt-2">
                      <p className="text-label-ui text-muted-ui">Enviado</p>
                      <p className="whitespace-pre-wrap text-body">
                        {s.sentMessage}
                      </p>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

function KpiCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-label-ui text-muted-ui">{title}</p>
      <p className="mt-2 text-display font-semibold">{value}</p>
      {hint ? (
        <p className="mt-1 text-label-ui text-muted-ui">{hint}</p>
      ) : null}
    </div>
  );
}
