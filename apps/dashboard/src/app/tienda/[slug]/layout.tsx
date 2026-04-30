import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@waseller/db";
import { normalizeStoreConfig } from "@waseller/shared";
import { getTenantBySlug } from "./_lib/get-tenant";
import { TiendaNavbar } from "./tienda-navbar.client";

type LayoutProps = {
  params: Promise<{ slug: string }>;
  children: ReactNode;
};

/** Texto legible sobre fondos de acento (primary / secondary) según luminancia relativa. */
function contrastOn(accentHex: string): string {
  const raw = accentHex.trim().replace("#", "");
  const h =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (h.length !== 6 || !/^[0-9a-fA-F]+$/.test(h)) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (x: number) =>
    x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.42 ? "#141414" : "#ffffff";
}

function googleFontsUrl(
  cfg: ReturnType<typeof normalizeStoreConfig>,
): string | null {
  const fonts = [cfg.typography.headingFont, cfg.typography.bodyFont]
    .filter((f): f is string => Boolean(f?.trim()))
    .filter((f, i, a) => a.indexOf(f) === i);
  if (!fonts.length) return null;
  return `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`).join("&")}&display=swap`;
}

export default async function TiendaSlugLayout({
  params,
  children,
}: LayoutProps) {
  const { slug } = await params;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const storeName = cfg.brand.storeName || tenant.name;

  const categories: Array<{ id: string; name: string }> =
    await prisma.category.findMany({
      where: { tenantId: tenant.id, isActive: true, parentId: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
      take: 7,
    });

  const fontsUrl = googleFontsUrl(cfg);

  const P = cfg.colors.primary || "#19485f";
  const SEC = cfg.colors.secondary || P;
  const BG = cfg.colors.background || "#fafafa";
  const SURF = cfg.colors.surface || "#ffffff";
  const TEXT = cfg.colors.textPrimary || "#1a1a1a";
  const MUTED = cfg.colors.textSecondary || "#6b6b6b";
  const BORDER = cfg.colors.border || "#e5e5e5";
  const ON_PRIMARY = contrastOn(P);
  const ON_SECONDARY = contrastOn(SEC);
  const HEADING_FONT = cfg.typography.headingFont
    ? `"${cfg.typography.headingFont}", serif`
    : "inherit";
  const BODY_FONT = cfg.typography.bodyFont
    ? `"${cfg.typography.bodyFont}", sans-serif`
    : "inherit";

  return (
    <div
      style={
        {
          "--ts-primary": P,
          "--ts-secondary": SEC,
          "--ts-on-primary": ON_PRIMARY,
          "--ts-on-secondary": ON_SECONDARY,
          "--ts-bg": BG,
          "--ts-surface": SURF,
          "--ts-text": TEXT,
          "--ts-muted": MUTED,
          "--ts-border": BORDER,
          "--ts-heading-font": HEADING_FONT,
          "--ts-body-font": BODY_FONT,
          "--ts-editorial-muted":
            "color-mix(in srgb, var(--ts-border) 50%, var(--ts-bg))",
          "--ts-media-scrim":
            "color-mix(in srgb, var(--ts-text) 30%, transparent)",
          "--ts-overlay-backdrop":
            "color-mix(in srgb, var(--ts-text) 42%, transparent)",
          backgroundColor: BG,
          color: TEXT,
          fontFamily: BODY_FONT,
          minHeight: "100%",
        } as React.CSSProperties
      }
    >
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}

      {/* ── HEADER ── */}
      <TiendaNavbar
        slug={slug}
        storeName={storeName}
        logoUrl={cfg.brand.logoUrl}
        categories={categories}
        primaryColor={P}
        headingFont={cfg.typography.headingFont}
      />

      {/* ── CONTENT ── */}
      <main>{children}</main>

      {/* ── FOOTER (newsletter + columnas + franja oscura) ── */}
      <footer
        className="mt-16 border-t"
        style={{
          borderColor: "var(--ts-border)",
          backgroundColor: "var(--ts-surface)",
        }}
      >
        <div className="mx-auto w-full max-w-[min(90rem,calc(100%-1.5rem))] px-3 py-12 sm:px-5 sm:py-14 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <p
                className="text-base font-bold"
                style={{ color: "var(--ts-text)", fontFamily: HEADING_FONT }}
              >
                Recibí novedades
              </p>
              <p
                className="mt-2 max-w-md text-sm leading-relaxed"
                style={{ color: "var(--ts-muted)" }}
              >
                Dejanos tu email y te avisamos cuando haya nuevos productos o
                promociones.
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <input
                  type="email"
                  name="newsletter-email"
                  autoComplete="email"
                  placeholder="tu@email.com"
                  readOnly
                  className="min-h-[44px] flex-1 rounded-none border px-3 text-sm outline-none sm:min-h-0"
                  style={{
                    borderColor: "var(--ts-border)",
                    backgroundColor: "var(--ts-bg)",
                    color: "var(--ts-text)",
                  }}
                  aria-label="Email para newsletter"
                />
                <button
                  type="button"
                  className="min-h-[44px] border px-5 text-[11px] font-bold uppercase tracking-[0.12em] sm:min-h-0"
                  style={{
                    borderColor: "var(--ts-primary)",
                    color: "var(--ts-primary)",
                    backgroundColor: "transparent",
                  }}
                >
                  Suscribirme
                </button>
              </div>
              <p
                className="mt-2 text-[11px]"
                style={{ color: "var(--ts-muted)" }}
              >
                Próximamente podrás activar el envío desde el panel de la
                tienda.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
              <div>
                <p
                  className="text-xs font-bold uppercase tracking-[0.14em]"
                  style={{ color: "var(--ts-text)" }}
                >
                  Ayuda
                </p>
                <ul
                  className="mt-4 space-y-2 text-sm"
                  style={{ color: "var(--ts-muted)" }}
                >
                  {cfg.contact.email && (
                    <li>
                      <a
                        href={`mailto:${cfg.contact.email}`}
                        className="no-underline hover:underline"
                        style={{ color: "var(--ts-muted)" }}
                      >
                        {cfg.contact.email}
                      </a>
                    </li>
                  )}
                  {cfg.contact.phone && (
                    <li>
                      <a
                        href={`tel:${cfg.contact.phone}`}
                        className="no-underline hover:underline"
                        style={{ color: "var(--ts-muted)" }}
                      >
                        {cfg.contact.phone}
                      </a>
                    </li>
                  )}
                  {!cfg.contact.email && !cfg.contact.phone && (
                    <li className="text-xs">
                      Contacto por WhatsApp al comprar.
                    </li>
                  )}
                </ul>
              </div>
              <div>
                <p
                  className="text-xs font-bold uppercase tracking-[0.14em]"
                  style={{ color: "var(--ts-text)" }}
                >
                  Tienda
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  <li>
                    <Link
                      href={`/tienda/${slug}`}
                      className="no-underline hover:underline"
                      style={{ color: "var(--ts-muted)" }}
                    >
                      Inicio
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={`/tienda/${slug}/catalogo`}
                      className="no-underline hover:underline"
                      style={{ color: "var(--ts-muted)" }}
                    >
                      Catálogo
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p
                  className="text-xs font-bold uppercase tracking-[0.14em]"
                  style={{ color: "var(--ts-text)" }}
                >
                  Legal
                </p>
                <ul
                  className="mt-4 space-y-2 text-sm"
                  style={{ color: "var(--ts-muted)" }}
                >
                  <li className="text-xs leading-relaxed">
                    Catálogo público. Precios y stock pueden variar; confirmá
                    antes de abonar.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {(cfg.contact.instagram ||
            cfg.contact.facebook ||
            cfg.contact.tiktok ||
            cfg.contact.pinterest) && (
            <div
              className="mt-10 border-t pt-8"
              style={{ borderColor: "var(--ts-border)" }}
            >
              <p
                className="mb-3 text-xs font-bold uppercase tracking-[0.14em]"
                style={{ color: "var(--ts-text)" }}
              >
                Redes
              </p>
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {cfg.contact.instagram && (
                  <li>
                    <a
                      href={`https://instagram.com/${cfg.contact.instagram}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="no-underline hover:underline"
                      style={{ color: "var(--ts-muted)" }}
                    >
                      Instagram
                    </a>
                  </li>
                )}
                {cfg.contact.facebook && (
                  <li>
                    <a
                      href={`https://facebook.com/${cfg.contact.facebook}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="no-underline hover:underline"
                      style={{ color: "var(--ts-muted)" }}
                    >
                      Facebook
                    </a>
                  </li>
                )}
                {cfg.contact.tiktok && (
                  <li>
                    <a
                      href={`https://tiktok.com/@${cfg.contact.tiktok}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="no-underline hover:underline"
                      style={{ color: "var(--ts-muted)" }}
                    >
                      TikTok
                    </a>
                  </li>
                )}
                {cfg.contact.pinterest && (
                  <li>
                    <a
                      href={`https://pinterest.com/${cfg.contact.pinterest}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="no-underline hover:underline"
                      style={{ color: "var(--ts-muted)" }}
                    >
                      Pinterest
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
