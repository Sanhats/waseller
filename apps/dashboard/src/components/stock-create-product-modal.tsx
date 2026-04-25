"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import {
  formatAxisLabel,
  StockFieldHint,
  FormSection,
  ImageDropZone,
  ImageThumbnailGrid,
  compressImageToDataUrl,
} from "@/components/stock-ui";
import { Spinner } from "@/components/ui";
import { getClientApiBase } from "@/lib/api-base";
import { buildGeneratedSku } from "@/lib/stock-sku";

const MAX_PRODUCT_IMAGES = 10;
const MAX_VARIANT_IMAGES = 6;
const COMPRESS_OPTS = { maxWidth: 512, maxHeight: 512, quality: 0.85 } as const;

type DraftVariant = {
  id: string;
  sku: string;
  stock: number;
  price?: number | null;
  attributes: Record<string, string>;
  imageUrls: string[];
};

function authContext(): { token: string; tenantId: string } | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
  if (!token || !tenantId) return null;
  return { token, tenantId };
}

const labelSt = {
  display: "flex" as const,
  flexDirection: "column" as const,
  gap: 4,
  fontSize: 13,
  fontWeight: 600 as const,
  color: "var(--color-text)",
};

export function StockCreateProductModal({
  open,
  onClose,
  onSaved,
  axes,
  isMobile,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  axes: string[];
  isMobile: boolean;
}) {
  const [productName, setProductName] = useState("");
  const [basePrice, setBasePrice] = useState<number | "">("");
  const [productImageUrls, setProductImageUrls] = useState<string[]>([]);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [variantStock, setVariantStock] = useState<number | "">("");
  const [variantPrice, setVariantPrice] = useState<number | "">("");
  const [variantAttrs, setVariantAttrs] = useState<Record<string, string>>({});
  const [variantImageUrls, setVariantImageUrls] = useState<string[]>([]);
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [creating, setCreating] = useState(false);
  const [apiError, setApiError] = useState("");

  if (!open) return null;

  const draftAttributes = Object.fromEntries(
    Object.entries(variantAttrs)
      .map(([k, v]) => [k, String(v ?? "").trim()])
      .filter(([, v]) => v.length > 0),
  );
  const generatedSkuPreview = buildGeneratedSku(
    productName,
    draftAttributes,
    variants.map((v) => v.sku),
  );

  const handleProductImagesUpload = async (files: File[]) => {
    const next: string[] = [];
    for (const f of files) {
      if (productImageUrls.length + next.length >= MAX_PRODUCT_IMAGES) break;
      next.push(await compressImageToDataUrl(f, COMPRESS_OPTS));
    }
    if (next.length > 0) setProductImageUrls((prev) => [...prev, ...next]);
  };

  const handleVariantImagesUpload = async (files: File[]) => {
    const next: string[] = [];
    for (const f of files) {
      if (variantImageUrls.length + next.length >= MAX_VARIANT_IMAGES) break;
      next.push(await compressImageToDataUrl(f, COMPRESS_OPTS));
    }
    if (next.length > 0) setVariantImageUrls((prev) => [...prev, ...next]);
  };

  const addImageUrl = () => {
    const url = imageUrlDraft.trim();
    if (!url) return;
    setProductImageUrls((prev) => {
      if (prev.includes(url) || prev.length >= MAX_PRODUCT_IMAGES) return prev;
      return [...prev, url];
    });
    setImageUrlDraft("");
  };

  const addVariant = () => {
    const attrs = Object.fromEntries(
      Object.entries(variantAttrs)
        .map(([k, v]) => [k, String(v ?? "").trim()])
        .filter(([, v]) => v.length > 0),
    );
    for (const axis of axes) {
      if (!attrs[axis]) return;
    }
    const sku = buildGeneratedSku(productName, attrs, variants.map((v) => v.sku));
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
        imageUrls: variantImageUrls,
      },
    ]);
    setVariantStock("");
    setVariantPrice("");
    setVariantAttrs({});
    setVariantImageUrls([]);
  };

  const resetForm = () => {
    setProductName("");
    setBasePrice("");
    setProductImageUrls([]);
    setImageUrlDraft("");
    setTagsCsv("");
    setVariants([]);
    setVariantStock("");
    setVariantPrice("");
    setVariantAttrs({});
    setVariantImageUrls([]);
    setApiError("");
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const createProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const auth = authContext();
    if (!auth) return;
    if (variants.length === 0) {
      setApiError("Debes agregar al menos una variante antes de guardar.");
      return;
    }
    setCreating(true);
    setApiError("");
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
          imageUrls: productImageUrls,
          tags: tagsCsv
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          variants: variants.map(({ id, ...v }) => v),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      resetForm();
      onSaved();
      onClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Error al crear el producto");
    } finally {
      setCreating(false);
    }
  };

  const canSubmit =
    !creating && variants.length > 0 && !!productName.trim() && Number(basePrice) > 0;

  return (
    <div
      className="ws-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-product-title"
    >
      <form
        onSubmit={(e) => void createProduct(e)}
        className="ws-modal-panel"
        style={{ maxWidth: isMobile ? "100%" : 920 }}
      >
        {/* ── Header ── */}
        <div className="ws-modal-header">
          <div>
            <h2
              id="create-product-title"
              style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--color-text)" }}
            >
              Alta de producto
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-muted)" }}>
              Ejes de variante: {axes.map(formatAxisLabel).join(", ")} · El precio base aplica a
              todas las variantes salvo que indiques uno propio.
            </p>
          </div>
          <button
            type="button"
            className="ws-btn-close"
            onClick={handleClose}
            aria-label="Cerrar sin guardar"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="ws-modal-body">
          {apiError ? (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--color-error)",
                backgroundColor: "var(--color-error-bg)",
                border:
                  "1px solid color-mix(in srgb, var(--color-error) 30%, transparent)",
              }}
            >
              {apiError}
            </div>
          ) : null}

          {/* 1 · Datos generales */}
          <FormSection num={1} title="Datos generales">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                gap: 14,
              }}
            >
              <label style={labelSt}>
                Nombre del producto
                <input
                  required
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="Ej. Remera algodón"
                  className="ws-input"
                />
                <StockFieldHint>
                  Se muestra igual en todas las variantes de este producto.
                </StockFieldHint>
              </label>
              <label style={labelSt}>
                Precio de lista (ARS)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={basePrice}
                  onChange={(e) =>
                    setBasePrice(e.target.value.trim() === "" ? "" : Number(e.target.value))
                  }
                  placeholder="Ej. 15999"
                  className="ws-input"
                />
                <StockFieldHint>
                  Precio por defecto en pesos. Podés sobrescribirlo por variante.
                </StockFieldHint>
              </label>
              <label style={labelSt}>
                Etiquetas (separadas por coma)
                <input
                  value={tagsCsv}
                  onChange={(e) => setTagsCsv(e.target.value)}
                  placeholder="remera, verano, oferta"
                  className="ws-input"
                />
                <StockFieldHint>
                  Ayudan al bot a encontrar el producto más rápido.
                </StockFieldHint>
              </label>
            </div>
          </FormSection>

          {/* 2 · Fotos del producto */}
          <FormSection
            num={2}
            title="Fotos del producto"
            description="Opcional. La primera imagen es la foto principal del producto. Se comprimen automáticamente."
          >
            <ImageDropZone
              onFilesSelected={(files) => void handleProductImagesUpload(files)}
              count={productImageUrls.length}
              maxCount={MAX_PRODUCT_IMAGES}
              label="Subí fotos del producto"
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={imageUrlDraft}
                onChange={(e) => setImageUrlDraft(e.target.value)}
                placeholder="O pegá una URL de imagen…"
                className="ws-input"
                style={{ flex: "1 1 180px", minWidth: 0 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addImageUrl();
                  }
                }}
              />
              <button
                type="button"
                onClick={addImageUrl}
                disabled={
                  !imageUrlDraft.trim() || productImageUrls.length >= MAX_PRODUCT_IMAGES
                }
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                Agregar URL
              </button>
              {productImageUrls.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setProductImageUrls([])}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--color-error)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  Quitar todas
                </button>
              ) : null}
            </div>
            <ImageThumbnailGrid
              urls={productImageUrls}
              onRemove={(idx) =>
                setProductImageUrls((prev) => prev.filter((_, i) => i !== idx))
              }
              onMoveUp={(idx) =>
                setProductImageUrls((prev) => {
                  const next = [...prev];
                  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                  return next;
                })
              }
            />
          </FormSection>

          {/* 3 · Variantes */}
          <FormSection
            num={3}
            title="Variantes"
            description={`Completá los ejes (${axes.map(formatAxisLabel).join(", ")}), stock y precio opcional. El SKU se arma solo. Podés agregar varias antes de guardar.`}
          >
            {/* Variant builder */}
            <div
              style={{
                border: "2px dashed var(--color-growth-strong)",
                borderRadius: 12,
                padding: "18px 20px",
                background: "var(--color-growth-soft)",
                display: "grid",
                gap: 14,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--color-growth-strong)",
                }}
              >
                Nueva variante
              </span>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--color-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Vista previa SKU
                  </span>
                  <div
                    style={{
                      marginTop: 6,
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 600,
                      fontSize: 13,
                      wordBreak: "break-all",
                      color: "var(--color-text)",
                    }}
                  >
                    {generatedSkuPreview}
                  </div>
                </div>
                <label style={labelSt}>
                  Unidades en depósito
                  <input
                    type="number"
                    min={0}
                    value={variantStock}
                    onChange={(e) =>
                      setVariantStock(e.target.value.trim() === "" ? "" : Number(e.target.value))
                    }
                    placeholder="0"
                    className="ws-input"
                  />
                  <StockFieldHint>Stock inicial al publicar.</StockFieldHint>
                </label>
                <label style={labelSt}>
                  Precio variante (ARS)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={variantPrice}
                    onChange={(e) =>
                      setVariantPrice(
                        e.target.value.trim() === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="Vacío = precio base"
                    className="ws-input"
                  />
                  <StockFieldHint>Solo si esta combinación tiene precio distinto.</StockFieldHint>
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
                  <label key={axis} style={labelSt}>
                    {formatAxisLabel(axis)}{" "}
                    <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>
                      (obligatorio)
                    </span>
                    <input
                      value={variantAttrs[axis] ?? ""}
                      onChange={(e) =>
                        setVariantAttrs((prev) => ({ ...prev, [axis]: e.target.value }))
                      }
                      placeholder={
                        axis === "color"
                          ? "Ej. Negro"
                          : axis === "talle"
                            ? "Ej. M"
                            : `Valor de ${formatAxisLabel(axis)}`
                      }
                      className="ws-input"
                    />
                  </label>
                ))}
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <ImageDropZone
                  onFilesSelected={(files) => void handleVariantImagesUpload(files)}
                  count={variantImageUrls.length}
                  maxCount={MAX_VARIANT_IMAGES}
                  label="Fotos de esta variante (opcional)"
                  sublabel="Específicas para esta combinación"
                />
                <ImageThumbnailGrid
                  urls={variantImageUrls}
                  thumbHeight={72}
                  onRemove={(idx) =>
                    setVariantImageUrls((prev) => prev.filter((_, i) => i !== idx))
                  }
                  onMoveUp={(idx) =>
                    setVariantImageUrls((prev) => {
                      const next = [...prev];
                      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                      return next;
                    })
                  }
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={addVariant}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "9px 18px",
                    borderRadius: 8,
                    border: "1.5px solid var(--color-growth-strong)",
                    background: "var(--color-surface)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--color-text)",
                    transition: "background 0.15s",
                  }}
                >
                  <Plus size={14} aria-hidden />
                  Agregar variante a la lista
                </button>
                <StockFieldHint style={{ margin: 0 }}>
                  Si no pasa nada, revisá que todos los ejes (
                  {axes.map(formatAxisLabel).join(", ")}) tengan valor.
                </StockFieldHint>
              </div>
            </div>

            {/* Draft variants list */}
            {variants.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--color-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
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
                      borderLeft: "3px solid var(--color-growth-strong)",
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
                      <div style={{ marginTop: 4, fontSize: 13, color: "var(--color-muted)" }}>
                        {Object.entries(item.attributes)
                          .map(([k, v]) => `${formatAxisLabel(k)}: ${v}`)
                          .join(" · ")}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 13 }}>
                        <span style={{ color: "var(--color-muted)" }}>Stock:</span>{" "}
                        <strong>{item.stock}</strong>
                        {item.price != null ? (
                          <>
                            {" · "}
                            <span style={{ color: "var(--color-muted)" }}>Precio ARS:</span>{" "}
                            <strong>
                              {new Intl.NumberFormat("es-AR", {
                                style: "currency",
                                currency: "ARS",
                                minimumFractionDigits: 0,
                              }).format(Number(item.price))}
                            </strong>
                          </>
                        ) : (
                          <span style={{ color: "var(--color-muted)" }}> · Precio base</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setVariants((prev) => prev.filter((v) => v.id !== item.id))
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
          </FormSection>
        </div>

        {/* ── Footer ── */}
        <div className="ws-modal-footer">
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-text)",
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: "10px 22px",
              borderRadius: 8,
              border: "none",
              background: canSubmit ? "var(--color-primary)" : "var(--color-disabled-bg)",
              color: canSubmit ? "#fff" : "var(--color-disabled)",
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontSize: 14,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 130,
              justifyContent: "center",
              transition: "background 0.15s",
            }}
            aria-busy={creating || undefined}
          >
            {creating ? (
              <Spinner size="sm" className="text-[var(--color-surface)]" label="Guardando" />
            ) : (
              "Guardar producto"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
