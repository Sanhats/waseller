import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@waseller/db";
import { normalizeStoreConfig, type StoreConfig } from "@waseller/shared";
import { getBackendServices } from "@/lib/backend-services";
import { getTenantBySlug } from "./_lib/get-tenant";
import { TiendaHeroCarousel, type HeroSlide } from "./tienda-hero.client";

type PageProps = { params: Promise<{ slug: string }> };

type VariantRow = {
  productId: string;
  name: string;
  effectivePrice: number;
  availableStock: number;
  imageUrl?: string | null;
};

type ProductCard = {
  productId: string;
  name: string;
  imageUrl?: string | null;
  totalAvailable: number;
  minPrice: number;
  maxPrice: number;
};

type ShowcaseCat = { id: string; name: string; imageUrl: string | null };

const SHELL =
  "mx-auto w-full max-w-[min(90rem,calc(100%-1rem))] px-3 sm:px-5 lg:px-8";

function groupProducts(rows: VariantRow[]): ProductCard[] {
  const map = new Map<string, ProductCard>();
  for (const r of rows) {
    const prev = map.get(r.productId);
    if (!prev) {
      map.set(r.productId, {
        productId: r.productId,
        name: r.name,
        imageUrl: r.imageUrl,
        totalAvailable: r.availableStock,
        minPrice: r.effectivePrice,
        maxPrice: r.effectivePrice,
      });
    } else {
      prev.totalAvailable += r.availableStock;
      prev.minPrice = Math.min(prev.minPrice, r.effectivePrice);
      prev.maxPrice = Math.max(prev.maxPrice, r.effectivePrice);
      if (!prev.imageUrl && r.imageUrl) prev.imageUrl = r.imageUrl;
    }
  }
  return [...map.values()];
}

/** Respeta el orden configurado en la tienda; solo incluye IDs que existan en el catálogo. */
function cardsInConfiguredOrder(
  cards: ProductCard[],
  ids: string[],
  max: number,
): ProductCard[] {
  const byId = new Map(cards.map((c) => [c.productId, c]));
  const out: ProductCard[] = [];
  for (const id of ids) {
    const t = id?.trim();
    if (!t) continue;
    const c = byId.get(t);
    if (c) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** Estilos globales de la home: marquesina y reveal staggered. Respeta prefers-reduced-motion. */
function PageStyles() {
  return (
    <style>{`
@keyframes ts-marquee {
  from { transform: translate3d(0,0,0); }
  to { transform: translate3d(-50%,0,0); }
}
.ts-marquee-track {
  animation: ts-marquee 38s linear infinite;
  display: inline-flex;
  width: max-content;
  will-change: transform;
}
@keyframes ts-rise-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.ts-rise > * {
  animation: ts-rise-in 0.85s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.ts-rise > *:nth-child(1) { animation-delay: 60ms; }
.ts-rise > *:nth-child(2) { animation-delay: 130ms; }
.ts-rise > *:nth-child(3) { animation-delay: 200ms; }
.ts-rise > *:nth-child(4) { animation-delay: 270ms; }
.ts-rise > *:nth-child(5) { animation-delay: 340ms; }
.ts-rise > *:nth-child(6) { animation-delay: 410ms; }
.ts-rise > *:nth-child(7) { animation-delay: 480ms; }
.ts-rise > *:nth-child(8) { animation-delay: 550ms; }
@media (prefers-reduced-motion: reduce) {
  .ts-marquee-track { animation: none; }
  .ts-rise > * { animation: none; }
}
.ts-num {
  font-feature-settings: "tnum", "lnum";
  font-variant-numeric: tabular-nums;
}
.ts-rule {
  height: 1px;
  flex: 1;
  background: linear-gradient(to right, var(--ts-border), color-mix(in srgb, var(--ts-border) 0%, transparent));
}
`}</style>
  );
}

/** Encabezado editorial: índice + título grande a la izquierda, copy + CTA a la derecha. */
function SectionHeader({
  index,
  eyebrow,
  title,
  body,
  ctaHref,
  ctaLabel,
  countLabel,
}: {
  index: string;
  eyebrow?: string;
  title: string;
  body?: string;
  ctaHref: string;
  ctaLabel: string;
  countLabel?: string;
}) {
  return (
    <header className="grid grid-cols-1 items-end gap-8 lg:grid-cols-12 lg:gap-12">
      <div className="lg:col-span-7">
        <div className="flex items-center gap-4">
          <span
            className="ts-num text-[11px] font-bold uppercase tracking-[0.32em]"
            style={{ color: "var(--ts-muted)" }}
          >
            {index}
            {eyebrow ? (
              <>
                <span aria-hidden className="mx-2 opacity-50">
                  /
                </span>
                {eyebrow}
              </>
            ) : null}
          </span>
          <span aria-hidden className="ts-rule" />
          {countLabel ? (
            <span
              className="ts-num shrink-0 text-[10px] font-bold uppercase tracking-[0.22em]"
              style={{ color: "var(--ts-muted)" }}
            >
              {countLabel}
            </span>
          ) : null}
        </div>
        <h2
          className="mt-6 text-[2.4rem] font-bold leading-[0.92] sm:text-[3rem] lg:text-[4rem]"
          style={{
            color: "var(--ts-text)",
            fontFamily: "var(--ts-heading-font, inherit)",
            letterSpacing: "-0.025em",
          }}
        >
          {title}
        </h2>
      </div>
      <div className="lg:col-span-5">
        {body ? (
          <p
            className="max-w-md text-[15px] leading-relaxed"
            style={{ color: "var(--ts-muted)" }}
          >
            {body}
          </p>
        ) : null}
        <div className="mt-5">
          <Link
            href={ctaHref}
            className="group inline-flex items-center gap-3 border-b py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] no-underline"
            style={{ borderColor: "var(--ts-text)", color: "var(--ts-text)" }}
          >
            <span>{ctaLabel}</span>
            <span
              aria-hidden
              className="inline-block transition-transform duration-500 group-hover:translate-x-1.5"
            >
              →
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ────────────────────────────────────────────────────────────
   Categorías — Mosaico editorial asimétrico
   ──────────────────────────────────────────────────────────── */

function CategoryTile({
  index,
  cat,
  catalogoHref,
}: {
  index: number;
  cat: ShowcaseCat;
  catalogoHref: string;
}) {
  const idxStr = String(index).padStart(2, "0");
  return (
    <Link
      href={`${catalogoHref}?categoryId=${cat.id}`}
      className="group relative block h-full min-h-[220px] overflow-hidden no-underline sm:min-h-[240px] lg:min-h-0"
      style={{ backgroundColor: "var(--ts-editorial-muted)" }}
      aria-label={`Ver categoría ${cat.name}`}
    >
      {cat.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cat.imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-[1100ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.07]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="px-4 text-center text-[10px] font-bold uppercase tracking-[0.32em]"
            style={{ color: "var(--ts-muted)" }}
          >
            {cat.name}
          </span>
        </div>
      )}

      {/* Top scrim — para que se lea el numeral */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-2/5"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--ts-text) 40%, transparent), transparent)",
        }}
      />
      {/* Bottom scrim — para que se lea el nombre */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5"
        style={{
          background:
            "linear-gradient(to top, color-mix(in srgb, var(--ts-text) 62%, transparent) 0%, color-mix(in srgb, var(--ts-text) 22%, transparent) 45%, transparent 80%)",
        }}
      />

      {/* Numeral grande tipo editorial */}
      <div className="pointer-events-none absolute left-4 top-3 sm:left-6 sm:top-4">
        <span
          className="ts-num block leading-none"
          style={{
            fontFamily: "var(--ts-heading-font, inherit)",
            color: "var(--ts-surface)",
            fontSize: "clamp(2rem, 4.5vw, 3.5rem)",
            letterSpacing: "-0.04em",
            fontWeight: 700,
            opacity: 0.95,
          }}
        >
          {idxStr}
        </span>
      </div>

      {/* Nombre + indicador (línea que crece en hover) */}
      <div className="absolute inset-x-0 bottom-0 px-5 pb-5 pt-12 sm:px-6 sm:pb-6">
        <p
          className="text-[15px] font-bold uppercase leading-tight tracking-[0.04em] sm:text-base"
          style={{
            color: "var(--ts-surface)",
            fontFamily: "var(--ts-heading-font, inherit)",
          }}
        >
          {cat.name}
        </p>
        <div
          className="mt-3 flex items-center gap-3"
          style={{
            color: "color-mix(in srgb, var(--ts-surface) 88%, transparent)",
          }}
        >
          <span
            aria-hidden
            className="block h-px w-7 transition-[width] duration-500 group-hover:w-14"
            style={{ backgroundColor: "currentColor" }}
          />
          <span className="text-[10px] font-bold uppercase tracking-[0.28em]">
            Explorar
          </span>
        </div>
      </div>

      {/* Ring en hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-shadow duration-500 group-hover:shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--ts-primary)_55%,transparent)]"
      />
    </Link>
  );
}

/**
 * Mosaico bento editorial: define el `grid-column / grid-row` de cada celda
 * según la cantidad total (1–6). Lo usan Categorías, Novedades y Ofertas para
 * compartir el mismo idioma visual (1 hero + chicas + opcional banner ancho).
 */
function bentoMosaicClass(count: number, idx: number): string {
  const n = Math.min(count, 6);
  if (n <= 1) return "";
  if (n === 2) return idx === 0 ? "lg:col-span-7" : "lg:col-span-5";
  if (n === 3) {
    if (idx === 0) return "lg:col-span-7 lg:row-span-2";
    if (idx === 1) return "lg:col-span-5 lg:col-start-8 lg:row-start-1";
    return "lg:col-span-5 lg:col-start-8 lg:row-start-2";
  }
  if (n === 4) {
    if (idx === 0) return "col-span-2 lg:col-span-7 lg:row-span-2";
    if (idx === 1) return "lg:col-span-5 lg:col-start-8 lg:row-start-1";
    if (idx === 2) return "lg:col-span-2 lg:col-start-8 lg:row-start-2";
    return "lg:col-span-3 lg:col-start-10 lg:row-start-2";
  }
  if (n === 5) {
    if (idx === 0) return "col-span-2 lg:col-span-6 lg:row-span-2";
    if (idx === 1) return "lg:col-span-3 lg:col-start-7 lg:row-start-1";
    if (idx === 2) return "lg:col-span-3 lg:col-start-10 lg:row-start-1";
    if (idx === 3) return "lg:col-span-3 lg:col-start-7 lg:row-start-2";
    return "lg:col-span-3 lg:col-start-10 lg:row-start-2";
  }
  // n === 6 → hero + 4 chicas + banner ancho abajo
  if (idx === 0) return "col-span-2 sm:col-span-2 lg:col-span-6 lg:row-span-2";
  if (idx === 1) return "lg:col-span-3 lg:col-start-7 lg:row-start-1";
  if (idx === 2) return "lg:col-span-3 lg:col-start-10 lg:row-start-1";
  if (idx === 3) return "lg:col-span-3 lg:col-start-7 lg:row-start-2";
  if (idx === 4) return "lg:col-span-3 lg:col-start-10 lg:row-start-2";
  return "col-span-2 lg:col-span-12 lg:row-start-3 lg:min-h-[180px]";
}

function CategoriesMosaic({
  showcaseCategories,
  catalogoHref,
}: {
  showcaseCategories: ShowcaseCat[];
  catalogoHref: string;
}) {
  if (showcaseCategories.length === 0) {
    return (
      <p
        className="mt-12 text-center text-sm"
        style={{ color: "var(--ts-muted)" }}
      >
        Pronto sumaremos categorías a la tienda.
      </p>
    );
  }
  const cats = showcaseCategories.slice(0, 6);
  const n = cats.length;

  const gridBase =
    n === 1
      ? "grid-cols-1"
      : "grid-cols-2 lg:grid-cols-12 lg:auto-rows-[minmax(180px,28vh)]";

  return (
    <ul
      className={`ts-rise mt-12 grid gap-3 sm:gap-4 lg:mt-16 lg:gap-5 ${gridBase}`}
    >
      {cats.map((cat, idx) => (
        <li key={cat.id} className={bentoMosaicClass(n, idx)}>
          <CategoryTile index={idx + 1} cat={cat} catalogoHref={catalogoHref} />
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────────────────────────────────────
   Tarjeta de producto editorial — mismo lenguaje visual que CategoryTile.
   Sin caption: nombre superpuesto, numeral grande, sin precios en home.
   ──────────────────────────────────────────────────────────── */

function ProductTile({
  slug,
  card,
  index,
  badge,
  cfg,
}: {
  slug: string;
  card: ProductCard;
  index: number;
  badge: "new" | "sale" | "none";
  cfg: StoreConfig;
}) {
  const newLabel = cfg.uiTexts.newBadge || "Nuevo";
  const saleLabel = cfg.uiTexts.saleBadge || "Oferta";
  const idxStr = String(index).padStart(2, "0");

  return (
    <Link
      href={`/tienda/${slug}/p/${card.productId}`}
      className="group relative block h-full min-h-[220px] overflow-hidden no-underline sm:min-h-[240px] lg:min-h-0"
      style={{ backgroundColor: "var(--ts-editorial-muted)" }}
      aria-label={`Ver producto: ${card.name}`}
    >
      {card.imageUrl?.trim() ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.imageUrl.trim()}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-[1100ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.07]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
          <span
            className="text-[10px] font-bold uppercase tracking-[0.32em]"
            style={{ color: "var(--ts-muted)" }}
          >
            {card.name}
          </span>
        </div>
      )}

      {/* Top scrim — para que se lea numeral + badge */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-2/5"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--ts-text) 40%, transparent), transparent)",
        }}
      />
      {/* Bottom scrim — para que se lea el nombre */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5"
        style={{
          background:
            "linear-gradient(to top, color-mix(in srgb, var(--ts-text) 62%, transparent) 0%, color-mix(in srgb, var(--ts-text) 22%, transparent) 45%, transparent 80%)",
        }}
      />

      {/* Numeral grande tipo editorial — top-left */}
      <div className="pointer-events-none absolute left-4 top-3 sm:left-6 sm:top-4">
        <span
          className="ts-num block leading-none"
          style={{
            fontFamily: "var(--ts-heading-font, inherit)",
            color: "var(--ts-surface)",
            fontSize: "clamp(2rem, 4.5vw, 3.5rem)",
            letterSpacing: "-0.04em",
            fontWeight: 700,
            opacity: 0.95,
          }}
        >
          {idxStr}
        </span>
      </div>

      {/* Badge — Nuevo: pill con punto, top-right */}
      {badge === "new" ? (
        <div className="pointer-events-none absolute right-4 top-4 sm:right-6 sm:top-5">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.22em]"
            style={{
              backgroundColor: "var(--ts-surface)",
              color: "var(--ts-text)",
            }}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--ts-primary)" }}
            />
            {newLabel}
          </span>
        </div>
      ) : null}

      {/* Badge — Oferta: tag inclinado, top-right */}
      {badge === "sale" ? (
        <div
          className="pointer-events-none absolute right-4 top-4 origin-top-right sm:right-6 sm:top-5"
          style={{ transform: "rotate(6deg)" }}
        >
          <span
            className="inline-block px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.24em]"
            style={{
              backgroundColor: "var(--ts-secondary)",
              color: "var(--ts-on-secondary)",
              boxShadow:
                "0 8px 20px -10px color-mix(in srgb, var(--ts-secondary) 80%, transparent)",
            }}
          >
            {saleLabel}
          </span>
        </div>
      ) : null}

      {/* Nombre + indicador (línea que crece en hover) */}
      <div className="absolute inset-x-0 bottom-0 px-5 pb-5 pt-12 sm:px-6 sm:pb-6">
        <p
          className="text-[15px] font-bold uppercase leading-tight tracking-[0.04em] sm:text-base"
          style={{
            color: "var(--ts-surface)",
            fontFamily: "var(--ts-heading-font, inherit)",
          }}
        >
          {card.name}
        </p>
        <div
          className="mt-3 flex items-center gap-3"
          style={{
            color: "color-mix(in srgb, var(--ts-surface) 88%, transparent)",
          }}
        >
          <span
            aria-hidden
            className="block h-px w-7 transition-[width] duration-500 group-hover:w-14"
            style={{ backgroundColor: "currentColor" }}
          />
          <span className="text-[10px] font-bold uppercase tracking-[0.28em]">
            Ver pieza
          </span>
        </div>
      </div>

      {/* Ring en hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-shadow duration-500 group-hover:shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--ts-primary)_55%,transparent)]"
      />
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────
   Sección Novedades — mismo mosaico bento que Categorías
   ──────────────────────────────────────────────────────────── */

function NovedadesSection({
  slug,
  catalogoHref,
  cards,
  cfg,
}: {
  slug: string;
  catalogoHref: string;
  cards: ProductCard[];
  cfg: StoreConfig;
}) {
  if (cards.length === 0) return null;
  const items = cards.slice(0, 6);
  const n = items.length;

  const gridBase =
    n === 1
      ? "grid-cols-1"
      : "grid-cols-2 lg:grid-cols-12 lg:auto-rows-[minmax(180px,28vh)]";

  return (
    <section
      className="relative border-t py-16 sm:py-20 lg:py-24"
      style={{
        borderColor: "var(--ts-border)",
        backgroundColor: "var(--ts-bg)",
      }}
    >
      <div className={SHELL}>
        <SectionHeader
          index="."
          title="Novedades"
          ctaHref={catalogoHref}
          ctaLabel="Ver novedades"
        />

        <ul
          className={`ts-rise mt-12 grid gap-3 sm:gap-4 lg:mt-16 lg:gap-5 ${gridBase}`}
        >
          {items.map((card, idx) => (
            <li key={card.productId} className={bentoMosaicClass(n, idx)}>
              <ProductTile
                slug={slug}
                card={card}
                index={idx + 1}
                badge="new"
                cfg={cfg}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   Sección Ofertas — bento + fondo tintado + marquesina superior
   ──────────────────────────────────────────────────────────── */

function OfertasSection({
  slug,
  catalogoHref,
  cards,
  cfg,
}: {
  slug: string;
  catalogoHref: string;
  cards: ProductCard[];
  cfg: StoreConfig;
}) {
  if (cards.length === 0) return null;
  const saleLabel = (cfg.uiTexts.saleBadge || "Oferta").toUpperCase();
  const items = cards.slice(0, 6);
  const n = items.length;

  const gridBase =
    n === 1
      ? "grid-cols-1"
      : "grid-cols-2 lg:grid-cols-12 lg:auto-rows-[minmax(180px,28vh)]";

  return (
    <section
      className="relative border-t"
      style={{
        borderColor: "var(--ts-border)",
        backgroundColor:
          "color-mix(in srgb, var(--ts-secondary) 7%, var(--ts-surface))",
      }}
    >
      {/* Marquesina superior — repite el label de "Oferta" */}
      <div
        aria-hidden
        className="overflow-hidden border-b"
        style={{ borderColor: "var(--ts-border)" }}
      >
        <div className="ts-marquee-track py-2.5">
          {[0, 1].map((dup) => (
            <div key={dup} className="inline-flex shrink-0">
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={`${dup}-${i}`}
                  className="mx-5 text-[10px] font-bold uppercase tracking-[0.36em]"
                  style={{
                    color:
                      "color-mix(in srgb, var(--ts-secondary) 75%, var(--ts-text))",
                  }}
                >
                  {saleLabel} <span className="opacity-50">·</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={`${SHELL} py-16 sm:py-20 lg:py-24`}>
        <SectionHeader
          index="."
          title="Ofertas"
          ctaHref={catalogoHref}
          ctaLabel="Ver todas las ofertas"
        />

        <ul
          className={`ts-rise mt-12 grid gap-3 sm:gap-4 lg:mt-16 lg:gap-5 ${gridBase}`}
        >
          {items.map((card, idx) => (
            <li key={card.productId} className={bentoMosaicClass(n, idx)}>
              <ProductTile
                slug={slug}
                card={card}
                index={idx + 1}
                badge="sale"
                cfg={cfg}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   Sección Selección — grid uniforme 4-col (palate cleanser)
   ──────────────────────────────────────────────────────────── */

function SeleccionSection({
  slug,
  catalogoHref,
  cards,
  cfg,
}: {
  slug: string;
  catalogoHref: string;
  cards: ProductCard[];
  cfg: StoreConfig;
}) {
  if (cards.length === 0) return null;
  const n = cards.length;
  const cols =
    n === 1
      ? "grid-cols-1"
      : n === 2
        ? "grid-cols-2"
        : n === 3
          ? "grid-cols-2 sm:grid-cols-3"
          : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  return (
    <section
      className="relative border-t py-16 sm:py-20 lg:py-24"
      style={{
        borderColor: "var(--ts-border)",
        backgroundColor: "var(--ts-bg)",
      }}
    >
      <div className={SHELL}>
        <SectionHeader
          index="."
          title="Para descubrir"
          ctaHref={catalogoHref}
          ctaLabel="Ver catálogo completo"
        />

        <ul
          className={`ts-rise mt-12 grid gap-3 sm:gap-4 lg:mt-16 lg:gap-5 ${cols}`}
        >
          {cards.map((card, i) => (
            <li key={card.productId} className="aspect-[4/5]">
              <ProductTile
                slug={slug}
                card={card}
                index={i + 1}
                badge="none"
                cfg={cfg}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   Metadata + página
   ──────────────────────────────────────────────────────────── */

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Tienda" };
  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const name = cfg.brand.storeName || tenant.name;
  return {
    title: name,
    description:
      cfg.brand.description || cfg.brand.tagline || `Catálogo de ${name}`,
  };
}

export default async function TiendaHomePage({ params }: PageProps) {
  const { slug } = await params;
  const catalogoHref = `/tienda/${slug}/catalogo`;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const storeName = cfg.brand.storeName || tenant.name;
  const headingFont = cfg.typography.headingFont
    ? `"${cfg.typography.headingFont}", serif`
    : undefined;

  const configuredShowcase = (cfg.home?.categoryShowcase ?? []).filter((s) =>
    s.categoryId?.trim(),
  );

  const [rows, defaultRootCategories] = await Promise.all([
    getBackendServices().products.listPublicCatalogByTenant(tenant.id, {}),
    prisma.category.findMany({
      where: { tenantId: tenant.id, isActive: true, parentId: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 6,
      select: { id: true, name: true },
    }),
  ]);

  type CatPick = { id: string; name: string };
  let showcaseCategories: ShowcaseCat[] = [];

  if (configuredShowcase.length > 0) {
    const ids = [
      ...new Set(configuredShowcase.map((s) => s.categoryId!.trim())),
    ];
    const found: CatPick[] = await prisma.category.findMany({
      where: { tenantId: tenant.id, id: { in: ids }, isActive: true },
      select: { id: true, name: true },
    });
    const byId = new Map<string, CatPick>(found.map((c) => [c.id, c]));
    showcaseCategories = configuredShowcase
      .map((slot) => {
        const c = byId.get(slot.categoryId!.trim());
        if (!c) return null;
        return {
          id: c.id,
          name: c.name,
          imageUrl: slot.imageUrl?.trim() || null,
        };
      })
      .filter((x): x is ShowcaseCat => x !== null);
  }

  if (showcaseCategories.length === 0) {
    showcaseCategories = defaultRootCategories.map((c: CatPick) => ({
      id: c.id,
      name: c.name,
      imageUrl: null,
    }));
  }

  const allCards = groupProducts(rows);
  const novedadesCards = cardsInConfiguredOrder(
    allCards,
    cfg.featured.newProductIds,
    6,
  );
  const ofertaCards = cardsInConfiguredOrder(
    allCards,
    cfg.featured.saleProductIds,
    6,
  );
  const featuredPid = new Set(
    [...cfg.featured.newProductIds, ...cfg.featured.saleProductIds]
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id)),
  );
  const selectionCards = allCards
    .filter((c) => !featuredPid.has(c.productId))
    .slice(0, 8);

  const introBody =
    cfg.brand.description ||
    cfg.brand.tagline ||
    "Explorá nuestras categorías y los productos seleccionados para vos.";

  const slides: HeroSlide[] = [];
  const pushHero = () => {
    if (cfg.hero.backgroundImageUrl || cfg.hero.title || cfg.hero.subtitle) {
      slides.push({
        imageUrl: cfg.hero.backgroundImageUrl,
        title: cfg.hero.title,
        subtitle: cfg.hero.subtitle,
        ctaText: cfg.hero.ctaText,
        ctaHref: cfg.hero.ctaLink || catalogoHref,
      });
    }
  };
  pushHero();
  for (const b of cfg.banners ?? []) {
    if (b.backgroundImageUrl || b.title || b.subtitle) {
      slides.push({
        imageUrl: b.backgroundImageUrl,
        title: b.title,
        subtitle: b.subtitle,
        ctaText: b.ctaText,
        ctaHref: b.ctaLink || catalogoHref,
      });
    }
  }
  if (slides.length === 0) {
    slides.push({
      title: storeName,
      subtitle: cfg.brand.tagline || introBody,
      ctaText: cfg.hero.ctaText || "Ver catálogo",
      ctaHref: catalogoHref,
    });
  }

  const totalCats = showcaseCategories.length;
  const showEmptyState =
    allCards.length === 0 &&
    novedadesCards.length === 0 &&
    ofertaCards.length === 0 &&
    selectionCards.length === 0;

  return (
    <div className="pb-0">
      <PageStyles />
      <TiendaHeroCarousel slides={slides} headingFont={headingFont} />

      {/* 01 — Categorías */}
      <section
        className={`${SHELL} pb-14 pt-16 sm:pb-20 sm:pt-24 lg:pb-24 lg:pt-28`}
      >
        <SectionHeader
          index="01"
          title="Categorías"
          ctaHref={catalogoHref}
          ctaLabel="Ver catálogo"
        />
        <CategoriesMosaic
          showcaseCategories={showcaseCategories}
          catalogoHref={catalogoHref}
        />
      </section>

      {/* 02 — Novedades */}
      <NovedadesSection
        slug={slug}
        catalogoHref={catalogoHref}
        cards={novedadesCards}
        cfg={cfg}
      />

      {/* 03 — Ofertas */}
      <OfertasSection
        slug={slug}
        catalogoHref={catalogoHref}
        cards={ofertaCards}
        cfg={cfg}
      />

      {/* 04 — Selección */}
      <SeleccionSection
        slug={slug}
        catalogoHref={catalogoHref}
        cards={selectionCards}
        cfg={cfg}
      />

      {/* Estado vacío total */}
      {showEmptyState && (
        <div className={`${SHELL} py-24 text-center`}>
          <p
            className="text-3xl font-bold tracking-tight sm:text-4xl"
            style={{
              color: "var(--ts-muted)",
              fontFamily: headingFont || "inherit",
              letterSpacing: "-0.02em",
            }}
          >
            Próximamente
          </p>
          <p className="mt-3 text-sm" style={{ color: "var(--ts-muted)" }}>
            Estamos preparando el catálogo.
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              href={catalogoHref}
              className="group inline-flex items-center gap-3 border-b py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] no-underline"
              style={{ borderColor: "var(--ts-text)", color: "var(--ts-text)" }}
            >
              <span>Ver catálogo</span>
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover:translate-x-1.5"
              >
                →
              </span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
