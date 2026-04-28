import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@waseller/db";
import { normalizeStoreConfig } from "@waseller/shared";
import { getBackendServices } from "@/lib/backend-services";

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

function groupProducts(rows: VariantRow[]): ProductCard[] {
  const map = new Map<string, ProductCard>();
  for (const r of rows) {
    const prev = map.get(r.productId);
    if (!prev) {
      map.set(r.productId, {
        productId: r.productId, name: r.name, imageUrl: r.imageUrl,
        minPrice: r.effectivePrice, maxPrice: r.effectivePrice,
        totalAvailable: r.availableStock, variantCount: 1
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

function buildTree<T extends { id: string; parentId: string | null; name: string; sortOrder: number }>(rows: T[]) {
  const byId = new Map<string, T>();
  const childrenByParent = new Map<string | null, T[]>();
  for (const r of rows) {
    byId.set(r.id, r);
    const k = r.parentId ?? null;
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k)!.push(r);
  }
  for (const [, list] of childrenByParent)
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "es"));
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { name: true, storeConfig: { select: { config: true } } }
  });
  if (!tenant) return { title: "Catálogo" };
  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const name = cfg.brand.storeName || tenant.name;
  return { title: `${name} · Catálogo` };
}

export default async function TiendaCatalogoPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};

  const filterCategoryId = sp.categoryId?.trim() || undefined;
  const filterQ = sp.q?.trim() || undefined;
  const filterTalle = sp.talle?.trim() || undefined;
  const filterColor = sp.color?.trim() || undefined;
  const filterMarca = sp.marca?.trim() || undefined;
  const hasFilters = !!(filterCategoryId || filterQ || filterTalle || filterColor || filterMarca);

  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { id: true, name: true, storeConfig: { select: { config: true } } }
  });
  if (!tenant) notFound();

  const cfg = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  const searchPlaceholder = cfg.uiTexts.searchPlaceholder || "Buscar productos…";
  const filterBtnText = cfg.uiTexts.filterText || "Filtrar";
  const headingFont = cfg.typography.headingFont ? `"${cfg.typography.headingFont}", serif` : undefined;
  const newIds = new Set(cfg.featured.newProductIds);
  const saleIds = new Set(cfg.featured.saleProductIds);
  const newBadgeLabel = cfg.uiTexts.newBadge || "Nuevo";
  const saleBadgeLabel = cfg.uiTexts.saleBadge || "Oferta";
  const categoryRows = await prisma.category.findMany({
    where: { tenantId: tenant.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, parentId: true, name: true, sortOrder: true }
  });
  const flatCategories = buildTree(categoryRows);
  const activeCategoryName = filterCategoryId
    ? categoryRows.find((c: { id: string }) => c.id === filterCategoryId)?.name
    : null;

  const s = getBackendServices().products;
  const [rows, facets] = await Promise.all([
    s.listPublicCatalogByTenant(tenant.id, {
      categoryId: filterCategoryId, q: filterQ,
      talle: filterTalle, color: filterColor, marca: filterMarca
    }),
    s.listVariantFacetDistinctValues(tenant.id, { categoryId: filterCategoryId, publicCatalog: true })
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

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6">

      {/* Breadcrumb */}
      <nav className="mb-5 flex items-center gap-2 text-xs" style={{ color: "var(--ts-muted)" }}>
        <Link href={`/tienda/${slug}`} className="no-underline hover:underline" style={{ color: "var(--ts-primary)" }}>
          Inicio
        </Link>
        <span>/</span>
        {activeCategoryName ? (
          <>
            <Link href={`/tienda/${slug}/catalogo`} className="no-underline hover:underline" style={{ color: "var(--ts-primary)" }}>
              Catálogo
            </Link>
            <span>/</span>
            <span style={{ color: "var(--ts-text)" }}>{activeCategoryName}</span>
          </>
        ) : (
          <span style={{ color: "var(--ts-text)" }}>Catálogo</span>
        )}
      </nav>

      {/* Filter bar */}
      <form
        method="get"
        action={`/tienda/${slug}/catalogo`}
        role="search"
        className="mb-8 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:flex-wrap sm:items-end"
        style={{ borderColor: "var(--ts-border)", backgroundColor: "var(--ts-surface)" }}
      >
        {flatCategories.length > 0 && (
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ts-muted)" }}>
            Categoría
            <select
              name="categoryId"
              defaultValue={filterCategoryId ?? ""}
              className="rounded-lg border px-3 py-2 text-sm font-normal normal-case"
              style={{ borderColor: "var(--ts-border)", backgroundColor: "var(--ts-bg)", color: "var(--ts-text)" }}
            >
              <option value="">Todas</option>
              {flatCategories.map(({ row: c, depth, isLast }) => {
                const prefix = depth === 0 ? "" : `${"│ ".repeat(Math.max(0, depth - 1))}${isLast ? "└─ " : "├─ "}`;
                return <option key={c.id} value={c.id}>{`${prefix}${c.name}`}</option>;
              })}
            </select>
          </label>
        )}

        <label className="flex min-w-[160px] flex-[1.2] flex-col gap-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ts-muted)" }}>
          Buscar
          <input
            type="search" name="q" defaultValue={filterQ ?? ""} placeholder={searchPlaceholder}
            className="rounded-lg border px-3 py-2 text-sm font-normal normal-case"
            style={{ borderColor: "var(--ts-border)", backgroundColor: "var(--ts-bg)", color: "var(--ts-text)" }}
          />
        </label>

        {facets.talles.length > 0 && (
          <label className="flex min-w-[100px] flex-col gap-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ts-muted)" }}>
            Talle
            <select name="talle" defaultValue={filterTalle ?? ""}
              className="rounded-lg border px-3 py-2 text-sm font-normal normal-case"
              style={{ borderColor: "var(--ts-border)", backgroundColor: "var(--ts-bg)", color: "var(--ts-text)" }}>
              <option value="">Todos</option>
              {facets.talles.map((t) => <option key={t} value={t}>{t}</option>)}
              {filterTalle && !facets.talles.includes(filterTalle) && <option value={filterTalle}>{filterTalle}</option>}
            </select>
          </label>
        )}

        {facets.colors.length > 0 && (
          <label className="flex min-w-[100px] flex-col gap-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ts-muted)" }}>
            Color
            <select name="color" defaultValue={filterColor ?? ""}
              className="rounded-lg border px-3 py-2 text-sm font-normal normal-case"
              style={{ borderColor: "var(--ts-border)", backgroundColor: "var(--ts-bg)", color: "var(--ts-text)" }}>
              <option value="">Todos</option>
              {facets.colors.map((c) => <option key={c} value={c}>{c}</option>)}
              {filterColor && !facets.colors.includes(filterColor) && <option value={filterColor}>{filterColor}</option>}
            </select>
          </label>
        )}

        {facets.marcas.length > 0 && (
          <label className="flex min-w-[110px] flex-col gap-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ts-muted)" }}>
            Marca
            <select name="marca" defaultValue={filterMarca ?? ""}
              className="rounded-lg border px-3 py-2 text-sm font-normal normal-case"
              style={{ borderColor: "var(--ts-border)", backgroundColor: "var(--ts-bg)", color: "var(--ts-text)" }}>
              <option value="">Todos</option>
              {facets.marcas.map((m) => <option key={m} value={m}>{m}</option>)}
              {filterMarca && !facets.marcas.includes(filterMarca) && <option value={filterMarca}>{filterMarca}</option>}
            </select>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ backgroundColor: "var(--ts-primary)", color: "var(--ts-on-primary)" }}
          >
            {filterBtnText}
          </button>
          {hasFilters && (
            <Link href={`/tienda/${slug}/catalogo`}
              className="rounded-lg border px-4 py-2 text-sm font-semibold no-underline"
              style={{ borderColor: "var(--ts-border)", color: "var(--ts-muted)" }}>
              Limpiar
            </Link>
          )}
        </div>
      </form>

      {/* Results */}
      {cards.length > 0 && (
        <p className="mb-5 text-xs" style={{ color: "var(--ts-muted)" }}>
          {cards.length} {cards.length === 1 ? "producto" : "productos"}
          {activeCategoryName ? ` en "${activeCategoryName}"` : ""}
        </p>
      )}

      {/* Mosaic product grid */}
      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-20 text-center"
          style={{ borderColor: "var(--ts-border)", backgroundColor: "var(--ts-surface)" }}>
          <p className="text-5xl mb-4">🛍️</p>
          <p className="font-semibold" style={{ color: "var(--ts-text)" }}>No hay productos disponibles</p>
          {hasFilters && (
            <Link href={`/tienda/${slug}/catalogo`} className="mt-4 text-sm no-underline hover:underline" style={{ color: "var(--ts-primary)" }}>
              Ver todos los productos
            </Link>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
          {cards.map((p, i) => {
            // Bento: every 7th starting at index 0 is wide (spans 2 cols)
            const isWide = i % 7 === 0;
            const isNew = newIds.has(p.productId);
            const isSale = saleIds.has(p.productId);
            return (
              <li key={p.productId} className={isWide ? "col-span-2" : ""}>
                <Link
                  href={`/tienda/${slug}/p/${p.productId}${listQs}`}
                  className="group block overflow-hidden rounded-2xl border no-underline transition-shadow hover:shadow-lg"
                  style={{ borderColor: "var(--ts-border)", backgroundColor: "var(--ts-surface)" }}
                  aria-label={`Ver detalles de ${p.name}`}
                >
                  <div
                    className="relative overflow-hidden"
                    style={{
                      aspectRatio: isWide ? "16/7" : "3/4",
                      backgroundColor: "var(--ts-bg)"
                    }}
                  >
                    {p.imageUrl?.trim() ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl.trim()}
                        alt={p.name}
                        className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.05]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-medium" style={{ color: "var(--ts-muted)" }}>
                        Sin foto
                      </div>
                    )}
                    {/* Badges */}
                    <div className="absolute left-2.5 top-2.5 flex flex-col gap-1">
                      {isNew && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                          style={{ backgroundColor: "var(--ts-primary)", color: "var(--ts-on-primary)" }}
                        >
                          {newBadgeLabel}
                        </span>
                      )}
                      {isSale && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                          style={{ backgroundColor: "var(--ts-secondary)", color: "var(--ts-on-secondary)" }}
                        >
                          {saleBadgeLabel}
                        </span>
                      )}
                    </div>
                    {p.totalAvailable <= 2 && p.totalAvailable > 0 && (
                      <span
                        className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur-sm"
                        style={{
                          backgroundColor: "color-mix(in srgb, var(--ts-secondary) 82%, var(--ts-bg))",
                          color: "var(--ts-text)",
                        }}
                      >
                        Últimas
                      </span>
                    )}
                  </div>
                  <div className={isWide ? "px-4 py-3" : "px-3 py-2.5"}>
                    <h2
                      className="line-clamp-2 font-medium leading-snug"
                      style={{
                        fontSize: isWide ? "0.95rem" : "0.8125rem",
                        color: "var(--ts-text)",
                        fontFamily: headingFont || "inherit"
                      }}
                    >
                      {p.name}
                    </h2>
                    {p.totalAvailable > 0 && (
                      <p className="mt-1 text-[11px]" style={{ color: "var(--ts-muted)" }}>
                        {p.totalAvailable} disponibles
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
