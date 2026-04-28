import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@waseller/db";
import { normalizeStoreConfig } from "@waseller/shared";
import { getBackendServices } from "@/lib/backend-services";
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

function formatPrice(amount: number, symbol: string) {
  const n = Math.round(amount * 100) / 100;
  return `${symbol}${n.toLocaleString("es-AR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function sectionIntro(title: string, body?: string) {
  return (
    <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
      <h2
        className="text-xl font-bold tracking-tight sm:text-2xl"
        style={{ color: "var(--ts-text)", fontFamily: "var(--ts-heading-font, inherit)" }}
      >
        {title}
      </h2>
      {body ? (
        <p className="mt-3 text-sm leading-relaxed sm:text-[15px]" style={{ color: "var(--ts-muted)" }}>
          {body}
        </p>
      ) : null}
    </div>
  );
}

function outlineCta(href: string, label: string) {
  return (
    <div className="mt-6 flex justify-center">
      <Link
        href={href}
        className="inline-block border px-8 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] no-underline transition-opacity hover:opacity-70"
        style={{ borderColor: "var(--ts-primary)", color: "var(--ts-primary)" }}
      >
        {label}
      </Link>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { name: true, storeConfig: { select: { config: true } } }
  });
  if (!tenant) return { title: "Tienda" };
  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const name = cfg.brand.storeName || tenant.name;
  return {
    title: name,
    description: cfg.brand.description || cfg.brand.tagline || `Catálogo de ${name}`
  };
}

export default async function TiendaHomePage({ params }: PageProps) {
  const { slug } = await params;
  const catalogoHref = `/tienda/${slug}/catalogo`;

  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { id: true, name: true, storeConfig: { select: { config: true } } }
  });
  if (!tenant) notFound();

  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const storeName = cfg.brand.storeName || tenant.name;
  const headingFont = cfg.typography.headingFont ? `"${cfg.typography.headingFont}", serif` : undefined;
  const currency = (cfg.uiTexts.currencySymbol || "$").trim();

  const newIds = new Set(cfg.featured.newProductIds);
  const saleIds = new Set(cfg.featured.saleProductIds);

  const configuredShowcase = (cfg.home?.categoryShowcase ?? []).filter((s) => s.categoryId?.trim());

  const [rows, defaultRootCategories] = await Promise.all([
    getBackendServices().products.listPublicCatalogByTenant(tenant.id, {}),
    prisma.category.findMany({
      where: { tenantId: tenant.id, isActive: true, parentId: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 3,
      select: { id: true, name: true }
    })
  ]);

  type ShowcaseCat = { id: string; name: string; imageUrl: string | null };
  type CatPick = { id: string; name: string };
  let showcaseCategories: ShowcaseCat[] = [];

  if (configuredShowcase.length > 0) {
    const ids = [...new Set(configuredShowcase.map((s) => s.categoryId!.trim()))];
    const found: CatPick[] = await prisma.category.findMany({
      where: { tenantId: tenant.id, id: { in: ids }, isActive: true },
      select: { id: true, name: true }
    });
    const byId = new Map<string, CatPick>(found.map((c) => [c.id, c]));
    showcaseCategories = configuredShowcase
      .map((slot) => {
        const c = byId.get(slot.categoryId!.trim());
        if (!c) return null;
        return {
          id: c.id,
          name: c.name,
          imageUrl: slot.imageUrl?.trim() || null
        };
      })
      .filter((x): x is ShowcaseCat => x !== null);
  }

  if (showcaseCategories.length === 0) {
    showcaseCategories = defaultRootCategories.map((c: CatPick) => ({
      id: c.id,
      name: c.name,
      imageUrl: null
    }));
  }

  const allCards = groupProducts(rows);
  const newCards = allCards.filter((c) => newIds.has(c.productId));
  const featuredSet = new Set([...cfg.featured.newProductIds, ...cfg.featured.saleProductIds]);
  const nonFeatured = allCards.filter((c) => !featuredSet.has(c.productId));

  const latestThree =
    newCards.length >= 3
      ? newCards.slice(0, 3)
      : newCards.length > 0
        ? [...newCards, ...nonFeatured].slice(0, 3)
        : allCards.slice(0, 3);

  const productsRow = allCards.slice(0, 3);

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
        ctaHref: cfg.hero.ctaLink || catalogoHref
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
        ctaHref: b.ctaLink || catalogoHref
      });
    }
  }
  if (slides.length === 0) {
    slides.push({
      title: storeName,
      subtitle: cfg.brand.tagline || introBody,
      ctaText: cfg.hero.ctaText || "Ver catálogo",
      ctaHref: catalogoHref
    });
  }

  return (
    <div className="pb-0">
      <TiendaHeroCarousel slides={slides} headingFont={headingFont} />

      {/* ── Categorías ── */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        {sectionIntro("Categorías", introBody)}
        {outlineCta(catalogoHref, "Ver todo")}

        {showcaseCategories.length > 0 ? (
          <ul className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-6">
            {showcaseCategories.map((cat) => (
              <li key={cat.id} className="text-center">
                <Link
                  href={`${catalogoHref}?categoryId=${cat.id}`}
                  className="group mx-auto block max-w-[280px] overflow-hidden rounded-xl border no-underline transition-all duration-300 ease-out hover:-translate-y-1.5 sm:max-w-none"
                  style={{
                    borderColor: "var(--ts-border)",
                    backgroundColor: "var(--ts-surface)",
                    boxShadow: "0 6px 28px -8px color-mix(in srgb, var(--ts-primary) 20%, transparent)",
                  }}
                >
                  <div
                    className="relative mx-auto aspect-square w-full overflow-hidden"
                    style={{ backgroundColor: "var(--ts-editorial-muted)" }}
                  >
                    {cat.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cat.imageUrl}
                        alt=""
                        className="h-full w-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-3 text-xs font-medium uppercase tracking-widest transition-opacity duration-300 group-hover:opacity-80" style={{ color: "var(--ts-muted)" }}>
                        {cat.name}
                      </div>
                    )}
                    <div
                      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                      style={{
                        background:
                          "linear-gradient(to top, color-mix(in srgb, var(--ts-text) 35%, transparent) 0%, transparent 55%)",
                      }}
                    />
                  </div>
                  <p className="px-2 py-3 text-sm font-semibold transition-colors duration-300 group-hover:text-[var(--ts-primary)]" style={{ color: "var(--ts-text)" }}>
                    {cat.name}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-10 text-center text-sm" style={{ color: "var(--ts-muted)" }}>
            Pronto sumaremos categorías a la tienda.
          </p>
        )}
      </section>

      {/* ── Últimos ingresos (escalonado) ── */}
      {latestThree.length > 0 && (
        <section className="border-t py-14 sm:py-20" style={{ borderColor: "var(--ts-border)", backgroundColor: "var(--ts-surface)" }}>
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            {sectionIntro(
              "Últimos ingresos",
              "Piezas recién sumadas al catálogo. Elegí la tuya antes que se agoten."
            )}
            {outlineCta(catalogoHref, "Ver todo")}

            <div className="mt-14 grid grid-cols-1 gap-8 sm:mt-16 sm:grid-cols-3 sm:items-end sm:gap-6 sm:pt-10">
              {latestThree.map((p, idx) => {
                const isCenter = idx === 1;
                return (
                  <div
                    key={p.productId}
                    className={isCenter ? "sm:-mt-14 sm:self-start" : "sm:self-end"}
                  >
                    <Link
                      href={`/tienda/${slug}/p/${p.productId}`}
                      className="group block overflow-hidden rounded-xl border no-underline transition-all duration-300 ease-out hover:-translate-y-1.5"
                      style={{
                        borderColor: "var(--ts-border)",
                        backgroundColor: "var(--ts-surface)",
                        boxShadow: "0 6px 28px -8px color-mix(in srgb, var(--ts-primary) 18%, transparent)",
                      }}
                      aria-label={p.name}
                    >
                      <div
                        className="relative overflow-hidden"
                        style={{
                          aspectRatio: "3 / 5",
                          maxHeight: "420px",
                          backgroundColor: "var(--ts-editorial-muted)"
                        }}
                      >
                        {p.imageUrl?.trim() ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.imageUrl.trim()}
                            alt=""
                            className="h-full w-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--ts-muted)" }}>
                            Sin foto
                          </div>
                        )}
                        <div className="absolute left-2 top-2 flex flex-col gap-1">
                          {newIds.has(p.productId) && (
                            <span
                              className="px-2 py-0.5 text-[10px] font-bold uppercase"
                              style={{ backgroundColor: "var(--ts-primary)", color: "var(--ts-on-primary)" }}
                            >
                              {cfg.uiTexts.newBadge || "Nuevo"}
                            </span>
                          )}
                          {saleIds.has(p.productId) && (
                            <span
                              className="px-2 py-0.5 text-[10px] font-bold uppercase"
                              style={{ backgroundColor: "var(--ts-secondary)", color: "var(--ts-on-secondary)" }}
                            >
                              {cfg.uiTexts.saleBadge || "Oferta"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="px-3 pb-3 pt-2">
                        <p className="line-clamp-2 text-sm font-bold transition-colors duration-300 group-hover:text-[var(--ts-primary)]" style={{ color: "var(--ts-text)" }}>
                          {p.name}
                        </p>
                        <p className="mt-0.5 text-sm" style={{ color: "var(--ts-muted)" }}>
                          {formatPrice(p.minPrice, currency)}
                          {p.maxPrice !== p.minPrice ? ` – ${formatPrice(p.maxPrice, currency)}` : ""}
                        </p>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Nuestros productos ── */}
      {productsRow.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          {sectionIntro("Nuestros productos", "Una selección de lo mejor del catálogo, con precios claros.")}
          {outlineCta(catalogoHref, "Ver todo")}

          <ul className="mt-12 grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-8">
            {productsRow.map((p) => (
              <li key={p.productId}>
                <Link
                  href={`/tienda/${slug}/p/${p.productId}`}
                  className="group block overflow-hidden rounded-xl border no-underline transition-all duration-300 ease-out hover:-translate-y-1.5"
                  style={{
                    borderColor: "var(--ts-border)",
                    backgroundColor: "var(--ts-surface)",
                    boxShadow: "0 6px 28px -8px color-mix(in srgb, var(--ts-primary) 18%, transparent)",
                  }}
                >
                  <div
                    className="aspect-square w-full overflow-hidden"
                    style={{ backgroundColor: "var(--ts-editorial-muted)" }}
                  >
                    {p.imageUrl?.trim() ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl.trim()}
                        alt=""
                        className="h-full w-full object-cover object-center transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--ts-muted)" }}>
                        Sin foto
                      </div>
                    )}
                  </div>
                  <div className="px-3 pb-3 pt-3 text-left">
                    <h3 className="text-base font-bold leading-snug transition-colors duration-300 group-hover:text-[var(--ts-primary)]" style={{ color: "var(--ts-text)", fontFamily: headingFont || "inherit" }}>
                      {p.name}
                    </h3>
                    <p className="mt-1 text-sm" style={{ color: "var(--ts-text)" }}>
                      {formatPrice(p.minPrice, currency)}
                      {p.maxPrice !== p.minPrice ? ` – ${formatPrice(p.maxPrice, currency)}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Empty state */}
      {allCards.length === 0 && (
        <div className="mx-auto max-w-6xl px-4 py-24 text-center sm:px-6">
          <p
            className="text-2xl font-semibold tracking-tight"
            style={{ color: "var(--ts-muted)", fontFamily: headingFont || "inherit" }}
          >
            Próximamente
          </p>
          <p className="mt-3 text-sm" style={{ color: "var(--ts-muted)" }}>
            Estamos preparando el catálogo.
          </p>
          <div className="mt-8">{outlineCta(catalogoHref, "Ver catálogo")}</div>
        </div>
      )}
    </div>
  );
}
