import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@waseller/db";
import { getBackendServices } from "@/lib/backend-services";
import { ProductGallery } from "./product-gallery.client";

type PageProps = {
  params: Promise<{ slug: string; productId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const CATALOG_FILTER_KEYS = ["categoryId", "q", "talle", "color", "marca"] as const;

function firstSearchParam(
  sp: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | undefined {
  if (!sp) return undefined;
  const v = sp[key];
  if (Array.isArray(v)) {
    const s = String(v[0] ?? "").trim();
    return s || undefined;
  }
  const s = String(v ?? "").trim();
  return s || undefined;
}

function buildCatalogHref(slug: string, sp: Record<string, string | string[] | undefined> | undefined): string {
  const qs = new URLSearchParams();
  for (const k of CATALOG_FILTER_KEYS) {
    const v = firstSearchParam(sp, k);
    if (v) qs.set(k, v);
  }
  const tail = qs.toString();
  return tail ? `/tienda/${slug}/catalogo?${tail}` : `/tienda/${slug}/catalogo`;
}

const money = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

function uniqPreserveOrder(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const s = String(it ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, productId } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { id: true, name: true }
  });
  if (!tenant?.id) return { title: "Producto" };
  const { variants } = await getBackendServices().products.getPublicProductDetailsByTenant(tenant.id, productId);
  const first = variants[0];
  if (!first) return { title: `${tenant.name} · Producto` };
  return {
    title: `${first.name} · ${tenant.name}`,
    description: `Detalles de ${first.name} en el catálogo de ${tenant.name}.`
  };
}

export default async function TiendaProductoPage({ params, searchParams }: PageProps) {
  const { slug, productId } = await params;
  const sp = (await searchParams) ?? {};
  const catalogHref = buildCatalogHref(slug, sp);
  const hasCatalogFilters = CATALOG_FILTER_KEYS.some((k) => firstSearchParam(sp, k));

  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { id: true, name: true }
  });
  if (!tenant?.id) notFound();

  const { variants: rows, categories } = await getBackendServices().products.getPublicProductDetailsByTenant(
    tenant.id,
    productId,
  );
  const first = rows[0];
  if (!first) notFound();

  const productImages = first.imageUrls ?? [];
  const variantImages = rows.flatMap((r) => r.variantImageUrls ?? []);
  const gallery = uniqPreserveOrder([...variantImages, ...productImages]);

  const minPrice = Math.min(...rows.map((r) => r.effectivePrice));
  const maxPrice = Math.max(...rows.map((r) => r.effectivePrice));
  const totalAvailable = rows.reduce((acc, r) => acc + (r.availableStock ?? 0), 0);

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4 pb-16 pt-10 sm:px-6">
      <header className="mb-6 flex flex-col gap-2">
        <Link
          href={catalogHref}
          title={
            hasCatalogFilters
              ? "Volvé al listado manteniendo categoría, búsqueda y filtros de talle, color o marca."
              : "Volvé al listado del catálogo público"
          }
          className="text-sm font-medium text-[var(--ts-primary)] hover:underline"
        >
          ← Volver al catálogo
          {hasCatalogFilters ? (
            <span className="ml-1.5 text-xs font-normal text-[var(--ts-muted)]">(mismos filtros)</span>
          ) : null}
        </Link>
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--ts-muted)]">{tenant.name}</p>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Galería tipo ecommerce: principal + miniaturas */}
        <section>
          <ProductGallery name={first.name} images={gallery} />
        </section>

        {/* Panel derecho: info tipo Mercado Libre */}
        <aside className="flex flex-col gap-5">
          <div className="rounded-2xl border border-[var(--ts-border)] bg-[var(--ts-surface)] p-5 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--ts-text)]">{first.name}</h1>
            {categories.length > 0 ? (
              <nav className="mt-2 flex flex-wrap gap-2" aria-label="Categorías">
                {categories.map((c) => (
                  <span
                    key={c.id}
                    className="rounded-md bg-[var(--ts-bg)] px-2 py-1 text-xs font-medium text-[var(--ts-muted)] ring-1 ring-[var(--ts-border)]"
                  >
                    {c.name}
                  </span>
                ))}
              </nav>
            ) : null}
            <p className="mt-3 text-3xl font-semibold text-[var(--ts-text)]">
              {minPrice === maxPrice ? money(minPrice) : `${money(minPrice)} — ${money(maxPrice)}`}
            </p>
            <p className="mt-2 text-sm text-[var(--ts-muted)]">
              {rows.length > 1 ? `${rows.length} variantes` : "1 variante"} · {totalAvailable} u. disponibles
            </p>
            {first.tags?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {first.tags.slice(0, 12).map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-[var(--ts-border)] bg-[var(--ts-bg)] px-3 py-1 text-xs font-medium text-[var(--ts-muted)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-[var(--ts-border)] bg-[var(--ts-surface)] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ts-muted)]">Variantes</h2>
            <div className="mt-4 grid gap-3">
              {rows.map((v) => (
                <div
                  key={v.variantId}
                  className="rounded-xl border border-[var(--ts-border)] bg-[var(--ts-bg)] p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-[var(--ts-muted)]">{v.sku}</div>
                      <div className="mt-1 text-sm font-medium text-[var(--ts-text)]">
                        {(() => {
                          const bits: string[] = [];
                          if (v.variantTalle?.trim()) bits.push(`Talle ${v.variantTalle.trim()}`);
                          if (v.variantColor?.trim()) bits.push(`Color ${v.variantColor.trim()}`);
                          if (v.variantMarca?.trim()) bits.push(`Marca ${v.variantMarca.trim()}`);
                          const attrStr =
                            Object.keys(v.attributes ?? {}).length > 0
                              ? Object.entries(v.attributes)
                                  .slice(0, 8)
                                  .map(([k, val]) => `${k}: ${val}`)
                                  .join(" · ")
                              : "";
                          if (attrStr) bits.push(attrStr);
                          return bits.length > 0 ? bits.join(" · ") : "Sin atributos";
                        })()}
                      </div>
                      {(() => {
                        const vn = (v as { variantCategoryNames?: string[] }).variantCategoryNames;
                        if (!vn?.length) return null;
                        return (
                          <div
                            className="mt-2 flex flex-wrap gap-1.5"
                            aria-label="Categorías de esta variante"
                          >
                            {vn.map((n) => (
                              <span
                                key={n}
                                className="rounded border border-dashed border-[var(--ts-border)] bg-[var(--ts-surface)] px-2 py-0.5 text-[10px] font-medium text-[var(--ts-muted)]"
                              >
                                {n}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[var(--ts-text)]">{money(v.effectivePrice)}</div>
                      <div className="text-xs text-[var(--ts-muted)]">{v.availableStock} u.</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-[var(--ts-muted)]">
              Precios y stock orientativos. Para comprar o reservar, escribinos por WhatsApp.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

