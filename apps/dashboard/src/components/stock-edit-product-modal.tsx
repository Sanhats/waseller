"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import {
  formatAxisLabel,
  StockFieldHint,
  StockProductThumb,
  StockSectionTitle,
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
};

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

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--color-text)",
};

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  fontSize: 14,
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
  const [imageUrl, setImageUrl] = useState("");
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
    setImageUrl(typeof first.imageUrl === "string" ? first.imageUrl : "");
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
      })),
    );
    setDraftAttrs({});
    setDraftStock("");
    setDraftPrice("");
    setApiError("");
  }, [open, rows]);

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

  const appendDraftVariant = () => {
    const attrs = Object.fromEntries(
      Object.entries(draftAttrs)
        .map(([k, v]) => [k, String(v ?? "").trim()])
        .filter(([, v]) => v.length > 0),
    );
    for (const axis of axes) {
      if (!attrs[axis]) return;
    }
    const existingSkus = lines.map((l) => l.sku);
    const sku = buildGeneratedSku(productName, attrs, existingSkus);
    const stock = draftStock === "" ? 0 : Math.max(0, Math.floor(Number(draftStock)));
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
      },
    ]);
    setDraftAttrs({});
    setDraftStock("");
    setDraftPrice("");
  };

  const draftSkuPreview = buildGeneratedSku(
    productName,
    Object.fromEntries(
      axes.map((axis) => [axis, String(draftAttrs[axis] ?? "").trim()]),
    ),
    lines.map((l) => l.sku),
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const headers = authHeaders();
    if (!headers || rows.length === 0) return;
    const productId = rows[0].productId;
    setSaving(true);
    setApiError("");
    try {
      const productRes = await fetch(`${getClientApiBase()}/products/${productId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: productName.trim(),
          price: Number(basePrice || 0),
          imageUrl: imageUrl.trim().length > 0 ? imageUrl.trim() : null,
          tags: tagsCsv
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!productRes.ok) {
        throw new Error(await productRes.text());
      }

      const persistBody = (line: EditLine) => {
        const stockNum =
          line.stock === "" ? 0 : Math.max(0, Math.floor(Number(line.stock)));
        return {
          sku: line.sku.trim(),
          attributes: line.attributes,
          stock: stockNum,
          isActive: line.isActive,
          price: line.price === "" ? null : Math.max(0, Number(line.price)),
        };
      };

      for (const line of lines.filter((l) => !l.isNew && l.variantId)) {
        const vr = await fetch(
          `${getClientApiBase()}/products/variants/${line.variantId}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify(persistBody(line)),
          },
        );
        if (!vr.ok) {
          throw new Error(
            `${line.sku}: ${(await vr.text()) || vr.statusText}`,
          );
        }
      }

      for (const line of lines.filter((l) => l.isNew)) {
        const vr = await fetch(`${getClientApiBase()}/products/${productId}/variants`, {
          method: "POST",
          headers,
          body: JSON.stringify(persistBody(line)),
        });
        if (!vr.ok) {
          throw new Error(
            `Alta ${line.sku}: ${(await vr.text()) || vr.statusText}`,
          );
        }
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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(11, 11, 12, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 14,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-product-title"
    >
      <form
        onSubmit={(ev) => void save(ev)}
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
            id="edit-product-title"
            style={{
              margin: 0,
              fontSize: 22,
              color: "var(--color-text)",
            }}
          >
            Editar producto
          </h2>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 14,
              lineHeight: 1.5,
              color: "var(--color-muted)",
            }}
          >
            Cambiá datos del artículo y de cada variante; podés sumar nuevas
            combinaciones antes de guardar. El depósito no puede quedar por
            debajo de las unidades reservadas en conversaciones.
          </p>
        </div>

        {apiError ? (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--color-error)",
              backgroundColor: "var(--color-error-bg)",
              border: "1px solid color-mix(in srgb, var(--color-error) 35%, transparent)",
            }}
          >
            {apiError}
          </p>
        ) : null}

        <div style={{ display: "grid", gap: 12 }}>
          <StockSectionTitle>1 · Datos generales</StockSectionTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: 12,
            }}
          >
            <label style={labelStyle}>
              Nombre del producto
              <input
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                style={inputStyle}
              />
              <StockFieldHint>
                Aplica a todas las variantes de este producto.
              </StockFieldHint>
            </label>
            <label style={labelStyle}>
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
                style={inputStyle}
              />
              <StockFieldHint>
                Precio por defecto si la variante no tiene precio propio.
              </StockFieldHint>
            </label>
            <label style={labelStyle}>
              URL de imagen (opcional)
              <input
                value={imageUrl.startsWith("data:") ? "" : imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                disabled={imageUrl.startsWith("data:")}
                placeholder="https://…"
                style={inputStyle}
              />
              <StockFieldHint>
                O subí una imagen abajo (se comprime en el navegador).
              </StockFieldHint>
            </label>
            <label style={labelStyle}>
              Etiquetas (coma)
              <input
                value={tagsCsv}
                onChange={(e) => setTagsCsv(e.target.value)}
                placeholder="remera, verano"
                style={inputStyle}
              />
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
          <StockSectionTitle>2 · Imagen</StockSectionTitle>
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
                alt="Vista previa"
                style={{
                  maxWidth: "100%",
                  maxHeight: 180,
                  borderRadius: 8,
                  objectFit: "contain",
                }}
              />
            ) : (
              <span style={{ color: "var(--color-muted)", fontSize: 14 }}>
                Elegir archivo
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
            gap: 14,
            borderTop: "1px solid var(--color-border)",
            paddingTop: 16,
          }}
        >
          <StockSectionTitle>3 · Variantes ({lines.length})</StockSectionTitle>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--color-muted)",
              lineHeight: 1.5,
            }}
          >
            Sumá una combinación nueva con los mismos ejes del negocio. El SKU
            se arma solo; podés editarlo antes de guardar.
          </p>
          <div
            style={{
              border: "1px dashed var(--color-border)",
              borderRadius: 10,
              padding: 14,
              display: "grid",
              gap: 12,
              backgroundColor: "var(--color-surface)",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
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
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--color-muted)",
                    textTransform: "uppercase",
                  }}
                >
                  Vista previa SKU
                </span>
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: "ui-monospace, monospace",
                    fontWeight: 600,
                    wordBreak: "break-all",
                  }}
                >
                  {draftSkuPreview}
                </div>
              </div>
              <label style={labelStyle}>
                Depósito inicial
                <input
                  type="number"
                  min={0}
                  value={draftStock}
                  onChange={(e) =>
                    setDraftStock(
                      e.target.value.trim() === ""
                        ? ""
                        : Number(e.target.value),
                    )
                  }
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Precio (opcional)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draftPrice}
                  onChange={(e) =>
                    setDraftPrice(
                      e.target.value.trim() === ""
                        ? ""
                        : Number(e.target.value),
                    )
                  }
                  placeholder="Base del producto"
                  style={inputStyle}
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
                <label key={`draft-${axis}`} style={labelStyle}>
                  {formatAxisLabel(axis)}{" "}
                  <span style={{ fontWeight: 400, color: "var(--color-muted)" }}>
                    (obligatorio)
                  </span>
                  <input
                    value={draftAttrs[axis] ?? ""}
                    onChange={(e) =>
                      setDraftAttrs((prev) => ({
                        ...prev,
                        [axis]: e.target.value,
                      }))
                    }
                    style={inputStyle}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={appendDraftVariant}
              style={{
                width: "fit-content",
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Agregar a la lista
            </button>
            <StockFieldHint>
              Si no pasa nada, completá todos los ejes (
              {axes.map((a) => formatAxisLabel(a)).join(", ")}).
            </StockFieldHint>
          </div>

          {lines.map((line, idx) => (
            <div
              key={line.clientKey}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                padding: 14,
                display: "grid",
                gap: 12,
                backgroundColor: "var(--color-bg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <StockProductThumb
                  imageUrl={rows[0]?.imageUrl}
                  name={productName || rows[0]?.name || "Producto"}
                />
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--color-muted)",
                    textTransform: "uppercase",
                  }}
                >
                  Variante {idx + 1}
                </span>
                {line.isNew ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      backgroundColor: "var(--color-primary-ultra-light)",
                      color: "var(--color-primary)",
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
                    gap: 8,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={line.isActive}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((L) =>
                          L.clientKey === line.clientKey
                            ? { ...L, isActive: e.target.checked }
                            : L,
                        ),
                      )
                    }
                  />
                  Activa en catálogo
                </label>
                {line.isNew ? (
                  <button
                    type="button"
                    onClick={() =>
                      setLines((prev) =>
                        prev.filter((L) => L.clientKey !== line.clientKey),
                      )
                    }
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--color-error)",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
              <label style={labelStyle}>
                SKU
                <input
                  required
                  value={line.sku}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((L) =>
                        L.clientKey === line.clientKey
                          ? { ...L, sku: e.target.value }
                          : L,
                      ),
                    )
                  }
                  style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
                />
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  gap: 12,
                }}
              >
                <label style={labelStyle}>
                  Depósito (unidades)
                  <input
                    type="number"
                    min={line.reservedStock}
                    step={1}
                    required
                    value={line.stock}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((L) =>
                          L.clientKey === line.clientKey
                            ? {
                                ...L,
                                stock:
                                  e.target.value.trim() === ""
                                    ? ""
                                    : Number(e.target.value),
                              }
                            : L,
                        ),
                      )
                    }
                    style={inputStyle}
                  />
                  <StockFieldHint>
                    Mínimo {line.reservedStock} (reservado actualmente).
                  </StockFieldHint>
                </label>
                <label style={labelStyle}>
                  Precio variante (ARS, opcional)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.price}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((L) =>
                          L.clientKey === line.clientKey
                            ? {
                                ...L,
                                price:
                                  e.target.value.trim() === ""
                                    ? ""
                                    : Number(e.target.value),
                              }
                            : L,
                        ),
                      )
                    }
                    placeholder="Vacío = precio base"
                    style={inputStyle}
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
                  <label key={`${line.clientKey}-${axis}`} style={labelStyle}>
                    {formatAxisLabel(axis)}
                    <input
                      value={line.attributes[axis] ?? ""}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((L) =>
                            L.clientKey === line.clientKey
                              ? {
                                  ...L,
                                  attributes: {
                                    ...L.attributes,
                                    [axis]: e.target.value,
                                  },
                                }
                              : L,
                          ),
                        )
                      }
                      style={inputStyle}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
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
            onClick={onClose}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={
              saving ||
              !productName.trim() ||
              Number(basePrice) < 0 ||
              lines.some((l) => !String(l.sku).trim())
            }
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: "var(--color-primary)",
              color: "var(--color-surface)",
              cursor: saving ? "wait" : "pointer",
              fontSize: 14,
              fontWeight: 600,
              opacity: saving ? 0.75 : 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
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
