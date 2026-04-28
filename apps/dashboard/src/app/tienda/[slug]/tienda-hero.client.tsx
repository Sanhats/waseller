"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

export type HeroSlide = {
  imageUrl?: string;
  title?: string;
  subtitle?: string;
  ctaText?: string;
  ctaHref?: string;
};

export function TiendaHeroCarousel({
  slides,
  fallbackBg = "var(--ts-primary)",
  headingFont,
}: {
  slides: HeroSlide[];
  /** Color de fondo cuando el slide no trae imagen (p. ej. `var(--ts-primary)`). */
  fallbackBg?: string;
  headingFont?: string;
}) {
  const filtered = slides.filter((s) => s.imageUrl || s.title || s.subtitle);
  const list: HeroSlide[] = filtered.length > 0 ? filtered : [{}];
  const [i, setI] = useState(0);

  const go = useCallback(
    (d: number) => {
      if (list.length <= 1) return;
      setI((prev) => (prev + d + list.length) % list.length);
    },
    [list.length]
  );

  useEffect(() => {
    if (list.length <= 1) return;
    const t = window.setInterval(() => go(1), 7000);
    return () => window.clearInterval(t);
  }, [go, list.length]);

  const slide = list[i] ?? {};
  const onPhoto = Boolean(slide.imageUrl?.trim());

  const navBtnClass = onPhoto
    ? "border-white/40 bg-white/10 text-white hover:bg-white/20"
    : "border-[color-mix(in_srgb,var(--ts-on-primary)_42%,transparent)] bg-[color-mix(in_srgb,var(--ts-on-primary)_10%,transparent)] text-[var(--ts-on-primary)] hover:bg-[color-mix(in_srgb,var(--ts-on-primary)_18%,transparent)]";

  return (
    <section
      className="relative w-full overflow-hidden"
      style={{
        minHeight: "min(52vh, 520px)",
        backgroundColor: "var(--ts-editorial-muted)",
      }}
    >
      <div
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-500"
        style={
          slide.imageUrl?.trim()
            ? { backgroundImage: `url(${slide.imageUrl.trim()})` }
            : { backgroundColor: fallbackBg }
        }
      />
      {onPhoto && (
        <div className="absolute inset-0" style={{ backgroundColor: "var(--ts-media-scrim)" }} aria-hidden />
      )}

      {list.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            className={`absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border text-xl font-light backdrop-blur-sm transition sm:left-6 ${navBtnClass}`}
            aria-label="Anterior"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className={`absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border text-xl font-light backdrop-blur-sm transition sm:right-6 ${navBtnClass}`}
            aria-label="Siguiente"
          >
            ›
          </button>
        </>
      )}

      {(slide.title || slide.subtitle || slide.ctaText) && (
        <div className="relative z-[1] mx-auto flex min-h-[min(52vh,520px)] max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
          {slide.title && (
            <h1
              className={`text-3xl font-semibold tracking-tight drop-shadow-md sm:text-5xl ${onPhoto ? "text-white" : ""}`}
              style={{
                fontFamily: headingFont || "inherit",
                ...(!onPhoto ? { color: "var(--ts-on-primary)" } : {}),
              }}
            >
              {slide.title}
            </h1>
          )}
          {slide.subtitle && (
            <p
              className={`mt-4 max-w-lg text-sm font-normal sm:text-base ${onPhoto ? "text-white/90" : ""}`}
              style={
                !onPhoto
                  ? { color: "color-mix(in srgb, var(--ts-on-primary) 88%, transparent)" }
                  : undefined
              }
            >
              {slide.subtitle}
            </p>
          )}
          {slide.ctaText && slide.ctaHref && (
            <Link
              href={slide.ctaHref}
              className={
                onPhoto
                  ? "mt-8 inline-block border border-white px-8 py-2.5 text-[11px] font-bold uppercase tracking-[0.15em] text-white no-underline transition-colors hover:bg-white hover:text-[var(--ts-text)]"
                  : "mt-8 inline-block border border-[var(--ts-on-primary)] px-8 py-2.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--ts-on-primary)] no-underline transition-colors hover:bg-[var(--ts-on-primary)] hover:text-[var(--ts-primary)]"
              }
            >
              {slide.ctaText}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
