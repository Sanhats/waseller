"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getClientApiBase } from "@/lib/api-base";

type Stats = {
  totalExamples: number;
  indexedConversations: number;
  productsCovered: number;
  lastIndexedAt: string | null;
  vendidoLeads: number;
  bySource: { real: number; imported: number; synthetic: number };
  bySegment: Record<string, number>;
};

const SEGMENT_LABEL: Record<string, string> = {
  mujer: "Mujer",
  hombre: "Hombre",
  unisex: "Unisex",
  ninos: "Niños",
};

type Segment = "mujer" | "hombre" | "unisex" | "ninos";

type SyntheticProgress = {
  queue: {
    active: number;
    waiting: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
  };
  recentInsertedTurns: number;
  lastConversations: Array<{
    conversationId: string;
    segment: string | null;
    scenario: string | null;
    startedAt: string;
    turnCount: number;
  }>;
};

const FALLBACK_TENANT = process.env.NEXT_PUBLIC_TENANT_ID ?? "";

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? FALLBACK_TENANT;
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

export default function RagPage() {
  const [isMobile, setIsMobile] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [lastBackfill, setLastBackfill] = useState<{
    enqueued: number;
    totalVendidoLeads: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [segments, setSegments] = useState<Segment[]>(["mujer", "hombre", "unisex", "ninos"]);
  const [count, setCount] = useState(40);
  const [generating, setGenerating] = useState(false);
  const [lastSyntheticRun, setLastSyntheticRun] = useState<{ enqueued: number } | null>(null);
  const [clearingSynthetic, setClearingSynthetic] = useState(false);
  const [progress, setProgress] = useState<SyntheticProgress | null>(null);

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
      const r = await fetch(`${getClientApiBase()}/ops/rag/stats`, {
        headers: { Authorization: `Bearer ${auth.token}`, "x-tenant-id": auth.tenantId },
        cache: "no-store",
      });
      if (!r.ok) throw new Error(await r.text());
      setStats(await r.json());
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

  /** Polling de progreso: cada 3s mientras hay jobs activos/esperando, sino cada 30s (idle). */
  useEffect(() => {
    const auth = authContext();
    if (!auth) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const r = await fetch(`${getClientApiBase()}/ops/rag/synthetic-progress`, {
          headers: { Authorization: `Bearer ${auth.token}`, "x-tenant-id": auth.tenantId },
          cache: "no-store",
        });
        if (!r.ok) return;
        const data = (await r.json()) as SyntheticProgress;
        if (cancelled) return;
        setProgress(data);
        const busy = data.queue.active + data.queue.waiting + data.queue.delayed > 0;
        timeoutId = setTimeout(tick, busy ? 3000 : 30000);
        // Si volvió a idle, refrescamos las stats principales una vez.
        if (!busy && progress && progress.queue.active + progress.queue.waiting > 0) {
          void load();
        }
      } catch {
        timeoutId = setTimeout(tick, 10000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
    // Solo arrancamos el loop al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateSynthetic = async () => {
    const auth = authContext();
    if (!auth || segments.length === 0 || count <= 0) return;
    setGenerating(true);
    try {
      const r = await fetch(`${getClientApiBase()}/ops/rag/generate-synthetic`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ count, segments }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as { enqueued: number };
      setLastSyntheticRun(data);
      // Cada conversación tarda ~3-8s; refrescamos cada 8s mientras corre.
      const refreshes = Math.min(6, Math.ceil(data.enqueued / 5));
      for (let i = 1; i <= refreshes; i++) {
        setTimeout(() => void load(), i * 8000);
      }
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e instanceof Error ? e.message : "No se pudo generar");
    } finally {
      setGenerating(false);
    }
  };

  const clearSynthetic = async () => {
    const auth = authContext();
    if (!auth) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm("¿Borrar todos los turnos sintéticos? Las conversaciones reales/importadas no se tocan.")) return;
    setClearingSynthetic(true);
    try {
      const r = await fetch(`${getClientApiBase()}/ops/rag/clear-synthetic`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "x-tenant-id": auth.tenantId },
      });
      if (!r.ok) throw new Error(await r.text());
      void load();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e instanceof Error ? e.message : "No se pudo borrar");
    } finally {
      setClearingSynthetic(false);
    }
  };

  const toggleSegment = (s: Segment) => {
    setSegments((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const backfill = async () => {
    const auth = authContext();
    if (!auth) return;
    setBackfilling(true);
    try {
      const r = await fetch(`${getClientApiBase()}/ops/rag/backfill`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "x-tenant-id": auth.tenantId },
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as { enqueued: number; totalVendidoLeads: number };
      setLastBackfill(data);
      // Esperamos un poco a que el indexer procese y refrescamos.
      setTimeout(() => void load(), 6000);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e instanceof Error ? e.message : "No se pudo encolar");
    } finally {
      setBackfilling(false);
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
            <h1 className="text-display">RAG · ventas que cerraron</h1>
            <p className="mt-1 text-body text-muted-ui">
              El copiloto se inspira en turnos de conversaciones que terminaron en venta.
              Cada vez que un lead pasa a <strong>vendido</strong>, su conversación se
              indexa automáticamente.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={backfill}
            loading={backfilling}
            disabled={loading}
          >
            Re-indexar histórico
          </Button>
        </header>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Spinner size="lg" label="Cargando" />
          </div>
        ) : error ? (
          <p className="mt-6 text-body text-danger">{error}</p>
        ) : !stats ? null : (
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Stat title="Turnos indexados" value={stats.totalExamples.toString()} hint="Pares (incoming → outgoing)" />
              <Stat
                title="Conversaciones"
                value={stats.indexedConversations.toString()}
                hint={`${stats.vendidoLeads} leads en vendido`}
              />
              <Stat title="Productos cubiertos" value={stats.productsCovered.toString()} />
              <Stat
                title="Último indexado"
                value={stats.lastIndexedAt ? new Date(stats.lastIndexedAt).toLocaleDateString("es-AR") : "—"}
                hint={stats.lastIndexedAt ? new Date(stats.lastIndexedAt).toLocaleTimeString("es-AR") : ""}
              />
            </div>

            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Stat title="Reales" value={stats.bySource.real.toString()} hint="De ventas que cerraron" />
              <Stat title="Importadas" value={stats.bySource.imported.toString()} hint="Subidas desde WhatsApp" />
              <Stat title="Sintéticas" value={stats.bySource.synthetic.toString()} hint="Generadas con GPT-4 (cold start)" />
            </div>

            {Object.keys(stats.bySegment).length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(stats.bySegment).map(([seg, n]) => (
                  <span
                    key={seg}
                    className="rounded border border-border bg-surface px-3 py-1 text-label-ui"
                  >
                    {SEGMENT_LABEL[seg] ?? seg}: <strong>{n}</strong>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-10 rounded border border-border bg-surface p-4">
              <h2 className="text-section">Generar ejemplos sintéticos</h2>
              <p className="mt-1 text-label-ui text-muted-ui">
                Generamos conversaciones de venta WhatsApp realistas con GPT-4, orientadas a indumentaria
                y calzado en español argentino. Se etiquetan como <code>synthetic</code> y el copiloto las
                usa solo si no hay matches reales mejores.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["mujer", "hombre", "unisex", "ninos"] as Segment[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSegment(s)}
                    className={cn(
                      "rounded border px-3 py-1 text-body",
                      segments.includes(s)
                        ? "border-primary bg-primary/10"
                        : "border-border bg-canvas"
                    )}
                  >
                    {SEGMENT_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="text-label-ui text-muted-ui">Cantidad:</label>
                <input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                  min={1}
                  max={500}
                  className="w-24 rounded border border-border bg-canvas px-2 py-1 text-body"
                />
                <Button
                  type="button"
                  variant="primary"
                  onClick={generateSynthetic}
                  loading={generating}
                  disabled={segments.length === 0}
                >
                  Generar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearSynthetic}
                  loading={clearingSynthetic}
                >
                  Borrar sintéticos
                </Button>
              </div>
              {lastSyntheticRun ? (
                <p className="mt-3 text-label-ui text-muted-ui">
                  Encolamos {lastSyntheticRun.enqueued} conversaciones. Cada una tarda ~5s en generarse.
                </p>
              ) : (
                <p className="mt-3 text-label-ui text-muted-ui">
                  Sugerencia inicial: 40 conversaciones cubriendo los 4 segmentos. Costo aprox: $0.30 USD.
                </p>
              )}

              {progress ? (
                <div className="mt-4 rounded border border-border bg-canvas p-3">
                  <div className="flex flex-wrap items-center gap-3 text-label-ui">
                    <span>
                      <strong>{progress.queue.active}</strong> generándose
                    </span>
                    <span>
                      <strong>{progress.queue.waiting}</strong> en cola
                    </span>
                    <span>
                      <strong>{progress.queue.completed}</strong> completadas (global)
                    </span>
                    {progress.queue.failed > 0 ? (
                      <span className="text-danger">
                        <strong>{progress.queue.failed}</strong> fallidas
                      </span>
                    ) : null}
                    <span className="text-muted-ui">
                      · {progress.recentInsertedTurns} turnos insertados (últimos 10 min)
                    </span>
                  </div>
                  {progress.lastConversations.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-label-ui">
                      {progress.lastConversations.map((c) => (
                        <li key={c.conversationId} className="text-muted-ui">
                          {new Date(c.startedAt).toLocaleTimeString("es-AR")} ·{" "}
                          {SEGMENT_LABEL[c.segment ?? ""] ?? c.segment ?? "?"} ·{" "}
                          <span className="text-[var(--color-text)]">
                            {c.scenario ?? "?"}
                          </span>{" "}
                          ({c.turnCount} turnos)
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>

            {lastBackfill ? (
              <p className="mt-6 text-body">
                Backfill encolado: {lastBackfill.enqueued} de {lastBackfill.totalVendidoLeads} conversaciones
                vendidas. Las métricas se actualizan a medida que el worker procese cada job.
              </p>
            ) : null}

            <div className="mt-8 rounded border border-border bg-surface p-4">
              <h2 className="text-section">¿Cómo funciona?</h2>
              <ol className="mt-2 ml-4 list-decimal space-y-1 text-body">
                <li>
                  Cuando marcás un lead como <strong>vendido</strong>, encolamos un job para indexar su
                  conversación.
                </li>
                <li>
                  El worker arma pares <em>(mensaje del cliente → respuesta que cerró)</em> y los embebe
                  con OpenAI.
                </li>
                <li>
                  En cada nueva sugerencia, el copiloto busca los 3 turnos más similares y los usa como
                  inspiración (sin copiarlos).
                </li>
              </ol>
              <p className="mt-3 text-label-ui text-muted-ui">
                Si recién instalaste, tocá <strong>Re-indexar histórico</strong> para procesar todos los
                leads <em>vendido</em> existentes en una sola pasada.
              </p>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function Stat({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <p className="text-label-ui text-muted-ui">{title}</p>
      <p className="mt-2 text-display font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-label-ui text-muted-ui">{hint}</p> : null}
    </div>
  );
}
