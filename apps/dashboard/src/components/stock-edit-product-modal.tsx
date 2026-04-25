"use client";

import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import {
  formatAxisLabel,
  StockFieldHint,
  StockProductThumb,
  FormSection,
  ImageDropZone,
  ImageThumbnailGrid,
  compressImageToDataUrl,
} from "@/components/stock-ui";
import { Spinner } from "@/components/ui";
import { getClientApiBase } from "@/lib/api-base";
import { buildGeneratedSku } from "@/lib/stock-sku";

export type StockProductVariantRow = {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  attributes: Record<string, string>;
  stock: number;
  reservedStock: number;
  availableStock: number;
  effectivePrice: number;
  imageUrl?: string;
  imageUrls?: string[];
  variantImageUrls?: string[];
  isActive: boolean;
  tags?: string[];
  basePrice?: unknown;
  variantPrice?: unknown | null;
};

type EditLine = {
  clientKey: string;
  variantId: string | null;
  isNew: boolean;
  sku: string;
  stock: number | "";
  reservedStock: number;
  attributes: Record<string, string>;
  price: number | "";
  isActive: boolean;
  imageUrls: string[];
};

const COMPRESS_OPTS = { maxWidth: 512, maxHeight: 512, quality: 0.85 } as const;
const MAX_PRODUCT_IMAGES = 10;
const MAX_VARIANT_IMAGES = 6;

function authHeaders(): HeadersInit | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
  if (!token || !tenantId) return null;
  return {
    Authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
    "Content-Type": "application/json",
  };
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function variantPriceField(row: StockProductVariantRow): number | "" {
  if (row.variantPrice == null || row.variantPrice === "") return "";
  const pv = toNum(row.variantPrice);
  const bp = toNum(row.basePrice);
  if (Math.abs(pv - bp) < 0.005) return "";
  return pv;
}

const labelSt = {
  display: "flex" as const,
  flexDirection: "column" as const,
  gap: 4,
  fontSize: 13,
  fontWeight: 600 as const,
  color: "var(--color-text)",
};

export function StockEditProductModal({
  open,
  onClose,
  axes,
  isMobile,
  rows,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  axes: string[];
  isMobile: boolean;
  rows: StockProductVariantRow[];
  onSaved: () => void;
}) {
  const [productName, setProductName] = useState("");
  const [basePrice, setBasePrice] = useState<number | "">("");
  const [productImageUrls, setProductImageUrls] = useState<string[]>([]);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [draftAttrs, setDraftAttrs] = useState<Record<string, string>>({});
  const [draftStock, setDraftStock] = useState<number | "">("");
  const [draftPrice, setDraftPrice] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState("");

  useEffect(() => {
    if (!open || rows.length === 0) return;
    const first = rows[0];
    setProductName(first.name);
    setBasePrice(toNum(first.basePrice));
    const initialProduct =
      Array.isArray(first.imageUrls) && first.imageUrls.length > 0
        ? first.imageUrls
        : typeof first.imageUrl === "string" && first.imageUrl.trim()
          ? [first.imageUrl.trim()]
          : [];
    setProductImageUrls(initialProduct);
    setImageUrlDraft("");
    setTagsCsv((first.tags ?? []).join(", "));
    setLines(
      rows.map((r) => ({
        clientKey: r.variantId,
        variantId: r.variantId,
        isNew: false,
        sku: r.sku,
        stock: r.stock,
        reservedStock: r.reservedStock,
        attributes: { ...r.attributes },
        price: variantPriceField(r),
        isActive: r.isActive,
        imageUrls: Array.isArray(r.variantImageUrls) ? r.variantImageUrls : [],
      })),
    );
    setDraftAttrs({});
    setDraftStock("");
    setDraftPrice("");
    setApiError("");
  }, [open, rows]);

  const handleProductImagesUpload = async (files: File[]) => {
    try {
      const next: string[] = [];
      for (const f of files) {
        if (productImageUrls.length + next.length >= MAX_PRODUCT_IMAGES) break;
        next.push(await compressImageToDataUrl(f, COMPRESS_OPTS));
      }
      if (next.length > 0) setProductImageUrls((prev) => [...prev, ...next]);
    } catch (e) {
      setApiError(
        e instanceof Error ? e.message : "No se pudieron procesar las imágenes",
      );
    }
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

  const draftSkuPreview = buildGeneratedSku(
    productName,
    Object.fromEntries(
      axes.map((axis) => [axis, String(draftAttrs[axis] ?? "").trim()]),
    ),
    lines.map((l) => l.sku),
  );

  const appendDraftVariant = () => {
    const attrs = Object.fromEntries(
      Object.entries(draftAttrs)
        .map(([k, v]) => [k, String(v ?? "").trim()])
        .filter(([, v]) => v.length > 0),
    );
    for (const axis of axes) {
      if (!attrs[axis]) return;
    }
    const sku = buildGeneratedSku(productName, attrs, lines.map((l) => l.sku));
    const stock =
      draftStock === "" ? 0 : Math.max(0, Math.floor(Number(draftStock)));
    const price =
      draftPrice === "" || Number.isNaN(Number(draftPrice))
        ? ""
        : Math.max(0, Number(draftPrice));
    setLines((prev) => [
      ...prev,
      {
        clientKey: `new-${Date.now()}-${prev.length}`,
        variantId: null,
        isNew: true,
        sku,
        stock,
        reservedStock: 0,
        attributes: attrs,
        price,
        isActive: true,
        imageUrls: [],
      },
    ]);
    setDraftAttrs({});
    setDraftStock("");
    setDraftPrice("");
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const headers = authHeaders();
    if (!headers || rows.length === 0) return;
    const productId = rows[0].productId;
    setSaving(true);
    setApiError("");
    try {
      const productRes = await fetch(
        `${getClientApiBase()}/products/${productId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            name: productName.trim(),
            price: Number(basePrice || 0),
            imageUrls: productImageUrls,
            tags: tagsCsv
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          }),
        },
      );
      if (!productRes.ok) throw new Error(await productRes.text());

      const persistBody = (line: EditLine) => ({
        sku: line.sku.trim(),
        attributes: line.attributes,
        stock:
          line.stock === "" ? 0 : Math.max(0, Math.floor(Number(line.stock))),
        isActive: line.isActive,
        price: line.price === "" ? null : Math.max(0, Number(line.price)),
        imageUrls: line.imageUrls,
      });

      for (const line of lines.filter((l) => !l.isNew && l.variantId)) {
        const vr = await fetch(
          `${getClientApiBase()}/products/variants/${line.variantId}`,
          { method: "PATCH", headers, body: JSON.stringify(persistBody(line)) },
        );
        if (!vr.ok)
          throw new Error(`${line.sku}: ${(await vr.text()) || vr.statusText}`);
      }

      for (const line of lines.filter((l) => l.isNew)) {
        const vr = await fetch(
          `${getClientApiBase()}/products/${productId}/variants`,
          { method: "POST", headers, body: JSON.stringify(persistBody(line)) },
        );
        if (!vr.ok)
          throw new Error(
            `Alta ${line.sku}: ${(await vr.text()) || vr.statusText}`,
          );
      }

      onSaved();
      onClose();
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : "No se pudo guardar el producto",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const canSubmit =
    !saving && !!productName.trim() && Number(basePrice) >= 0 && lines.every((l) => !!String(l.sku).trim());

  return (
    <div
      className="ws-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-product-title"
    >
      <form
        onSubmit={(ev) => void save(ev)}
        className="ws-modal-panel"
        style={{ maxWidth: isMobile ? "100%" : 920 }}
      >
        {/* ── Header ── */}
        <div className="ws-modal-header">
          <div>
            <h2
              id="edit-product-title"
              style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--color-text)" }}
            >
              Editar producto
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-muted)" }}>
              {productName || rows[0]?.name || ""} · {lines.length} variante
              {lines.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            type="button"
            className="ws-btn-close"
            onClick={onClose}
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
                  className="ws-input"
                />
                <StockFieldHint>
                  Aplica a todas las variantes de este producto.
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
                    setBasePrice(
                      e.target.value.trim() === "" ? "" : Number(e.target.value),
                    )
                  }
                  className="ws-input"
                />
                <StockFieldHint>
                  Precio por defecto si la variante no tiene precio propio.
                </StockFieldHint>
              </label>
              <label style={labelSt}>
                Etiquetas (coma)
                <input
                  value={tagsCsv}
                  onChange={(e) => setTagsCsv(e.target.value)}
                  placeholder="remera, verano"
                  className="ws-input"
                />
              </label>
            </div>
          </FormSection>

          {/* 2 · Fotos */}
          <FormSection
            num={2}
            title="Fotos del producto"
            description="La primera imagen es la foto principal. Se comprimen automáticamente."
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
                  !imageUrlDraft.trim() ||
                  productImageUrls.length >= MAX_PRODUCT_IMAGES
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
            title={`Variantes (${lines.length})`}
            description="Sumá una combinación nueva o editá las existentes. El SKU se arma solo; podés editarlo antes de guardar."
          >
            {/* New variant builder */}
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
                Nueva variante (sin guardar aún)
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
                    {draftSkuPreview}
                  </div>
                </div>
                <label style={labelSt}>
                  Depósito inicial
                  <input
                    type="number"
                    min={0}
                    value={draftStock}
                    onChange={(e) =>
                      setDraftStock(
                        e.target.value.trim() === "" ? "" : Number(e.target.value),
                      )
                    }
                    className="ws-input"
                  />
                </label>
                <label style={labelSt}>
                  Precio (opcional)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draftPrice}
                    onChange={(e) =>
                      setDraftPrice(
                        e.target.value.trim() === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="Base del producto"
                    className="ws-input"
                  />
                </label>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile
                    ? "1fr"
                    : `repeat(${Math.max(axes.length, 1)}, minmax(0,1fr))`,
                  gap: 12,
                }}
              >
                {axes.map((axis) => (
                  <label key={`draft-${axis}`} style={labelSt}>
                    {formatAxisLabel(axis)}{" "}
                    <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>
                      (obligatorio)
                    </span>
                    <input
                      value={draftAttrs[axis] ?? ""}
                      onChange={(e) =>
                        setDraftAttrs((prev) => ({ ...prev, [axis]: e.target.value }))
                      }
                      className="ws-input"
                    />
                  </label>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={appendDraftVariant}
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
                  }}
                >
                  <Plus size={14} aria-hidden />
                  Agregar a la lista
                </button>
                <StockFieldHint style={{ margin: 0 }}>
                  Si no pasa nada, completá todos los ejes (
                  {axes.map(formatAxisLabel).join(", ")}).
                </StockFieldHint>
              </div>
            </div>

            {/* Existing + new variant cards */}
            {lines.map((line, idx) => (
              <VariantEditCard
                key={line.clientKey}
                line={line}
                idx={idx}
                axes={axes}
                isMobile={isMobile}
                productThumbUrl={productImageUrls[0] || rows[0]?.imageUrl}
                productName={productName || rows[0]?.name || "Producto"}
                onUpdateLine={(patch) =>
                  setLines((prev) =>
                    prev.map((L) =>
                      L.clientKey === line.clientKey ? { ...L, ...patch } : L,
                    ),
                  )
                }
                onRemoveLine={() =>
                  setLines((prev) =>
                    prev.filter((L) => L.clientKey !== line.clientKey),
                  )
                }
                onError={setApiError}
              />
            ))}
          </FormSection>
        </div>

        {/* ── Footer ── */}
        <div className="ws-modal-footer">
          <button
            type="button"
            onClick={onClose}
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
              minWidth: 140,
              justifyContent: "center",
              transition: "background 0.15s",
            }}
            aria-busy={saving || undefined}
          >
            {saving ? (
              <Spinner size="sm" label="Guardando" />
            ) : (
              "Guardar cambios"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Tarjeta de variante editable ──────────────────────────────────────────── */

function VariantEditCard({
  line,
  idx,
  axes,
  isMobile,
  productThumbUrl,
  productName,
  onUpdateLine,
  onRemoveLine,
  onError,
}: {
  line: EditLine;
  idx: number;
  axes: string[];
  isMobile: boolean;
  productThumbUrl?: string;
  productName: string;
  onUpdateLine: (patch: Partial<EditLine>) => void;
  onRemoveLine: () => void;
  onError: (msg: string) => void;
}) {
  const handleVariantImagesUpload = async (files: File[]) => {
    try {
      const next: string[] = [];
      for (const f of files) {
        if (line.imageUrls.length + next.length >= MAX_VARIANT_IMAGES) break;
        next.push(await compressImageToDataUrl(f, COMPRESS_OPTS));
      }
      if (next.length > 0)
        onUpdateLine({ imageUrls: [...line.imageUrls, ...next] });
    } catch (err) {
      onError(
        err instanceof Error
          ? err.message
          : "No se pudieron procesar las imágenes de la variante",
      );
    }
  };

  return (
    <div
      className={`ws-variant-card${line.isNew ? " ws-variant-card-new" : ""}`}
    >
      {/* Card header */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <StockProductThumb imageUrl={productThumbUrl} name={productName} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--color-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Variante {idx + 1}
        </span>
        {line.isNew ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 9px",
              borderRadius: 999,
              backgroundColor: "var(--color-growth-soft)",
              color: "var(--color-growth-strong)",
              border: "1px solid var(--color-growth-strong)",
            }}
          >
            Nueva
          </span>
        ) : null}
        <label
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={line.isActive}
            onChange={(e) => onUpdateLine({ isActive: e.target.checked })}
          />
          Activa en catálogo
        </label>
        {line.isNew ? (
          <button
            type="button"
            onClick={onRemoveLine}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--color-error)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              padding: "2px 0",
            }}
          >
            Quitar
          </button>
        ) : null}
      </div>

      {/* Card body */}
      <div style={{ padding: "14px", display: "grid", gap: 12 }}>
        <label style={labelSt}>
          SKU
          <input
            required
            value={line.sku}
            onChange={(e) => onUpdateLine({ sku: e.target.value })}
            className="ws-input ws-input-mono"
          />
        </label>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
            gap: 12,
          }}
        >
          <label style={labelSt}>
            Depósito (unidades)
            <input
              type="number"
              min={line.reservedStock}
              step={1}
              required
              value={line.stock}
              onChange={(e) =>
                onUpdateLine({
                  stock: e.target.value.trim() === "" ? "" : Number(e.target.value),
                })
              }
              className="ws-input"
            />
            <StockFieldHint>
              Mínimo {line.reservedStock} (reservado actualmente).
            </StockFieldHint>
          </label>
          <label style={labelSt}>
            Precio variante (ARS, opcional)
            <input
              type="number"
              min={0}
              step="0.01"
              value={line.price}
              onChange={(e) =>
                onUpdateLine({
                  price: e.target.value.trim() === "" ? "" : Number(e.target.value),
                })
              }
              placeholder="Vacío = precio base"
              className="ws-input"
            />
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile
              ? "1fr"
              : `repeat(${Math.max(axes.length, 1)}, minmax(0,1fr))`,
            gap: 12,
          }}
        >
          {axes.map((axis) => (
            <label key={`${line.clientKey}-${axis}`} style={labelSt}>
              {formatAxisLabel(axis)}
              <input
                value={line.attributes[axis] ?? ""}
                onChange={(e) =>
                  onUpdateLine({
                    attributes: { ...line.attributes, [axis]: e.target.value },
                  })
                }
                className="ws-input"
              />
            </label>
          ))}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--color-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Fotos de la variante (opcional)
          </span>
          <ImageDropZone
            onFilesSelected={(files) => void handleVariantImagesUpload(files)}
            count={line.imageUrls.length}
            maxCount={MAX_VARIANT_IMAGES}
            label="Fotos específicas de esta combinación"
            sublabel="Opcional · máx. 6 fotos"
          />
          <ImageThumbnailGrid
            urls={line.imageUrls}
            thumbHeight={72}
            onRemove={(imgIdx) => {
              const next = [...line.imageUrls];
              next.splice(imgIdx, 1);
              onUpdateLine({ imageUrls: next });
            }}
            onMoveUp={(imgIdx) => {
              const next = [...line.imageUrls];
              [next[imgIdx - 1], next[imgIdx]] = [next[imgIdx], next[imgIdx - 1]];
              onUpdateLine({ imageUrls: next });
            }}
          />
        </div>
      </div>
    </div>
  );
}
