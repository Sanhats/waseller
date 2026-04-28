"use client";

import { useMemo, useState } from "react";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function ProductGallery({
  name,
  images,
}: {
  name: string;
  images: string[];
}) {
  const gallery = useMemo(() => images.map((s) => String(s ?? "").trim()).filter(Boolean), [images]);
  const [active, setActive] = useState(0);
  const safeActive = clamp(active, 0, Math.max(0, gallery.length - 1));
  const activeSrc = gallery[safeActive] ?? "";

  if (gallery.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--ts-border)] bg-[var(--ts-surface)] p-4">
        <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-[var(--ts-bg)] text-sm font-medium text-[var(--ts-muted)]">
          Sin fotos
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-[var(--ts-border)] bg-[var(--ts-surface)] p-4">
        <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[var(--ts-bg)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={activeSrc} alt={name} className="h-full w-full object-contain" />
        </div>
      </div>

      {gallery.length > 1 ? (
        <div className="flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {gallery.map((src, idx) => {
            const isActive = idx === safeActive;
            return (
              <button
                key={`${src.slice(0, 40)}-${idx}`}
                type="button"
                onClick={() => setActive(idx)}
                className="group block"
                aria-label={`Ver foto ${idx + 1}`}
                title={isActive ? "Foto seleccionada" : "Seleccionar foto"}
              >
                <div
                  className={[
                    "h-20 w-20 overflow-hidden rounded-xl bg-[var(--ts-surface)]",
                    isActive
                      ? "border-2 border-[var(--ts-primary)]"
                      : "border border-[var(--ts-border)] hover:border-[var(--ts-primary)]",
                  ].join(" ")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`${name} — ${idx + 1}`} className="h-full w-full object-cover" />
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

