import Link from "next/link";
import { api } from "@/lib/api";
import { money } from "@/lib/money";

type SP = { categoryId?: string; q?: string; talle?: string; color?: string; marca?: string };

export default async function CatalogoPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = (await searchParams) ?? {};
  const [productsRes, categoriesRes, facetsRes] = await Promise.all([
    api.getProducts(sp),
    api.getCategories(),
    api.getFacets({ categoryId: sp.categoryId }),
  ]);

  /** Agrupar por producto. */
  const cards = Object.values(
    productsRes.variants.reduce<Record<string, { productId: string; name: string; minPrice: number; imageUrl?: string | null }>>((acc, v) => {
      const cur = acc[v.productId];
      if (!cur) acc[v.productId] = { productId: v.productId, name: v.name, minPrice: v.effectivePrice, imageUrl: v.imageUrl };
      else {
        cur.minPrice = Math.min(cur.minPrice, v.effectivePrice);
        if (!cur.imageUrl && v.imageUrl) cur.imageUrl = v.imageUrl;
      }
      return acc;
    }, {})
  );

  return (
    <div className="container" style={{ padding: "32px 16px" }}>
      <h1>Catálogo</h1>
      <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "24px 0", alignItems: "end" }}>
        <Field label="Buscar">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="…" style={inputStyle} />
        </Field>
        {categoriesRes.categories.length > 0 && (
          <Field label="Categoría">
            <select name="categoryId" defaultValue={sp.categoryId ?? ""} style={inputStyle}>
              <option value="">Todas</option>
              {categoriesRes.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        )}
        {facetsRes.talles.length > 0 && (
          <Field label="Talle">
            <select name="talle" defaultValue={sp.talle ?? ""} style={inputStyle}>
              <option value="">Todos</option>
              {facetsRes.talles.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        )}
        {facetsRes.colors.length > 0 && (
          <Field label="Color">
            <select name="color" defaultValue={sp.color ?? ""} style={inputStyle}>
              <option value="">Todos</option>
              {facetsRes.colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        )}
        {facetsRes.marcas.length > 0 && (
          <Field label="Marca">
            <select name="marca" defaultValue={sp.marca ?? ""} style={inputStyle}>
              <option value="">Todas</option>
              {facetsRes.marcas.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        )}
        <button type="submit" className="btn btn-primary">Filtrar</button>
      </form>

      {cards.length === 0 ? (
        <p style={{ color: "#888" }}>Sin resultados.</p>
      ) : (
        <div className="grid grid-cols-4">
          {cards.map((c) => (
            <Link key={c.productId} href={`/p/${c.productId}`}>
              <div style={{ aspectRatio: "4/5", background: "#f5f5f5", overflow: "hidden" }}>
                {c.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 14 }}>{c.name}</div>
              <div style={{ fontSize: 13, color: "#666" }}>desde {money(c.minPrice)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #ccc",
  fontSize: 13,
  background: "#fff",
  minWidth: 140,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#666" }}>
      {label}
      {children}
    </label>
  );
}
