"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "../../components/app-sidebar";
import {
  StockEditProductModal,
  type StockProductVariantRow,
} from "@/components/stock-edit-product-modal";
import { StockCreateProductModal } from "@/components/stock-create-product-modal";
import {
  formatAxisLabel,
  StockGridTd,
  StockProductThumb,
  StockTableMobileHint,
  StockTableTh,
  stockGridCellBg,
  stockGridTableStyle,
} from "@/components/stock-ui";
import { StockTableSkeleton } from "@/components/page-skeletons";
import { Spinner } from "@/components/ui";
import { getClientApiBase } from "@/lib/api-base";

type VariantRow = StockProductVariantRow;

type CategoryFilterRow = {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
};

const authContext = (): { token: string; tenantId: string } | null => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
  if (!token || !tenantId) return null;
  return { token, tenantId };
};

export default function StockPage() {
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [axes, setAxes] = useState<string[]>(["talle", "color"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [hoveredVariantId, setHoveredVariantId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [editRows, setEditRows] = useState<StockProductVariantRow[] | null>(null);
  const [publicCatalogSlug, setPublicCatalogSlug] = useState<string | null>(null);
  const [catalogShareUrl, setCatalogShareUrl] = useState<string | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [categoryFilterList, setCategoryFilterList] = useState<CategoryFilterRow[]>([]);

  useEffect(() => {
    if (!publicCatalogSlug) {
      setCatalogShareUrl(null);
      return;
    }
    setCatalogShareUrl(`${window.location.origin}/tienda/${publicCatalogSlug}`);
  }, [publicCatalogSlug]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const firstVariantIdByProduct = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (!m.has(r.productId)) m.set(r.productId, r.variantId);
    }
    return m;
  }, [rows]);

  const load = async (snapshot?: { categoryId: string; q: string }) => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    try {
      const categoryId = (snapshot?.categoryId ?? filterCategoryId).trim();
      const q = (snapshot?.q ?? filterSearch).trim();
      const params = new URLSearchParams();
      if (categoryId) params.set("categoryId", categoryId);
      if (q) params.set("q", q);
      const qs = params.toString();

      const [productsRes, knowledgeRes] = await Promise.all([
        fetch(`${getClientApiBase()}/products${qs ? `?${qs}` : ""}`, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
          cache: "no-store",
        }),
        fetch(`${getClientApiBase()}/ops/tenant-knowledge`, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
          cache: "no-store",
        }),
      ]);
      if (!productsRes.ok) throw new Error(await productsRes.text());
      if (!knowledgeRes.ok) throw new Error(await knowledgeRes.text());
      setRows((await productsRes.json()) as VariantRow[]);
      const knowledge = (await knowledgeRes.json()) as {
        knowledge?: { productVariantAxes?: string[] };
        publicCatalogSlug?: string | null;
      };
      const loadedAxes = Array.isArray(knowledge?.knowledge?.productVariantAxes)
        ? knowledge.knowledge.productVariantAxes
            .map((item) => String(item ?? "").trim())
            .filter(Boolean)
        : [];
      setAxes(loadedAxes.length > 0 ? loadedAxes : ["talle", "color"]);
      const slug =
        typeof knowledge.publicCatalogSlug === "string" && knowledge.publicCatalogSlug.trim()
          ? knowledge.publicCatalogSlug.trim()
          : null;
      setPublicCatalogSlug(slug);
      setError("");
    } catch (err) {
      setPublicCatalogSlug(null);
      setError(err instanceof Error ? err.message : "No se pudo cargar stock");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const auth = authContext();
    if (!auth) return;
    (async () => {
      const res = await fetch(`${getClientApiBase()}/categories`, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
        },
        cache: "no-store",
      });
      if (res.ok) setCategoryFilterList((await res.json()) as CategoryFilterRow[]);
    })();
  }, []);

  const adjust = async (variantId: string, stockDelta: number) => {
    const auth = authContext();
    if (!auth) return;
    const response = await fetch(
      `${getClientApiBase()}/products/variants/${variantId}/adjust`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ stockDelta }),
      },
    );
    if (!response.ok) {
      // eslint-disable-next-line no-alert
      alert(await response.text());
      return;
    }
    await load();
  };

  return (
    <main
      style={{
        height: "100dvh",
        maxHeight: "100dvh",
        display: "flex",
        flexDirection: isMobile ? "column-reverse" : "row",
      }}
    >
      <AppSidebar active="stock" compact={isMobile} />
      <section
        style={{
          flex: 1,
          backgroundColor: "var(--color-bg)",
          color: "var(--color-text)",
          padding: isMobile ? 14 : 24,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 16,
            alignItems: isMobile ? "flex-start" : "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 26, letterSpacing: -0.3 }}>
              Inventario
            </h1>
            <a
              href="/stock/categories"
              style={{
                display: "inline-block",
                marginTop: 6,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-primary)",
                textDecoration: "none",
              }}
            >
              Gestionar categorías
            </a>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            style={{
              backgroundColor: "var(--color-primary)",
              color: "var(--color-surface)",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cargar producto nuevo
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "flex-end",
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface)",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600 }}>
            Categoría
            <select
              value={filterCategoryId}
              onChange={(e) => setFilterCategoryId(e.target.value)}
              style={{
                minWidth: 200,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                fontSize: 14,
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
            >
              <option value="">Todas (incluye subcategorías al filtrar)</option>
              {[...categoryFilterList]
                .sort(
                  (a, b) =>
                    a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, flex: "1 1 200px" }}>
            Buscar
            <input
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Nombre o etiqueta"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                fontSize: 14,
                background: "var(--color-bg)",
                color: "var(--color-text)",
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              backgroundColor: "var(--color-primary)",
              color: "var(--color-surface)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Filtrar
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterCategoryId("");
              setFilterSearch("");
              void load({ categoryId: "", q: "" });
            }}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "transparent",
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--color-muted)",
            }}
          >
            Limpiar
          </button>
        </div>

        {catalogShareUrl ? (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              backgroundColor: "var(--color-surface)",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: "var(--color-text)",
              }}
            >
              Tu catálogo público
            </div>
            <div
              style={{
                fontSize: 13,
                wordBreak: "break-all",
                marginBottom: 10,
                color: "var(--color-muted)",
              }}
            >
              {catalogShareUrl}
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(catalogShareUrl);
              }}
              style={{
                backgroundColor: "transparent",
                color: "var(--color-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Copiar enlace
            </button>
          </div>
        ) : null}

        <StockTableMobileHint />

        {loading ? (
          <Spinner className="mb-3" size="sm" label="Cargando inventario" />
        ) : null}
        {error ? (
          <p style={{ color: "var(--color-error)", marginBottom: 12 }}>
            {error}
          </p>
        ) : null}

        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: "var(--color-surface)",
          }}
          aria-busy={loading}
        >
          <div
            style={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              overscrollBehaviorX: "contain",
            }}
          >
            <table aria-label="Inventario por variante" style={stockGridTableStyle}>
              <caption
                style={{
                  captionSide: "top",
                  textAlign: "left",
                  padding: "12px 14px 10px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-text)",
                  ...stockGridCellBg(false),
                }}
              >
                Variantes en catálogo ({loading ? "…" : rows.length})
              </caption>
              <thead>
                <tr>
                  <StockTableTh
                    title="Imagen principal del producto (compartida por todas las variantes del mismo artículo)."
                    hint="Catálogo"
                  >
                    Foto
                  </StockTableTh>
                  <StockTableTh
                    title="Nombre comercial del producto. Varias filas pueden repetir este nombre si son variantes del mismo artículo."
                    hint="Mismo nombre en variantes"
                  >
                    Producto
                  </StockTableTh>
                  <StockTableTh
                    title="Categorías asignadas al producto (compartidas por todas sus variantes)."
                    hint="Catálogo"
                  >
                    Categorías
                  </StockTableTh>
                  <StockTableTh
                    title="Código único de inventario de esta variante. Lo usa el bot y los pedidos para identificar la fila exacta."
                    hint="Identificador único"
                  >
                    SKU
                  </StockTableTh>
                  {axes.map((axis) => (
                    <StockTableTh
                      key={axis}
                      title={`Valor de la variante para «${formatAxisLabel(axis)}», según la configuración de tu negocio.`}
                      hint="Variante"
                    >
                      {formatAxisLabel(axis)}
                    </StockTableTh>
                  ))}
                  <StockTableTh
                    title="Precio en pesos argentinos (ARS) que se usa para esta variante en conversaciones y checkout."
                    hint="ARS · por variante"
                  >
                    Precio venta
                  </StockTableTh>
                  <StockTableTh
                    title="Unidades totales contadas en depósito para esta variante, sin descontar reservas."
                    hint="Físico total"
                  >
                    Depósito
                  </StockTableTh>
                  <StockTableTh
                    title="Unidades apartadas por ventas o reservas en curso. Cuando se confirma o cancela, vuelve al depósito o se descuenta."
                    hint="Apartado"
                  >
                    Reservado
                  </StockTableTh>
                  <StockTableTh
                    title="Depósito menos reservado: lo que podés vender ahora sin superar stock real."
                    hint="Stock vendible"
                  >
                    Libre venta
                  </StockTableTh>
                  <StockTableTh
                    title="Suma o resta una unidad al depósito (ajuste rápido)."
                    hint="+1 / −1"
                  >
                    Ajuste
                  </StockTableTh>
                  <StockTableTh
                    title="Si la variante está desactivada, el catálogo del bot puede ignorarla según reglas del sistema."
                    hint="Catálogo"
                  >
                    Estado
                  </StockTableTh>
                  <StockTableTh
                    title="Solo en la primera fila de cada producto: abre el editor completo (nombre, imagen, variantes y altas nuevas)."
                    hint="Una por producto"
                  >
                    Editar
                  </StockTableTh>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <StockTableSkeleton rows={8} axisCount={axes.length} />
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={12 + axes.length}
                      style={{
                        padding: "32px 20px",
                        textAlign: "center",
                        ...stockGridCellBg(false),
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 16,
                          fontWeight: 600,
                          color: "var(--color-text)",
                        }}
                      >
                        No hay variantes cargadas
                      </p>
                      <p
                        style={{
                          margin: "10px 0 0",
                          fontSize: 14,
                          color: "var(--color-muted)",
                          maxWidth: 400,
                          marginLeft: "auto",
                          marginRight: "auto",
                        }}
                      >
                        Usá «Cargar producto nuevo» para dar de alta el
                        producto, sus ejes (
                        {axes.map((a) => formatAxisLabel(a)).join(", ")}) y al
                        menos una variante con stock.
                      </p>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const hi = hoveredVariantId === row.variantId;
                    return (
                      <tr
                        key={row.variantId}
                        onMouseEnter={() => setHoveredVariantId(row.variantId)}
                        onMouseLeave={() => setHoveredVariantId(null)}
                      >
                        <StockGridTd emphasize={hi} narrow style={{ width: 1 }}>
                          <StockProductThumb
                            imageUrl={row.imageUrl}
                            name={row.name}
                          />
                        </StockGridTd>
                        <StockGridTd emphasize={hi} style={{ fontWeight: 500 }}>
                          {row.name}
                        </StockGridTd>
                        <StockGridTd emphasize={hi} style={{ fontSize: 12, color: "var(--color-muted)", maxWidth: 200 }}>
                          {Array.isArray(row.categoryNames) && row.categoryNames.length > 0
                            ? row.categoryNames.slice(0, 3).join(", ") +
                              (row.categoryNames.length > 3 ? "…" : "")
                            : "—"}
                        </StockGridTd>
                        <StockGridTd
                          emphasize={hi}
                          style={{
                            fontWeight: 600,
                            fontFamily: "ui-monospace, monospace",
                            fontSize: 13,
                          }}
                        >
                          {row.sku}
                        </StockGridTd>
                        {axes.map((axis) => (
                          <StockGridTd
                            key={`${row.variantId}-${axis}`}
                            emphasize={hi}
                          >
                            {row.attributes?.[axis] ?? "—"}
                          </StockGridTd>
                        ))}
                        <StockGridTd
                          emphasize={hi}
                          style={{ fontWeight: 600, whiteSpace: "nowrap" }}
                        >
                          {new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          }).format(Number(row.effectivePrice))}
                        </StockGridTd>
                        <StockGridTd emphasize={hi} align="right" style={{ fontWeight: 600 }}>
                          {row.stock}
                        </StockGridTd>
                        <StockGridTd
                          emphasize={hi}
                          align="right"
                          style={{
                            color: "var(--color-warning)",
                            fontWeight: 600,
                          }}
                        >
                          {row.reservedStock}
                        </StockGridTd>
                        <StockGridTd
                          emphasize={hi}
                          align="right"
                          style={{
                            color:
                              row.availableStock > 0
                                ? "var(--color-success)"
                                : "var(--color-error)",
                            fontWeight: 600,
                          }}
                        >
                          {row.availableStock}
                        </StockGridTd>
                        <StockGridTd emphasize={hi}>
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            <button
                              type="button"
                              aria-label={`Sumar una unidad al depósito — ${row.name} ${row.sku}`}
                              onClick={() => void adjust(row.variantId, 1)}
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                border: "1px solid var(--color-border)",
                                cursor: "pointer",
                                fontWeight: 700,
                                touchAction: "manipulation",
                              }}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              aria-label={`Restar una unidad del depósito — ${row.name} ${row.sku}`}
                              onClick={() => void adjust(row.variantId, -1)}
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                border: "1px solid var(--color-border)",
                                cursor: "pointer",
                                fontWeight: 700,
                                touchAction: "manipulation",
                              }}
                            >
                              −
                            </button>
                          </div>
                        </StockGridTd>
                        <StockGridTd emphasize={hi}>
                          {row.isActive ? (
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--color-success)",
                                padding: "2px 8px",
                                borderRadius: 999,
                                backgroundColor: "var(--color-success-bg)",
                                border:
                                  "1px solid color-mix(in srgb, var(--color-success) 35%, transparent)",
                              }}
                            >
                              Activa
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--color-muted)",
                                padding: "2px 8px",
                                borderRadius: 999,
                                backgroundColor: "var(--color-disabled-bg)",
                                border: "1px solid var(--color-border)",
                              }}
                            >
                              Inactiva
                            </span>
                          )}
                        </StockGridTd>
                        <StockGridTd emphasize={hi} narrow align="center">
                          {firstVariantIdByProduct.get(row.productId) ===
                          row.variantId ? (
                            <button
                              type="button"
                              aria-label={`Editar producto ${row.name}`}
                              title="Editar producto"
                              onClick={() =>
                                setEditRows(
                                  rows.filter(
                                    (r) => r.productId === row.productId,
                                  ),
                                )
                              }
                              style={{
                                padding: "4px 10px",
                                borderRadius: 6,
                                border: "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)",
                                background: "var(--color-surface)",
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--color-primary)",
                              }}
                            >
                              Editar
                            </button>
                          ) : null}
                        </StockGridTd>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <StockCreateProductModal
          open={showModal}
          onClose={() => setShowModal(false)}
          onSaved={() => void load()}
          axes={axes}
          isMobile={isMobile}
        />

        {editRows != null && editRows.length > 0 ? (
          <StockEditProductModal
            open
            axes={axes}
            isMobile={isMobile}
            rows={editRows}
            onClose={() => setEditRows(null)}
            onSaved={() => void load()}
          />
        ) : null}
      </section>
    </main>
  );
}
