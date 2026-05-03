import Link from "next/link";
import { api } from "@/lib/api";
import { money } from "@/lib/money";

/** Home: hero del storeConfig + grilla de productos. Modificá libremente este layout para cada cliente. */
export default async function HomePage() {
  const [store, productsRes] = await Promise.all([api.getStore(), api.getProducts()]);
  /** Agrupar variantes por producto para mostrar tarjetas únicas. */
  const cards = Object.values(
    productsRes.variants.reduce<Record<string, { productId: string; name: string; minPrice: number; imageUrl?: string | null }>>((acc, v) => {
      const cur = acc[v.productId];
      if (!cur) {
        acc[v.productId] = { productId: v.productId, name: v.name, minPrice: v.effectivePrice, imageUrl: v.imageUrl };
      } else {
        cur.minPrice = Math.min(cur.minPrice, v.effectivePrice);
        if (!cur.imageUrl && v.imageUrl) cur.imageUrl = v.imageUrl;
      }
      return acc;
    }, {})
  ).slice(0, 12);

  const hero = store.config.hero;
  const heroBg = hero.backgroundImageUrl;

  return (
    <>
      {/* HERO */}
      {(hero.title || heroBg) && (
        <section
          style={{
            position: "relative",
            minHeight: "min(60vh, 480px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: store.config.colors.primary ?? "#1a1a1a",
            backgroundImage: heroBg ? `url(${heroBg})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            color: "#ffffff",
            textAlign: "center",
            padding: "48px 16px",
          }}
        >
          {heroBg && <div aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.35)" }} />}
          <div style={{ position: "relative", zIndex: 1, maxWidth: 720 }}>
            {hero.title && <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", margin: 0 }}>{hero.title}</h1>}
            {hero.subtitle && <p style={{ marginTop: 16, fontSize: 18, opacity: 0.9 }}>{hero.subtitle}</p>}
            {hero.ctaText && (
              <Link href={hero.ctaLink || "/catalogo"} className="btn" style={{ marginTop: 24, color: "#fff" }}>
                {hero.ctaText}
              </Link>
            )}
          </div>
        </section>
      )}

      {/* PRODUCTOS */}
      <section className="container" style={{ padding: "48px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 24 }}>
          <h2 style={{ margin: 0 }}>Productos</h2>
          <Link href="/catalogo" style={{ fontSize: 13, fontWeight: 600 }}>Ver todo →</Link>
        </div>
        {cards.length === 0 ? (
          <p style={{ color: "#888" }}>Próximamente: estamos preparando el catálogo.</p>
        ) : (
          <div className="grid grid-cols-4">
            {cards.map((c) => (
              <Link key={c.productId} href={`/p/${c.productId}`} style={{ display: "block" }}>
                <div style={{ aspectRatio: "4/5", background: "#f5f5f5", overflow: "hidden" }}>
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : null}
                </div>
                <div style={{ marginTop: 8, fontSize: 14 }}>{c.name}</div>
                <div style={{ fontSize: 13, color: "#666" }}>desde {money(c.minPrice)}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
