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
  topBarCenter,
  currencyLabel,
}: {
  slug: string;
  storeName: string;
  logoUrl?: string;
  categories: Category[];
  primaryColor: string;
  headingFont?: string;
  topBarCenter?: string;
  currencyLabel?: string;
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
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  const catalogoHref = `/tienda/${slug}/catalogo`;

  return (
    <>
      <div
        className="text-[10px] font-medium"
        style={{ backgroundColor: "var(--ts-primary)", color: "var(--ts-on-primary)" }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-1.5 sm:px-6 lg:px-8">
          <span className="shrink-0 tabular-nums opacity-90">{(currencyLabel || "$").trim()}</span>
          <span className="min-w-0 flex-1 truncate text-center opacity-85">
            {topBarCenter?.trim() || "\u00A0"}
          </span>
          <Link
            href={catalogoHref}
            className="shrink-0 whitespace-nowrap no-underline opacity-90 hover:underline"
            style={{ color: "var(--ts-on-primary)" }}
          >
            Catálogo
          </Link>
        </div>
      </div>

      <header
        className="sticky top-0 z-40 transition-all duration-300"
        style={{
          backgroundColor: scrolled
            ? "color-mix(in srgb, var(--ts-bg, #fff) 96%, transparent)"
            : "var(--ts-bg, #fff)",
          borderBottom: `1px solid ${scrolled ? "var(--ts-border, #e5e5e5)" : "transparent"}`,
          backdropFilter: scrolled ? "blur(16px)" : "none",
        }}
      >
        <div className="relative mx-auto flex h-16 max-w-7xl items-center px-4 sm:px-6 lg:px-8">

          {/* ── LEFT: categories (desktop) / hamburger (mobile) ── */}
          <div className="flex flex-1 items-center gap-0">
            {/* Hamburger — always visible */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="mr-3 flex h-10 w-10 flex-col items-center justify-center gap-[5px] rounded-lg transition-opacity hover:opacity-60"
              aria-label="Abrir menú"
            >
              <span
                className="block h-px w-5 origin-center transition-transform"
                style={{ backgroundColor: "var(--ts-text, #1a1a1a)" }}
              />
              <span
                className="block h-px w-5 origin-center transition-transform"
                style={{ backgroundColor: "var(--ts-text, #1a1a1a)" }}
              />
              <span
                className="block h-px w-3.5 origin-center transition-transform self-start"
                style={{ backgroundColor: "var(--ts-text, #1a1a1a)" }}
              />
            </button>

            {/* Categories inline — desktop only */}
            {categories.length > 0 && (
              <nav className="hidden items-center gap-1 lg:flex" aria-label="Categorías">
                {categories.slice(0, 5).map((cat) => (
                  <Link
                    key={cat.id}
                    href={`/tienda/${slug}/catalogo?categoryId=${cat.id}`}
                    className="whitespace-nowrap rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest no-underline transition-all duration-200 hover:opacity-100"
                    style={{ color: "var(--ts-muted, #888)", letterSpacing: "0.08em" }}
                  >
                    {cat.name}
                  </Link>
                ))}
                {categories.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-widest transition-opacity hover:opacity-60"
                    style={{ color: "var(--ts-muted, #888)" }}
                  >
                    +{categories.length - 5} más
                  </button>
                )}
              </nav>
            )}
          </div>

          {/* ── CENTER: Brand name ── */}
          <div className="absolute left-1/2 -translate-x-1/2">
            <Link href={`/tienda/${slug}`} className="block no-underline" tabIndex={0}>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={storeName}
                  className="h-8 w-auto object-contain sm:h-9"
                />
              ) : (
                <span
                  className="block whitespace-nowrap text-lg font-bold sm:text-xl"
                  style={{
                    fontFamily: headingFont ? `"${headingFont}", serif` : "var(--ts-heading-font, inherit)",
                    color: "var(--ts-text, #1a1a1a)",
                    letterSpacing: "0.1em",
                  }}
                >
                  {storeName.toUpperCase()}
                </span>
              )}
            </Link>
          </div>

          {/* ── RIGHT: buscar + catálogo ── */}
          <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
            <Link
              href={catalogoHref}
              className="flex h-10 w-10 items-center justify-center rounded-md no-underline transition-opacity hover:opacity-60"
              aria-label="Buscar en catálogo"
              title="Buscar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4.3-4.3" strokeLinecap="round" />
              </svg>
            </Link>
            <Link
              href={catalogoHref}
              className="hidden rounded-none border px-3 py-2 text-[10px] font-bold uppercase tracking-widest no-underline transition-all duration-200 hover:opacity-80 sm:inline-block"
              style={{
                borderColor: "var(--ts-primary)",
                color: "var(--ts-primary)",
                letterSpacing: "0.1em",
              }}
            >
              Catálogo
            </Link>
          </div>
        </div>
      </header>

      {/* ── DRAWER ── */}
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 backdrop-blur-sm transition-opacity duration-300 ${
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ backgroundColor: "var(--ts-overlay-backdrop)" }}
        onClick={() => setDrawerOpen(false)}
        aria-hidden
      />

      {/* Panel */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-72 flex-col bg-white transition-transform duration-300 ease-out ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ backgroundColor: "var(--ts-surface, #fff)" }}
        aria-label="Navegación de categorías"
      >
        {/* Drawer header */}
        <div
          className="flex items-center justify-between border-b px-6 py-5"
          style={{ borderColor: "var(--ts-border, #e5e5e5)" }}
        >
          <span
            className="text-xs font-bold uppercase tracking-[0.18em]"
            style={{ color: "var(--ts-muted, #888)" }}
          >
            Categorías
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_6%,transparent)]"
            aria-label="Cerrar menú"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 1l12 12M13 1L1 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Drawer body */}
        <nav className="flex-1 overflow-y-auto py-4" aria-label="Categorías">
          {/* Ver todo */}
          <Link
            href={`/tienda/${slug}/catalogo`}
            onClick={() => setDrawerOpen(false)}
            className="flex items-center justify-between px-6 py-3.5 text-sm font-semibold no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_4%,transparent)]"
            style={{ color: "var(--ts-text, #1a1a1a)", borderLeft: `3px solid ${primaryColor}` }}
          >
            Ver todo el catálogo
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>

          {/* Divider */}
          <div className="mx-6 my-3 h-px" style={{ backgroundColor: "var(--ts-border, #e5e5e5)" }} />

          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/tienda/${slug}/catalogo?categoryId=${cat.id}`}
              onClick={() => setDrawerOpen(false)}
              className="flex items-center justify-between px-6 py-3 text-sm no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--ts-text)_4%,transparent)]"
              style={{ color: "var(--ts-text, #1a1a1a)" }}
            >
              {cat.name}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: "var(--ts-muted)" }}>
                <path d="M1.5 5h7M6 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          ))}
        </nav>

        {/* Drawer footer */}
        <div
          className="border-t px-6 py-5"
          style={{ borderColor: "var(--ts-border, #e5e5e5)" }}
        >
          <span
            className="text-[10px] uppercase tracking-[0.15em]"
            style={{ color: "var(--ts-muted, #999)" }}
          >
            {storeName}
          </span>
        </div>
      </aside>
    </>
  );
}
