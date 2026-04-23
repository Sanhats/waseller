"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "../../components/app-sidebar";
import {
  StockEditProductModal,
  type StockProductVariantRow,
} from "@/components/stock-edit-product-modal";
import {
  formatAxisLabel,
  StockFieldHint,
  StockGridTd,
  StockProductThumb,
  StockSectionTitle,
  StockTableMobileHint,
  StockTableTh,
  stockGridCellBg,
  stockGridTableStyle,
} from "@/components/stock-ui";
import { StockTableSkeleton } from "@/components/page-skeletons";
import { Spinner } from "@/components/ui";
import { getClientApiBase } from "@/lib/api-base";
import { buildGeneratedSku } from "@/lib/stock-sku";

type VariantRow = StockProductVariantRow;

type DraftVariant = {
  id: string;
  sku: string;
  stock: number;
  price?: number | null;
  attributes: Record<string, string>;
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
  const [creating, setCreating] = useState(false);
  const [hoveredVariantId, setHoveredVariantId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [productName, setProductName] = useState("");
  const [basePrice, setBasePrice] = useState<number | "">("");
  const [imageUrl, setImageUrl] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [variantStock, setVariantStock] = useState<number | "">("");
  const [variantPrice, setVariantPrice] = useState<number | "">("");
  const [variantAttrs, setVariantAttrs] = useState<Record<string, string>>({});
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [editRows, setEditRows] = useState<StockProductVariantRow[] | null>(
    null,
  );
  const [publicCatalogSlug, setPublicCatalogSlug] = useState<string | null>(null);
  const [catalogShareUrl, setCatalogShareUrl] = useState<string | null>(null);

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

  const load = async () => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    try {
      const [productsRes, knowledgeRes] = await Promise.all([
        fetch(`${getClientApiBase()}/products`, {
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

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxWidth = 512;
        const maxHeight = 512;
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        } else if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }

        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context?.drawImage(img, 0, 0, width, height);
        setImageUrl(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(loadEvent.target?.result ?? "");
    };
    reader.readAsDataURL(file);
  };

  const addVariant = () => {
    const attrs = Object.fromEntries(
      Object.entries(variantAttrs)
        .map(([key, value]) => [key, String(value ?? "").trim()])
        .filter(([, value]) => value.length > 0),
    );
    for (const axis of axes) {
      if (!attrs[axis]) return;
    }
    const sku = buildGeneratedSku(
      productName,
      attrs,
      variants.map((item) => item.sku),
    );
    const stock = Math.max(0, Number(variantStock || 0));
    const price =
      variantPrice === "" || Number.isNaN(Number(variantPrice))
        ? null
        : Math.max(0, Number(variantPrice));
    setVariants((prev) => [
      ...prev,
      {
        id: `${sku}-${Date.now()}-${prev.length}`,
        sku,
        stock,
        price,
        attributes: attrs,
      },
    ]);
    setVariantStock("");
    setVariantPrice("");
    setVariantAttrs({});
  };

  const createProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const auth = authContext();
    if (!auth) return;
    if (variants.length === 0) {
      // eslint-disable-next-line no-alert
      alert("Debes agregar al menos una variante.");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch(`${getClientApiBase()}/products`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: productName,
          price: Number(basePrice || 0),
          imageUrl: imageUrl || undefined,
          tags: tagsCsv
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          variants: variants.map(({ id, ...variant }) => variant),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setShowModal(false);
      setProductName("");
      setBasePrice("");
      setImageUrl("");
      setTagsCsv("");
      setVariants([]);
      setVariantStock("");
      setVariantPrice("");
      setVariantAttrs({});
      await load();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err instanceof Error ? err.message : "Error al crear producto");
    } finally {
      setCreating(false);
    }
  };

  const draftAttributes = Object.fromEntries(
    Object.entries(variantAttrs)
      .map(([key, value]) => [key, String(value ?? "").trim()])
      .filter(([, value]) => value.length > 0),
  );
  const generatedSkuPreview = buildGeneratedSku(
    productName,
    draftAttributes,
    variants.map((item) => item.sku),
  );

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
          <h1 style={{ margin: 0, fontSize: 26, letterSpacing: -0.3 }}>
            Inventario
          </h1>
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
                      colSpan={11 + axes.length}
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

        {showModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              backgroundColor: "rgba(11, 11, 12, 0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: 14,
            }}
          >
            <form
              onSubmit={createProduct}
              style={{
                backgroundColor: "var(--color-surface)",
                borderRadius: 14,
                width: "100%",
                maxWidth: 920,
                maxHeight: "90vh",
                overflowY: "auto",
                padding: 20,
                display: "grid",
                gap: 18,
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 22,
                    color: "var(--color-text)",
                  }}
                >
                  Alta de producto con variantes
                </h2>
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: "var(--color-muted)",
                  }}
                >
                  Primero completá los datos del producto. Después agregá una o
                  más variantes: cada una tiene SKU propio, valores de ejes (
                  {axes.map((a) => formatAxisLabel(a)).join(", ")}) y stock. El
                  precio base aplica a todas salvo que indiques un precio
                  distinto por variante.
                </p>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <StockSectionTitle>1 · Datos generales</StockSectionTitle>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    Nombre del producto
                    <input
                      required
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="Ej. Remera algodón"
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        fontSize: 14,
                      }}
                    />
                    <StockFieldHint>
                      Se muestra igual en todas las variantes de este producto.
                    </StockFieldHint>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    Precio de lista (ARS)
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      value={basePrice}
                      onChange={(e) =>
                        setBasePrice(
                          e.target.value.trim().length === 0
                            ? ""
                            : Number(e.target.value),
                        )
                      }
                      placeholder="Ej. 15999"
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        fontSize: 14,
                      }}
                    />
                    <StockFieldHint>
                      Precio por defecto en pesos. Podés sobrescribirlo por
                      variante más abajo.
                    </StockFieldHint>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    URL de imagen (opcional)
                    <input
                      value={imageUrl.startsWith("data:") ? "" : imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://…"
                      disabled={imageUrl.startsWith("data:")}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        fontSize: 14,
                      }}
                    />
                    <StockFieldHint>
                      Si no cargás archivo, podés pegar un enlace público a la
                      foto.
                    </StockFieldHint>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    Etiquetas (opcional)
                    <input
                      value={tagsCsv}
                      onChange={(e) => setTagsCsv(e.target.value)}
                      placeholder="remera, verano, oferta"
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        fontSize: 14,
                      }}
                    />
                    <StockFieldHint>
                      Separadas por coma. Ayudan a filtrar y a que el bot
                      encuentre el producto.
                    </StockFieldHint>
                  </label>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 10,
                  borderTop: "1px solid var(--color-border)",
                  paddingTop: 16,
                }}
              >
                <StockSectionTitle>2 · Imagen del producto</StockSectionTitle>
                <StockFieldHint style={{ marginTop: 0 }}>
                  Opcional. Si subís archivo, se comprime en el navegador (máx.
                  512 px). También podés usar solo la URL arriba.
                </StockFieldHint>
                <label
                  style={{
                    border: "2px dashed var(--color-border)",
                    borderRadius: 10,
                    padding: 16,
                    cursor: "pointer",
                    background: "var(--color-bg)",
                    display: "grid",
                    gap: 10,
                    justifyItems: "center",
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: "none" }}
                  />
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt="Vista previa del producto"
                      style={{
                        maxWidth: "100%",
                        maxHeight: 220,
                        borderRadius: 8,
                        objectFit: "contain",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        color: "var(--color-muted)",
                        fontSize: 14,
                        textAlign: "center",
                      }}
                    >
                      Tocá o hacé clic para elegir una imagen desde tu
                      dispositivo
                    </span>
                  )}
                </label>
                {imageUrl.startsWith("data:") ? (
                  <button
                    type="button"
                    onClick={() => setImageUrl("")}
                    style={{
                      width: "fit-content",
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    Quitar imagen subida
                  </button>
                ) : null}
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  borderTop: "1px solid var(--color-border)",
                  paddingTop: 16,
                }}
              >
                <StockSectionTitle>3 · Variantes a crear</StockSectionTitle>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "var(--color-muted)",
                    lineHeight: 1.5,
                  }}
                >
                  Completá todos los campos de ejes, stock inicial y (si querés)
                  precio propio. El{" "}
                  <strong style={{ color: "var(--color-text)" }}>SKU</strong> se
                  arma solo a partir del nombre y los valores; podés sumar
                  varias filas antes de guardar.
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-bg)",
                      color: "var(--color-text)",
                      fontSize: 14,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--color-muted)",
                        textTransform: "uppercase",
                      }}
                    >
                      Vista previa SKU
                    </span>
                    <div
                      style={{
                        marginTop: 6,
                        fontWeight: 600,
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 13,
                        wordBreak: "break-all",
                      }}
                    >
                      {generatedSkuPreview}
                    </div>
                    <StockFieldHint>
                      Así quedará el código si agregás la variante ahora.
                    </StockFieldHint>
                  </div>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    Unidades en depósito
                    <input
                      type="number"
                      min={0}
                      value={variantStock}
                      onChange={(e) =>
                        setVariantStock(
                          e.target.value.trim().length === 0
                            ? ""
                            : Number(e.target.value),
                        )
                      }
                      placeholder="0"
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        fontSize: 14,
                      }}
                    />
                    <StockFieldHint>
                      Stock inicial de esta variante al publicar.
                    </StockFieldHint>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--color-text)",
                    }}
                  >
                    Precio de esta variante (ARS, opcional)
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={variantPrice}
                      onChange={(e) =>
                        setVariantPrice(
                          e.target.value.trim().length === 0
                            ? ""
                            : Number(e.target.value),
                        )
                      }
                      placeholder="Vacío = precio base"
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        fontSize: 14,
                      }}
                    />
                    <StockFieldHint>
                      Usalo si esta combinación cobra distinto al resto del
                      producto.
                    </StockFieldHint>
                  </label>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "1fr"
                      : `repeat(${axes.length}, minmax(0,1fr))`,
                    gap: 12,
                  }}
                >
                  {axes.map((axis) => (
                    <label
                      key={axis}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--color-text)",
                      }}
                    >
                      {formatAxisLabel(axis)}{" "}
                      <span
                        style={{ fontWeight: 400, color: "var(--color-muted)" }}
                      >
                        (obligatorio)
                      </span>
                      <input
                        value={variantAttrs[axis] ?? ""}
                        onChange={(e) =>
                          setVariantAttrs((prev) => ({
                            ...prev,
                            [axis]: e.target.value,
                          }))
                        }
                        placeholder={
                          axis === "color"
                            ? "Ej. Negro"
                            : axis === "talle"
                              ? "Ej. M"
                              : `Valor de ${formatAxisLabel(axis)}`
                        }
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--color-border)",
                          fontSize: 14,
                        }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addVariant}
                  style={{
                    width: "100%",
                    maxWidth: 280,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    backgroundColor: "var(--color-bg)",
                  }}
                >
                  Agregar variante a la lista
                </button>
                <StockFieldHint>
                  Si no pasa nada al tocar el botón, revisá que todos los ejes (
                  {axes.map((a) => formatAxisLabel(a)).join(", ")}) tengan
                  valor.
                </StockFieldHint>
                {variants.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--color-muted)",
                        textTransform: "uppercase",
                      }}
                    >
                      Variantes listas para guardar ({variants.length})
                    </p>
                    {variants.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 10,
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                          padding: "12px 14px",
                          backgroundColor: "var(--color-surface)",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                          <div
                            style={{
                              fontFamily: "ui-monospace, monospace",
                              fontWeight: 700,
                              fontSize: 13,
                              color: "var(--color-text)",
                            }}
                          >
                            {item.sku}
                          </div>
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 13,
                              color: "var(--color-muted)",
                            }}
                          >
                            {Object.entries(item.attributes)
                              .map(([k, v]) => `${formatAxisLabel(k)}: ${v}`)
                              .join(" · ")}
                          </div>
                          <div style={{ marginTop: 6, fontSize: 13 }}>
                            <span style={{ color: "var(--color-muted)" }}>
                              Stock inicial:
                            </span>{" "}
                            <strong style={{ color: "var(--color-text)" }}>
                              {item.stock}
                            </strong>
                            {item.price != null ? (
                              <>
                                {" "}
                                <span style={{ color: "var(--color-muted)" }}>
                                  · Precio ARS:
                                </span>{" "}
                                <strong style={{ color: "var(--color-text)" }}>
                                  {new Intl.NumberFormat("es-AR", {
                                    style: "currency",
                                    currency: "ARS",
                                  }).format(Number(item.price))}
                                </strong>
                              </>
                            ) : (
                              <span style={{ color: "var(--color-muted)" }}>
                                {" "}
                                · Precio: precio base del producto
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setVariants((prev) =>
                              prev.filter((entry) => entry.id !== item.id),
                            )
                          }
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "var(--color-error)",
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  borderTop: "1px solid var(--color-border)",
                  paddingTop: 16,
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  Cerrar sin guardar
                </button>
                <button
                  type="submit"
                  disabled={
                    creating ||
                    variants.length === 0 ||
                    !productName.trim() ||
                    Number(basePrice) <= 0
                  }
                  className="inline-flex min-w-[7rem] items-center justify-center gap-2"
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--color-primary)",
                    color: "var(--color-surface)",
                    cursor: "pointer",
                    opacity: creating ? 0.7 : 1,
                  }}
                  aria-busy={creating || undefined}
                >
                  {creating ? (
                    <Spinner
                      size="sm"
                      className="text-[var(--color-surface)]"
                      label="Guardando producto"
                    />
                  ) : (
                    "Guardar producto"
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

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
