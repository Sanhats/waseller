import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@waseller/db";
import { getBackendServices } from "@/lib/backend-services";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ categoryId?: string; q?: string }>;
};

function categoryDepth(
  id: string,
  byId: Map<string, { parentId: string | null }>,
  memo: Map<string, number>,
): number {
  if (memo.has(id)) return memo.get(id)!;
  const row = byId.get(id);
  if (!row?.parentId) {
    memo.set(id, 0);
    return 0;
  }
  const d = 1 + categoryDepth(row.parentId, byId, memo);
  memo.set(id, d);
  return d;
}

const money = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

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

function groupCatalogProducts(rows: VariantRow[]): ProductCard[] {
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
        variantCount: 1
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { name: true }
  });
  if (!tenant) return { title: "Catálogo" };
  return {
    title: `${tenant.name} · Catálogo`,
    description: `Productos disponibles de ${tenant.name}.`
  };
}

export default async function TiendaPublicPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const filterCategoryId = typeof sp.categoryId === "string" && sp.categoryId.trim() ? sp.categoryId.trim() : undefined;
  const filterQ = typeof sp.q === "string" && sp.q.trim() ? sp.q.trim() : undefined;

  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { id: true, name: true }
  });
  if (!tenant?.id) notFound();

  const categoryRows: Array<{
    id: string;
    parentId: string | null;
    name: string;
    sortOrder: number;
  }> = await prisma.category.findMany({
    where: { tenantId: tenant.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, parentId: true, name: true, sortOrder: true }
  });
  const byId = new Map(categoryRows.map((c) => [c.id, c]));
  const depthMemo = new Map<string, number>();
  for (const c of categoryRows) categoryDepth(c.id, byId, depthMemo);

  const rows = await getBackendServices().products.listPublicCatalogByTenant(tenant.id, {
    categoryId: filterCategoryId,
    q: filterQ
  });
  const cards = groupCatalogProducts(rows);

  const listQs =
    filterCategoryId || filterQ
      ? `?${new URLSearchParams({
          ...(filterCategoryId ? { categoryId: filterCategoryId } : {}),
          ...(filterQ ? { q: filterQ } : {})
        }).toString()}`
      : "";

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4 pb-16 pt-10 sm:px-6">
      <header className="mb-10 border-b border-[var(--color-border)] pb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">Catálogo público</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-text)] sm:text-3xl">
          {tenant.name}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
          Precios y disponibilidad orientativos; consultá por WhatsApp para confirmar.
        </p>

        <form
          method="get"
          className="mt-8 flex max-w-3xl flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:flex-row sm:flex-wrap sm:items-end"
          action={`/tienda/${slug}`}
          role="search"
        >
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Categoría
            <select
              name="categoryId"
              defaultValue={filterCategoryId ?? ""}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-normal normal-case text-[var(--color-text)]"
            >
              <option value="">Todas (incluye subcategorías)</option>
              {[...categoryRows]
                .sort(
                  (a, b) =>
                    (depthMemo.get(a.id) ?? 0) - (depthMemo.get(b.id) ?? 0) ||
                    a.sortOrder - b.sortOrder ||
                    a.name.localeCompare(b.name, "es"),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${"— ".repeat(depthMemo.get(c.id) ?? 0)}${c.name}`}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex min-w-[180px] flex-[1.2] flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Buscar
            <input
              type="search"
              name="q"
              defaultValue={filterQ ?? ""}
              placeholder="Nombre o etiqueta"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-normal normal-case text-[var(--color-text)]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-surface)]"
            >
              Filtrar
            </button>
            {listQs ? (
              <Link
                href={`/tienda/${slug}`}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-muted)]"
              >
                Limpiar
              </Link>
            ) : null}
          </div>
        </form>
      </header>

      {cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-12 text-center text-sm text-[var(--color-muted)]">
          Todavía no hay productos activos en este catálogo.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((p) => (
            <li
              key={p.productId}
              className="flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
            >
              <Link
                href={`/tienda/${slug}/p/${p.productId}${listQs}`}
                className="group flex h-full flex-col focus:outline-none"
                aria-label={`Ver detalles de ${p.name}`}
              >
                <div className="relative aspect-[4/3] w-full bg-[var(--color-bg)]">
                  {p.imageUrl?.trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl.trim()}
                      alt={p.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-medium text-[var(--color-muted)]">
                      Sin foto
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <h2 className="line-clamp-2 text-base font-semibold leading-snug text-[var(--color-text)] group-hover:underline">
                    {p.name}
                  </h2>
                  <p className="text-lg font-semibold text-[var(--color-text)]">
                    {p.minPrice === p.maxPrice
                      ? money(p.minPrice)
                      : `${money(p.minPrice)} — ${money(p.maxPrice)}`}
                  </p>
                  <p className="mt-auto text-xs text-[var(--color-muted)]">
                    {p.variantCount > 1
                      ? `${p.variantCount} variantes · ${p.totalAvailable} u. disponibles`
                      : `${p.totalAvailable} u. disponibles`}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
