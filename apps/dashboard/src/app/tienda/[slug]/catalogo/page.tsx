import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@waseller/db";
import { normalizeStoreConfig } from "@waseller/shared";
import { getBackendServices } from "@/lib/backend-services";
import { getTenantBySlug } from "../_lib/get-tenant";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{
    categoryId?: string;
    q?: string;
    talle?: string;
    color?: string;
    marca?: string;
  }>;
};

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
  minPrice: number;
  maxPrice: number;
  totalAvailable: number;
  variantCount: number;
};

type FlatCategory = {
  row: { id: string; name: string };
  depth: number;
  isLast: boolean;
};

type Facets = {
  talles: string[];
  colors: string[];
  marcas: string[];
};

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
        minPrice: r.effectivePrice,
        maxPrice: r.effectivePrice,
        totalAvailable: r.availableStock,
        variantCount: 1,
      });
    } else {
      prev.minPrice = Math.min(prev.minPrice, r.effectivePrice);
      prev.maxPrice = Math.max(prev.maxPrice, r.effectivePrice);
      prev.totalAvailable += r.availableStock;
      prev.variantCount += 1;
      if (!prev.imageUrl && r.imageUrl) prev.imageUrl = r.imageUrl;
    }
  }
  return [...map.values()];
}

function buildTree<
  T extends {
    id: string;
    parentId: string | null;
    name: string;
    sortOrder: number;
  },
>(rows: T[]) {
  const byId = new Map<string, T>();
  const childrenByParent = new Map<string | null, T[]>();
  for (const r of rows) {
    byId.set(r.id, r);
    const k = r.parentId ?? null;
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k)!.push(r);
  }
  for (const [, list] of childrenByParent)
    list.sort(
      (a, b) =>
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        a.name.localeCompare(b.name, "es"),
    );
  const flattened: Array<{ row: T; depth: number; isLast: boolean }> = [];
  const visit = (parentId: string | null, depth: number) => {
    const kids = childrenByParent.get(parentId) ?? [];
    kids.forEach((kid, idx) => {
      flattened.push({ row: kid, depth, isLast: idx === kids.length - 1 });
      visit(kid.id, depth + 1);
    });
  };
  visit(null, 0);
  return flattened;
}

const PRICE_FORMATTER = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 0,
});
function formatPrice(n: number): string {
  return `$${PRICE_FORMATTER.format(Math.max(0, Math.round(n)))}`;
}
function priceLabel(c: ProductCard): string {
  if (!Number.isFinite(c.minPrice)) return "";
  if (c.minPrice === c.maxPrice) return formatPrice(c.minPrice);
  return `desde ${formatPrice(c.minPrice)}`;
}

const TABULAR: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum","lnum"',
};

/* ────────────────────────────────────────────────────────────
   Filter field — etiqueta uppercase + control flat (underline)
   ──────────────────────────────────────────────────────────── */

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span
        className="text-[10px] font-bold uppercase tracking-[0.24em]"
        style={{ color: "var(--ts-muted)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const fieldControlClass =
  "min-h-[40px] w-full border-b bg-transparent px-0 py-2 text-sm focus:outline-none focus:border-current";

/* ────────────────────────────────────────────────────────────
   Form de filtros — vertical, reutilizable (sidebar + mobile)
   ──────────────────────────────────────────────────────────── */

function FiltersForm({
  slug,
  filterCategoryId,
  filterQ,
  filterTalle,
  filterColor,
  filterMarca,
  hasFilters,
  flatCategories,
  facets,
  searchPlaceholder,
  filterBtnText,
}: {
  slug: string;
  filterCategoryId?: string;
  filterQ?: string;
  filterTalle?: string;
  filterColor?: string;
  filterMarca?: string;
  hasFilters: boolean;
  flatCategories: FlatCategory[];
  facets: Facets;
  searchPlaceholder: string;
  filterBtnText: string;
}) {
  return (
    <form
      method="get"
      action={`/tienda/${slug}/catalogo`}
      role="search"
      className="flex flex-col gap-5"
    >
      <FilterField label="">
        <input
          type="search"
          name="q"
          defaultValue={filterQ ?? ""}
          placeholder={searchPlaceholder}
          className={`${fieldControlClass}`}
          style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
        />
      </FilterField>

      {flatCategories.length > 0 && (
        <FilterField label="Categoría">
          <select
            name="categoryId"
            defaultValue={filterCategoryId ?? ""}
            className={fieldControlClass}
            style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
          >
            <option value="">Todas las categorías</option>
            {flatCategories.map(({ row: c, depth, isLast }) => {
              const prefix =
                depth === 0
                  ? ""
                  : `${"│ ".repeat(Math.max(0, depth - 1))}${isLast ? "└─ " : "├─ "}`;
              return (
                <option key={c.id} value={c.id}>{`${prefix}${c.name}`}</option>
              );
            })}
          </select>
        </FilterField>
      )}

      {facets.talles.length > 0 && (
        <FilterField label="Talle">
          <select
            name="talle"
            defaultValue={filterTalle ?? ""}
            className={fieldControlClass}
            style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
          >
            <option value="">Todos</option>
            {facets.talles.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {filterTalle && !facets.talles.includes(filterTalle) && (
              <option value={filterTalle}>{filterTalle}</option>
            )}
          </select>
        </FilterField>
      )}

      {facets.colors.length > 0 && (
        <FilterField label="Color">
          <select
            name="color"
            defaultValue={filterColor ?? ""}
            className={fieldControlClass}
            style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
          >
            <option value="">Todos</option>
            {facets.colors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {filterColor && !facets.colors.includes(filterColor) && (
              <option value={filterColor}>{filterColor}</option>
            )}
          </select>
        </FilterField>
      )}

      {facets.marcas.length > 0 && (
        <FilterField label="Marca">
          <select
            name="marca"
            defaultValue={filterMarca ?? ""}
            className={fieldControlClass}
            style={{ borderColor: "var(--ts-border)", color: "var(--ts-text)" }}
          >
            <option value="">Todas</option>
            {facets.marcas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {filterMarca && !facets.marcas.includes(filterMarca) && (
              <option value={filterMarca}>{filterMarca}</option>
            )}
          </select>
        </FilterField>
      )}

      <div className="mt-2 flex flex-col gap-3">
        <button
          type="submit"
          className="inline-flex min-h-[42px] w-full items-center justify-between gap-2 px-4 text-[10px] font-bold uppercase tracking-[0.24em] transition-opacity hover:opacity-90"
          style={{
            backgroundColor: "var(--ts-primary)",
            color: "var(--ts-on-primary)",
          }}
        >
          <span>{filterBtnText}</span>
          <span aria-hidden>→</span>
        </button>
        {hasFilters && (
          <Link
            href={`/tienda/${slug}/catalogo`}
            className="inline-flex items-center justify-center gap-2 py-1 text-[10px] font-bold uppercase tracking-[0.24em] no-underline transition-opacity hover:opacity-70"
            style={{ color: "var(--ts-muted)" }}
          >
            <span aria-hidden>×</span>
            Limpiar filtros
          </Link>
        )}
      </div>
    </form>
  );
}

/* ────────────────────────────────────────────────────────────
   Card del catálogo — uniforme, optimizada para compra
   ──────────────────────────────────────────────────────────── */

function CatalogCard({
  p,
  slug,
  listQs,
  isNew,
  isSale,
  newLabel,
  saleLabel,
  headingFont,
}: {
  p: ProductCard;
  slug: string;
  listQs: string;
  isNew: boolean;
  isSale: boolean;
  newLabel: string;
  saleLabel: string;
  headingFont?: string;
}) {
  const outOfStock = p.totalAvailable <= 0;
  const lowStock = !outOfStock && p.totalAvailable <= 2;

  return (
    <Link
      href={`/tienda/${slug}/p/${p.productId}${listQs}`}
      className="group flex h-full min-h-0 flex-col overflow-hidden rounded-xl border no-underline shadow-[0_4px_24px_-12px_color-mix(in_srgb,var(--ts-text)_18%,transparent)] transition-[box-shadow,border-color] duration-300 hover:shadow-[0_12px_36px_-14px_color-mix(in_srgb,var(--ts-primary)_28%,transparent)]"
      style={{
        color: "var(--ts-text)",
        borderColor: "var(--ts-border)",
        backgroundColor: "var(--ts-surface)",
      }}
      aria-label={`Ver detalles de ${p.name}`}
    >
      {/* Frame de imagen */}
      <div
        className="relative aspect-[4/5] w-full shrink-0 overflow-hidden"
        style={{ backgroundColor: "var(--ts-editorial-muted)" }}
      >
        {p.imageUrl?.trim() ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imageUrl.trim()}
            alt=""
            className="h-full w-full object-cover object-center transition-transform duration-[900ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.05]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-3 text-center">
            <span
              className="text-[10px] font-bold uppercase tracking-[0.28em]"
              style={{ color: "var(--ts-muted)" }}
            >
              Sin imagen
            </span>
          </div>
        )}

        {/* Badges (Nuevo / Oferta) — top-left, stacked */}
        <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5">
          {isNew ? (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-[3px] text-[8.5px] font-bold uppercase tracking-[0.22em]"
              style={{
                backgroundColor: "var(--ts-surface)",
                color: "var(--ts-text)",
              }}
            >
              <span
                aria-hidden
                className="h-1 w-1 rounded-full"
                style={{ backgroundColor: "var(--ts-primary)" }}
              />
              {newLabel}
            </span>
          ) : null}
          {isSale ? (
            <span
              className="inline-block px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.22em]"
              style={{
                backgroundColor: "var(--ts-secondary)",
                color: "var(--ts-on-secondary)",
                transform: "rotate(-4deg)",
                transformOrigin: "top left",
                boxShadow:
                  "0 6px 16px -10px color-mix(in srgb, var(--ts-secondary) 80%, transparent)",
              }}
            >
              {saleLabel}
            </span>
          ) : null}
        </div>

        {/* Stock urgency — bottom-right */}
        {lowStock ? (
          <div className="pointer-events-none absolute bottom-2.5 right-2.5">
            <span
              className="inline-block px-2 py-[3px] text-[8.5px] font-bold uppercase tracking-[0.2em]"
              style={{
                backgroundColor: "var(--ts-surface)",
                color: "var(--ts-text)",
              }}
            >
              Últimas {p.totalAvailable}
            </span>
          </div>
        ) : null}

        {/* Out of stock overlay */}
        {outOfStock ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--ts-bg) 65%, transparent)",
            }}
          >
            <span
              className="inline-block px-3 py-1 text-[9px] font-bold uppercase tracking-[0.26em]"
              style={{
                backgroundColor: "var(--ts-surface)",
                color: "var(--ts-text)",
              }}
            >
              Sin stock
            </span>
          </div>
        ) : null}

        {/* Hover ring */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-shadow duration-500 group-hover:shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--ts-primary)_50%,transparent)]"
        />
      </div>

      {/* Texto: nombre + precio — mismo bloque que la imagen */}
      <div
        className="flex min-h-[4.5rem] flex-1 flex-col justify-between gap-2 border-t px-3 py-3 sm:min-h-[4.75rem] sm:px-3.5 sm:py-3.5"
        style={{
          borderColor: "color-mix(in srgb, var(--ts-border) 85%, transparent)",
        }}
      >
        <h3
          className="line-clamp-2 min-h-[2.6em] text-[12.5px] font-medium leading-snug sm:text-[13px]"
          style={{ color: "var(--ts-text)" }}
          title={p.name}
        >
          {p.name}
        </h3>
        <div className="flex items-baseline justify-between gap-2">
          <p
            className="text-[13.5px] font-bold leading-none sm:text-sm"
            style={{
              ...TABULAR,
              color: outOfStock ? "var(--ts-muted)" : "var(--ts-text)",
              fontFamily: headingFont || "inherit",
              textDecoration: outOfStock ? "line-through" : "none",
            }}
          >
            {priceLabel(p)}
          </p>
          {p.variantCount > 1 && !outOfStock ? (
            <span
              className="shrink-0 text-[9px] font-bold uppercase tracking-[0.2em]"
              style={{ color: "var(--ts-muted)" }}
            >
              +opciones
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────
   Metadata
   ──────────────────────────────────────────────────────────── */

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { title: "Catálogo" };
  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const name = cfg.brand.storeName || tenant.name;
  return { title: `${name} · Catálogo` };
}

/* ────────────────────────────────────────────────────────────
   Página
   ──────────────────────────────────────────────────────────── */

export default async function TiendaCatalogoPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};

  const filterCategoryId = sp.categoryId?.trim() || undefined;
  const filterQ = sp.q?.trim() || undefined;
  const filterTalle = sp.talle?.trim() || undefined;
  const filterColor = sp.color?.trim() || undefined;
  const filterMarca = sp.marca?.trim() || undefined;
  const activeFilterCount = [
    filterCategoryId,
    filterQ,
    filterTalle,
    filterColor,
    filterMarca,
  ].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const storeName = cfg.brand.storeName || tenant.name;
  const searchPlaceholder =
    cfg.uiTexts.searchPlaceholder || "Buscar productos…";
  const filterBtnText = cfg.uiTexts.filterText || "Aplicar filtros";
  const headingFont = cfg.typography.headingFont
    ? `"${cfg.typography.headingFont}", serif`
    : undefined;
  const newIds = new Set(cfg.featured.newProductIds);
  const saleIds = new Set(cfg.featured.saleProductIds);
  const newBadgeLabel = cfg.uiTexts.newBadge || "Nuevo";
  const saleBadgeLabel = cfg.uiTexts.saleBadge || "Oferta";

  const categoryRows = await prisma.category.findMany({
    where: { tenantId: tenant.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, parentId: true, name: true, sortOrder: true },
  });
  const flatCategories = buildTree(categoryRows);
  const activeCategoryName = filterCategoryId
    ? categoryRows.find((c: { id: string }) => c.id === filterCategoryId)?.name
    : null;

  const s = getBackendServices().products;
  const [rows, facets] = await Promise.all([
    s.listPublicCatalogByTenant(tenant.id, {
      categoryId: filterCategoryId,
      q: filterQ,
      talle: filterTalle,
      color: filterColor,
      marca: filterMarca,
    }),
    s.listVariantFacetDistinctValues(tenant.id, {
      categoryId: filterCategoryId,
      publicCatalog: true,
    }),
  ]);
  const cards = groupProducts(rows);

  const listQs = (() => {
    const p = new URLSearchParams();
    if (filterCategoryId) p.set("categoryId", filterCategoryId);
    if (filterQ) p.set("q", filterQ);
    if (filterTalle) p.set("talle", filterTalle);
    if (filterColor) p.set("color", filterColor);
    if (filterMarca) p.set("marca", filterMarca);
    return p.toString() ? `?${p.toString()}` : "";
  })();

  /** Título principal: categoría, búsqueda o nada (evita “Catálogo” redundante con breadcrumb). */
  const titleMain = activeCategoryName
    ? activeCategoryName
    : filterQ
      ? `“${filterQ}”`
      : null;

  const filtersFormProps = {
    slug,
    filterCategoryId,
    filterQ,
    filterTalle,
    filterColor,
    filterMarca,
    hasFilters,
    flatCategories,
    facets,
    searchPlaceholder,
    filterBtnText,
  };

  return (
    <div className={`${SHELL} pb-20 pt-5 sm:pt-6 lg:pt-5`}>
      {/* Breadcrumb */}
      <nav
        className="mb-4 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.24em] lg:mb-3"
        aria-label="Breadcrumb"
      >
        <Link
          href={`/tienda/${slug}`}
          className="no-underline transition-opacity hover:opacity-70"
          style={{ color: "var(--ts-muted)" }}
        >
          Inicio
        </Link>
        <span aria-hidden style={{ color: "var(--ts-border)" }}>
          /
        </span>
        {activeCategoryName ? (
          <>
            <Link
              href={`/tienda/${slug}/catalogo`}
              className="no-underline transition-opacity hover:opacity-70"
              style={{ color: "var(--ts-muted)" }}
            >
              Catálogo
            </Link>
            <span aria-hidden style={{ color: "var(--ts-border)" }}>
              /
            </span>
            <span style={{ color: "var(--ts-text)" }}>
              {activeCategoryName}
            </span>
          </>
        ) : (
          <span style={{ color: "var(--ts-text)" }}>Catálogo</span>
        )}
      </nav>

      {/* Layout: sidebar + grid (lg+) | columna única (mobile) */}
      <div className="grid grid-cols-1 gap-y-0 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-x-8 xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-x-10">
        {/* Sidebar: filtros — solo lg+ */}
        <aside className="hidden min-w-0 lg:block" aria-label="Filtros">
          <div
            className="sticky top-[5.25rem] border-t pt-6"
            style={{ borderColor: "var(--ts-border)" }}
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <p
                className="text-[10px] font-bold uppercase tracking-[0.28em]"
                style={{ color: "var(--ts-text)" }}
              ></p>
              {activeFilterCount > 0 ? (
                <span
                  className="inline-flex h-5 min-w-[20px] items-center justify-center px-1.5 text-[9px] font-bold"
                  style={{
                    ...TABULAR,
                    backgroundColor: "var(--ts-primary)",
                    color: "var(--ts-on-primary)",
                  }}
                >
                  {activeFilterCount}
                </span>
              ) : null}
            </div>
            <FiltersForm {...filtersFormProps} />
          </div>
        </aside>

        {/* Columna principal: título contextual, filtros móvil, nombre tienda + grilla */}
        <div className="min-w-0">
          <details
            className="mb-5 border-y lg:hidden"
            style={{ borderColor: "var(--ts-border)" }}
          >
            <summary
              className="flex cursor-pointer list-none items-center justify-between py-4 text-[10px] font-bold uppercase tracking-[0.24em] [&::-webkit-details-marker]:hidden"
              style={{ color: "var(--ts-text)" }}
            >
              <span className="flex items-center gap-2">
                <span>Filtros</span>
                {activeFilterCount > 0 ? (
                  <span
                    className="inline-flex h-5 min-w-[20px] items-center justify-center px-1.5 text-[9px] font-bold"
                    style={{
                      ...TABULAR,
                      backgroundColor: "var(--ts-primary)",
                      color: "var(--ts-on-primary)",
                    }}
                  >
                    {activeFilterCount}
                  </span>
                ) : null}
              </span>
              <span
                aria-hidden
                className="text-[14px]"
                style={{ color: "var(--ts-muted)" }}
              >
                +
              </span>
            </summary>
            <div className="pb-6 pt-2">
              <FiltersForm {...filtersFormProps} />
            </div>
          </details>

          {/* Nombre de la tienda justo sobre la grilla (no en sidebar). Sin categoría/búsqueda, el nombre es el h1. */}
          <div
            className="mb-4 border-t pt-5 lg:mb-5 lg:border-t-0 lg:pt-0"
            style={{ borderColor: "var(--ts-border)" }}
          >
            {cfg.brand.tagline?.trim() ? (
              <p
                className="mt-1.5 max-w-xl text-[10px] leading-snug"
                style={{ color: "var(--ts-muted)" }}
              >
                {cfg.brand.tagline.trim()}
              </p>
            ) : null}
          </div>

          {cards.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center border-y py-20 text-center sm:py-24"
              style={{ borderColor: "var(--ts-border)" }}
            >
              <p
                className="text-[10px] font-bold uppercase tracking-[0.32em]"
                style={{ color: "var(--ts-muted)" }}
              >
                Sin resultados
              </p>
              <p
                className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl"
                style={{
                  color: "var(--ts-text)",
                  fontFamily: headingFont || "inherit",
                  letterSpacing: "-0.02em",
                }}
              >
                No encontramos productos
              </p>
              <p
                className="mt-3 max-w-sm text-sm leading-relaxed"
                style={{ color: "var(--ts-muted)" }}
              >
                Probá ajustar los filtros o buscar otro término. Si el catálogo
                recién se está poblando, vuelve más tarde.
              </p>
              {hasFilters && (
                <div className="mt-7">
                  <Link
                    href={`/tienda/${slug}/catalogo`}
                    className="group inline-flex items-center gap-3 border-b py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] no-underline"
                    style={{
                      borderColor: "var(--ts-text)",
                      color: "var(--ts-text)",
                    }}
                  >
                    <span>Ver todo el catálogo</span>
                    <span
                      aria-hidden
                      className="inline-block transition-transform duration-500 group-hover:translate-x-1.5"
                    >
                      →
                    </span>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-8 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-9">
              {cards.map((p) => {
                const isNew = newIds.has(p.productId);
                const isSale = saleIds.has(p.productId);
                return (
                  <li
                    key={p.productId}
                    className="flex h-full min-h-0 flex-col"
                  >
                    <CatalogCard
                      p={p}
                      slug={slug}
                      listQs={listQs}
                      isNew={isNew}
                      isSale={isSale}
                      newLabel={newBadgeLabel}
                      saleLabel={saleBadgeLabel}
                      headingFont={headingFont}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
