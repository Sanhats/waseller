import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { money } from "@/lib/money";
import { AddToCart } from "./add-to-cart.client";

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  let detail;
  try {
    detail = await api.getProduct(productId);
  } catch (e) {
    notFound();
  }
  const first = detail.variants[0];
  if (!first) notFound();

  /** Galería: dedupea variant + product images. */
  const gallery = Array.from(
    new Set([
      ...detail.variants.flatMap((v) => v.variantImageUrls ?? []),
      ...(first.imageUrls ?? []),
    ].filter(Boolean))
  );

  const minPrice = Math.min(...detail.variants.map((v) => v.effectivePrice));
  const maxPrice = Math.max(...detail.variants.map((v) => v.effectivePrice));

  return (
    <div className="container" style={{ padding: "32px 16px" }}>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 32 }}>
        <div>
          {gallery.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gallery[0]} alt={first.name} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", background: "#f5f5f5" }} />
          ) : (
            <div style={{ aspectRatio: "1/1", background: "#f5f5f5" }} />
          )}
          {gallery.length > 1 && (
            <div className="grid grid-cols-4" style={{ marginTop: 8 }}>
              {gallery.slice(1, 5).map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt="" style={{ aspectRatio: "1/1", objectFit: "cover", background: "#f5f5f5" }} />
              ))}
            </div>
          )}
        </div>
        <div>
          <h1 style={{ marginTop: 0 }}>{first.name}</h1>
          <p style={{ fontSize: 22, fontWeight: 600 }}>
            {minPrice === maxPrice ? money(minPrice) : `${money(minPrice)} — ${money(maxPrice)}`}
          </p>
          {detail.categories.length > 0 && (
            <p style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {detail.categories.map((c) => c.name).join(" · ")}
            </p>
          )}
          <div style={{ marginTop: 24 }}>
            <AddToCart
              variants={detail.variants.map((v) => ({
                variantId: v.variantId,
                productId: v.productId,
                productName: v.name,
                sku: v.sku,
                variantTalle: v.variantTalle,
                variantColor: v.variantColor,
                variantMarca: v.variantMarca,
                unitPrice: v.effectivePrice,
                availableStock: v.availableStock,
                imageUrl: gallery[0],
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
