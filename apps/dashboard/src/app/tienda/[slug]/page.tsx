import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@waseller/db";
import { getBackendServices } from "@/lib/backend-services";

type PageProps = { params: Promise<{ slug: string }> };

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

export default async function TiendaPublicPage({ params }: PageProps) {
  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { id: true, name: true }
  });
  if (!tenant?.id) notFound();

  const rows = await getBackendServices().products.listPublicCatalogByTenant(tenant.id);
  const cards = groupCatalogProducts(rows);

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
                href={`/tienda/${slug}/p/${p.productId}`}
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
