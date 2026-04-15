"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

/** Lista lateral de conversaciones (avatar + líneas). */
export function ConversationSidebarListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-border" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-[min(100%,11rem)]" />
            <Skeleton className="h-3 w-full max-w-[16rem]" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Burbujas de chat alternadas (carga inicial de mensajes). */
export function ConversationMessagesSkeleton({ bubbles = 8 }: { bubbles?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: bubbles }).map((_, i) => {
        const outgoing = i % 3 === 1;
        return (
          <div key={i} className={cn("flex", outgoing ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[min(85%,28rem)] space-y-2 rounded-lg px-3.5 py-2.5 shadow-sm",
                outgoing
                  ? "bg-chat-outgoing/35 ring-1 ring-primary/10"
                  : "border border-border bg-chat-incoming/40"
              )}
            >
              <Skeleton className={cn("h-4", outgoing ? "ml-4 w-44" : "w-52")} />
              <Skeleton className={cn("h-3", outgoing ? "ml-8 w-24" : "w-28")} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Avatar + nombre en el encabezado del chat (carga de datos del contacto). */
export function ConversationHeaderContactSkeleton() {
  return (
    <div className="flex min-w-0 items-center gap-3" aria-hidden>
      <Skeleton className="size-11 shrink-0 rounded-full ring-2 ring-border" />
      <div className="min-w-0 flex-1 space-y-2 py-0.5">
        <Skeleton className="h-6 w-[min(100%,14rem)] max-w-full" />
        <Skeleton className="h-4 w-36" />
      </div>
    </div>
  );
}

/** Panel lateral “Información” del contacto en conversación. */
export function ConversationAsideContactSkeleton() {
  return (
    <div className="w-full space-y-6" aria-hidden>
      <div className="flex flex-col items-center gap-3 text-center">
        <Skeleton className="size-[4.5rem] shrink-0 rounded-full" />
        <Skeleton className="h-5 w-[min(100%,11rem)] max-w-full" />
        <Skeleton className="h-4 w-32" />
      </div>
      <dl className="space-y-4 border-t border-border pt-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-full max-w-[14rem]" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-36 rounded-md" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-28" />
        </div>
      </dl>
    </div>
  );
}

/** Tabla de clientes (vista tabla). */
export function LeadsTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div
      className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm ring-1 ring-black/[0.02]"
      aria-hidden
    >
      <div className="min-w-[1100px]">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-2.5 last:border-b-0 md:flex-nowrap md:gap-3"
          >
            <div className="flex min-w-[140px] flex-1 items-center gap-2">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20 rounded-pill" />
            <Skeleton className="h-5 w-16 rounded-pill" />
            <Skeleton className="h-5 w-24 rounded-pill" />
            <Skeleton className="h-5 w-20 rounded-pill" />
            <Skeleton className="h-5 w-24 rounded-pill" />
            <Skeleton className="h-4 min-w-[8rem] flex-1 max-w-[220px]" />
            <Skeleton className="h-8 w-[180px] shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Vista Kanban de clientes. */
export function LeadsKanbanSkeleton({ isMobile, cardsPerColumn = 3 }: { isMobile: boolean; cardsPerColumn?: number }) {
  const columns = isMobile ? 1 : 3;
  return (
    <div
      className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3")}
      aria-hidden
    >
      {Array.from({ length: columns }).map((_, col) => (
        <section
          key={col}
          className="min-h-[220px] rounded-xl border border-border bg-surface p-3 shadow-sm ring-1 ring-black/[0.02]"
        >
          <div className="mb-3 flex items-center justify-between">
            <Skeleton className="h-5 w-28 rounded-pill" />
            <Skeleton className="h-4 w-6" />
          </div>
          <div className="flex flex-col gap-2">
            {Array.from({ length: cardsPerColumn }).map((__, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Filas del stock (usar dentro de un único `<tbody>`). */
export function StockTableSkeleton({ rows = 8, axisCount = 2 }: { rows?: number; axisCount?: number }) {
  const cells = 11 + axisCount;
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} aria-hidden>
          {Array.from({ length: cells }).map((__, j) => (
            <td key={j} style={{ padding: "12px 14px" }}>
              {j === 0 ? (
                <Skeleton className="h-11 w-11 shrink-0 rounded-lg" />
              ) : (
                <Skeleton className="h-4 w-full max-w-[8rem]" />
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Carga inicial de Negocio (/ops). */
export function BusinessOnboardingSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6" aria-hidden>
      <div className="space-y-3 rounded-lg border border-border bg-surface p-5 shadow-sm ring-1 ring-black/[0.02]">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-48 max-w-full" />
        <Skeleton className="h-2 w-full rounded-pill" />
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm ring-1 ring-black/[0.02]">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <Skeleton className="h-4 w-full max-w-md" />
        <div className="flex flex-wrap gap-3 pt-2">
          <Skeleton className="h-10 w-44 rounded-md" />
          <Skeleton className="h-10 w-36 rounded-md" />
        </div>
      </div>
    </div>
  );
}
