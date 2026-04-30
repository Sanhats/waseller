"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Category = { id: string; name: string };

export function TiendaNavbar({
  slug,
  storeName,
  logoUrl,
  categories,
  primaryColor,
  headingFont,
}: {
  slug: string;
  storeName: string;
  logoUrl?: string;
  categories: Category[];
  primaryColor: string;
  headingFont?: string;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (drawerOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const catalogoHref = `/tienda/${slug}/catalogo`;
  const homeHref = `/tienda/${slug}`;

  const brandBlock = (
    <Link href={homeHref} className="flex max-w-[min(200px,46vw)] items-center gap-2.5 no-underline sm:max-w-xs" tabIndex={0}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-8 w-auto shrink-0 object-contain sm:h-9" />
      ) : null}
      <span
        className={`min-w-0 truncate text-left text-[11px] font-bold uppercase leading-tight tracking-[0.14em] sm:text-xs sm:tracking-[0.16em] ${logoUrl ? "hidden sm:inline" : ""}`}
        style={{
          fontFamily: headingFont ? `"${headingFont}", serif` : "var(--ts-heading-font, inherit)",
          color: "var(--ts-text, #1a1a1a)",
        }}
      >
        {storeName}
      </span>
    </Link>
  );

  return (
    <>
      <header
        className="sticky top-0 z-40 transition-all duration-300"
        style={{
          backgroundColor: scrolled
            ? "color-mix(in srgb, var(--ts-bg, #fff) 94%, transparent)"
            : "var(--ts-bg, #fff)",
          borderBottom: `1px solid ${scrolled ? "var(--ts-border, #e5e5e5)" : "transparent"}`,
          backdropFilter: scrolled ? "blur(14px)" : "none",
        }}
      >
        <div className="relative mx-auto flex h-[3.35rem] w-full max-w-[min(90rem,calc(100%-1rem))] items-center px-3 sm:h-16 sm:px-4 lg:px-6">
          <div className="z-20 flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex h-10 w-10 flex-col items-center justify-center gap-[5px] rounded-lg transition-opacity hover:opacity-60"
              aria-label="Abrir menú"
            >
              <span className="block h-px w-5" style={{ backgroundColor: "var(--ts-text, #1a1a1a)" }} />
              <span className="block h-px w-5" style={{ backgroundColor: "var(--ts-text, #1a1a1a)" }} />
              <span className="block h-px w-3.5 self-start" style={{ backgroundColor: "var(--ts-text, #1a1a1a)" }} />
            </button>
            <div className="hidden lg:block">{brandBlock}</div>
          </div>

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center lg:pointer-events-auto lg:static lg:mx-4 lg:flex-1 lg:justify-center">
            <div className="pointer-events-auto lg:hidden">{brandBlock}</div>
            {categories.length > 0 ? (
              <nav className="pointer-events-auto hidden max-w-2xl items-center gap-0.5 overflow-x-auto px-2 lg:flex" aria-label="Categorías">
                {categories.slice(0, 6).map((cat) => (
                  <Link
                    key={cat.id}
                    href={`/tienda/${slug}/catalogo?categoryId=${cat.id}`}
                    className="shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_6%,transparent)]"
                    style={{ color: "var(--ts-muted, #888)" }}
                  >
                    {cat.name}
                  </Link>
                ))}
                {categories.length > 6 ? (
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="shrink-0 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-opacity hover:opacity-70"
                    style={{ color: "var(--ts-muted)" }}
                  >
                    +{categories.length - 6}
                  </button>
                ) : null}
              </nav>
            ) : null}
          </div>

          <div className="z-20 ml-auto flex items-center gap-1 sm:gap-2">
            <Link
              href={catalogoHref}
              className="flex h-10 w-10 items-center justify-center rounded-lg no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_6%,transparent)]"
              aria-label="Buscar en catálogo"
              title="Buscar"
              style={{ color: "var(--ts-text)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4.3-4.3" strokeLinecap="round" />
              </svg>
            </Link>
            <Link
              href={catalogoHref}
              className="hidden rounded-md px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] no-underline transition-all duration-200 hover:brightness-95 sm:inline-block"
              style={{
                backgroundColor: "var(--ts-primary)",
                color: "var(--ts-on-primary)",
              }}
            >
              Catálogo
            </Link>
          </div>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-50 backdrop-blur-sm transition-opacity duration-300 ${
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ backgroundColor: "var(--ts-overlay-backdrop)" }}
        onClick={() => setDrawerOpen(false)}
        aria-hidden
      />

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-[min(20rem,88vw)] flex-col transition-transform duration-300 ease-out ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          backgroundColor: "var(--ts-surface, #fff)",
          boxShadow: drawerOpen ? "8px 0 32px color-mix(in srgb, var(--ts-text) 12%, transparent)" : undefined,
        }}
        aria-label="Navegación"
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--ts-border)" }}>
          <div className="min-w-0">{brandBlock}</div>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_6%,transparent)]"
            aria-label="Cerrar menú"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3" aria-label="Categorías y enlaces">
          <Link
            href={homeHref}
            onClick={() => setDrawerOpen(false)}
            className="mx-4 mb-2 flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_5%,transparent)]"
            style={{ color: "var(--ts-text)" }}
          >
            Inicio
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Link
            href={catalogoHref}
            onClick={() => setDrawerOpen(false)}
            className="mx-4 mb-3 flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-semibold no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_5%,transparent)]"
            style={{ color: "var(--ts-text)", borderLeft: `3px solid ${primaryColor}` }}
          >
            Ver catálogo completo
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>

          {categories.length > 0 ? (
            <>
              <p className="mb-1 px-5 pt-2 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--ts-muted)" }}>
                Categorías
              </p>
              <div className="mx-4 my-2 h-px" style={{ backgroundColor: "var(--ts-border)" }} />
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/tienda/${slug}/catalogo?categoryId=${cat.id}`}
                  onClick={() => setDrawerOpen(false)}
                  className="mx-2 flex items-center justify-between rounded-md px-4 py-2.5 text-sm no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_4%,transparent)]"
                  style={{ color: "var(--ts-text)" }}
                >
                  {cat.name}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: "var(--ts-muted)" }} aria-hidden>
                    <path d="M1.5 5h7M6 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              ))}
            </>
          ) : null}
        </nav>

        <div className="border-t px-5 py-4 text-[10px] uppercase tracking-[0.12em]" style={{ borderColor: "var(--ts-border)", color: "var(--ts-muted)" }}>
          {storeName}
        </div>
      </aside>
    </>
  );
}
