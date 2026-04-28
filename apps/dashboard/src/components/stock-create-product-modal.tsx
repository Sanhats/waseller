"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Plus, X } from "lucide-react";
import {
  formatAxisLabel,
  FormSection,
  ImageDropZone,
  ImageThumbnailGrid,
  compressImageToDataUrl,
  uploadImagesToSupabase,
} from "@/components/stock-ui";
import { Spinner } from "@/components/ui";
import { getClientApiBase } from "@/lib/api-base";
import { buildGeneratedSku } from "@/lib/stock-sku";
import {
  FashionAxisQuickPicks,
  FashionGridQtyMatrix,
  FashionVariantGridPicker,
} from "@/components/stock-fashion-axis-pickers";
import {
  axesIncludeTalleAndColor,
  buildTalleColorVariantGrid,
  fashionGridCellKey,
  normalizeAxisKey,
  shouldShowFashionStockUi,
} from "@/lib/stock-fashion-ui";

const MAX_PRODUCT_IMAGES = 10;
const MAX_VARIANT_IMAGES = 6;
const COMPRESS_OPTS = { maxWidth: 512, maxHeight: 512, quality: 0.85 } as const;

type CategoryOption = { id: string; parentId: string | null; name: string; sortOrder: number };

function buildTree(rows: CategoryOption[]): Array<{ row: CategoryOption; depth: number; isLast: boolean }> {
  const childrenByParent = new Map<string | null, CategoryOption[]>();
  for (const r of rows) {
    const k = r.parentId ?? null;
    if (!childrenByParent.has(k)) childrenByParent.set(k, []);
    childrenByParent.get(k)!.push(r);
  }
  for (const [, list] of childrenByParent) {
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "es"));
  }
  const out: Array<{ row: CategoryOption; depth: number; isLast: boolean }> = [];
  const visit = (parentId: string | null, depth: number) => {
    const kids = childrenByParent.get(parentId) ?? [];
    kids.forEach((kid, idx) => {
      const isLast = idx === kids.length - 1;
      out.push({ row: kid, depth, isLast });
      visit(kid.id, depth + 1);
    });
  };
  visit(null, 0);
  return out;
}

type DraftVariant = {
  id: string;
  sku: string;
  stock: number;
  price: number | null;
  attributes: Record<string, string>;
  imageUrls: string[];
  categoryIds: string[];
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

function variantAttrSignature(axes: string[], attributes: Record<string, string>): string {
  return axes.map((a) => `${a}=${String(attributes[a] ?? "").trim().toLowerCase()}`).join("|");
}

export function StockCreateProductModal({
  open,
  onClose,
  onSaved,
  axes,
  isMobile,
  businessCategory,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  axes: string[];
  isMobile: boolean;
  businessCategory?: string;
}) {
  const [productName, setProductName] = useState("");
  const [basePrice, setBasePrice] = useState<number | "">("");
  const [productImageUrls, setProductImageUrls] = useState<string[]>([]);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [variantStock, setVariantStock] = useState<number | "">(1);
  const [variantPrice, setVariantPrice] = useState<number | "">("");
  const [variantAttrs, setVariantAttrs] = useState<Record<string, string>>({});
  const [variantImageUrls, setVariantImageUrls] = useState<string[]>([]);
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [creating, setCreating] = useState(false);
  const [apiError, setApiError] = useState("");
  const [allCategories, setAllCategories] = useState<CategoryOption[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  // Carga de stock: dejamos solo modo "multi" (lista de variantes).
  const [variantMode, setVariantMode] = useState<"multi">("multi");
  const [gridTalles, setGridTalles] = useState<string[]>([]);
  const [gridColors, setGridColors] = useState<string[]>([]);
  const [gridCellStocks, setGridCellStocks] = useState<Record<string, string>>({});
  const variantsListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setGridCellStocks((prev) => {
      const next: Record<string, string> = {};
      for (const t of gridTalles) {
        for (const c of gridColors) {
          const k = fashionGridCellKey(t, c);
          if (prev[k] !== undefined) next[k] = prev[k];
        }
      }
      return next;
    });
  }, [gridTalles, gridColors]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const auth = authContext();
      if (!auth) return;
      const res = await fetch(`${getClientApiBase()}/categories`, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "x-tenant-id": auth.tenantId,
        },
        cache: "no-store",
      });
      if (!cancelled && res.ok) {
        setAllCategories((await res.json()) as CategoryOption[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const categoryTree = useMemo(() => buildTree(allCategories), [allCategories]);
  const filteredCategoryTree = useMemo(() => {
    const q = categoryFilter.trim().toLowerCase();
    if (!q) return categoryTree;
    return categoryTree.filter((x) => x.row.name.toLowerCase().includes(q));
  }, [categoryFilter, categoryTree]);

  const fashionRetailHint = useMemo(
    () => shouldShowFashionStockUi(businessCategory, axes),
    [businessCategory, axes],
  );

  const fashionGridPath =
    variantMode === "multi" && axesIncludeTalleAndColor(axes) && fashionRetailHint;

  useEffect(() => {
    if (!open) return;
    if (fashionRetailHint && axesIncludeTalleAndColor(axes)) {
      setVariantMode("multi");
    }
  }, [open, axes, fashionRetailHint]);

  const variantAxesComplete = useMemo(
    () => axes.every((axis) => String(variantAttrs[axis] ?? "").trim().length > 0),
    [axes, variantAttrs],
  );

  const talleColorAxisList = useMemo(
    () =>
      axes.filter((a) => {
        const k = normalizeAxisKey(a);
        return k === "talle" || k === "talla" || k === "color";
      }),
    [axes],
  );

  const otherVariantAxesForFashion = useMemo(
    () =>
      axes.filter((a) => {
        const k = normalizeAxisKey(a);
        return k !== "talle" && k !== "talla" && k !== "color";
      }),
    [axes],
  );

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
    try {
      const auth = authContext();
      const bounded = files.slice(0, Math.max(0, MAX_PRODUCT_IMAGES - productImageUrls.length));
      if (bounded.length === 0) return;
      const urls = await uploadImagesToSupabase(bounded, auth?.tenantId);
      if (urls.length > 0) setProductImageUrls((prev) => [...prev, ...urls]);
    } catch (e) {
      const next: string[] = [];
      for (const f of files) {
        if (productImageUrls.length + next.length >= MAX_PRODUCT_IMAGES) break;
        next.push(await compressImageToDataUrl(f, COMPRESS_OPTS));
      }
      if (next.length > 0) setProductImageUrls((prev) => [...prev, ...next]);
      setApiError(e instanceof Error ? e.message : "No se pudieron subir las imágenes");
    }
  };

  const handleVariantImagesUpload = async (files: File[]) => {
    try {
      const auth = authContext();
      const bounded = files.slice(0, Math.max(0, MAX_VARIANT_IMAGES - variantImageUrls.length));
      if (bounded.length === 0) return;
      const urls = await uploadImagesToSupabase(bounded, auth?.tenantId);
      if (urls.length > 0) setVariantImageUrls((prev) => [...prev, ...urls]);
    } catch (e) {
      const next: string[] = [];
      for (const f of files) {
        if (variantImageUrls.length + next.length >= MAX_VARIANT_IMAGES) break;
        next.push(await compressImageToDataUrl(f, COMPRESS_OPTS));
      }
      if (next.length > 0) setVariantImageUrls((prev) => [...prev, ...next]);
      setApiError(e instanceof Error ? e.message : "No se pudieron subir las imágenes de la variante");
    }
  };

  // (modo single removido)

  const appendImagesToVariantRow = async (variantId: string, files: File[]) => {
    let bounded: File[] = [];
    setVariants((prev) => {
      const row = prev.find((x) => x.id === variantId);
      if (!row) return prev;
      bounded = files.slice(0, Math.max(0, MAX_VARIANT_IMAGES - row.imageUrls.length));
      return prev;
    });
    if (bounded.length === 0) return;
    try {
      const auth = authContext();
      const urls = await uploadImagesToSupabase(bounded, auth?.tenantId);
      if (urls.length > 0) {
        setVariants((prev) =>
          prev.map((row) =>
            row.id === variantId ? { ...row, imageUrls: [...row.imageUrls, ...urls] } : row,
          ),
        );
      }
    } catch (e) {
      let baseLen = 0;
      setVariants((prev) => {
        const row = prev.find((x) => x.id === variantId);
        baseLen = row?.imageUrls.length ?? 0;
        return prev;
      });
      const next: string[] = [];
      for (const f of bounded) {
        if (baseLen + next.length >= MAX_VARIANT_IMAGES) break;
        next.push(await compressImageToDataUrl(f, COMPRESS_OPTS));
      }
      if (next.length > 0) {
        setVariants((prev) =>
          prev.map((r) =>
            r.id === variantId
              ? { ...r, imageUrls: [...r.imageUrls, ...next].slice(0, MAX_VARIANT_IMAGES) }
              : r,
          ),
        );
      }
      setApiError(e instanceof Error ? e.message : "No se pudieron subir las imágenes de la variante");
    }
  };

  const toggleVariantRowCategory = (variantId: string, categoryId: string) => {
    setVariants((prev) =>
      prev.map((row) => {
        if (row.id !== variantId) return row;
        const set = new Set(row.categoryIds);
        if (set.has(categoryId)) set.delete(categoryId);
        else set.add(categoryId);
        return { ...row, categoryIds: [...set] };
      }),
    );
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

  const scrollVariantsListIntoView = () => {
    requestAnimationFrame(() => {
      variantsListRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const addVariant = () => {
    const attrs = Object.fromEntries(
      Object.entries(variantAttrs)
        .map(([k, v]) => [k, String(v ?? "").trim()])
        .filter(([, v]) => v.length > 0),
    );
    const missing = axes.filter((axis) => !attrs[axis]);
    if (missing.length > 0) {
      setApiError(
        `Faltan: ${missing.map(formatAxisLabel).join(", ")}. Completá los campos y tocá «Agregar» de nuevo.`,
      );
      return;
    }
    setApiError("");
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
        categoryIds: [],
      },
    ]);
    setVariantStock(1);
    setVariantPrice("");
    setVariantAttrs({});
    setVariantImageUrls([]);
    scrollVariantsListIntoView();
  };

  const duplicateFromLastVariant = () => {
    const last = variants[variants.length - 1];
    if (!last) {
      setApiError("Todavía no hay variantes para copiar.");
      return;
    }
    setApiError("");
    setVariantAttrs({ ...last.attributes });
    setVariantStock(last.stock);
    setVariantPrice(last.price === null || last.price === undefined ? "" : last.price);
    setVariantImageUrls([...last.imageUrls]);
  };

  const clearVariantDraft = () => {
    setApiError("");
    setVariantAttrs({});
    setVariantStock(1);
    setVariantPrice("");
    setVariantImageUrls([]);
  };

  const clearTalleColorDraft = () => {
    setApiError("");
    setVariantAttrs((prev) => {
      const next = { ...prev };
      for (const a of talleColorAxisList) delete next[a];
      return next;
    });
    setVariantImageUrls([]);
  };

  const applyFashionGrid = () => {
    const extras: Record<string, string> = {};
    for (const a of axes) {
      const k = normalizeAxisKey(a);
      if (k === "talle" || k === "color") continue;
      const v = String(variantAttrs[a] ?? "").trim();
      if (!v) {
        setApiError(
          `Completá «${formatAxisLabel(a)}» antes de agregar desde la grilla.`,
        );
        return;
      }
      extras[a] = v;
    }
    setApiError("");
    const cellStocksParsed: Record<string, number> = {};
    for (const t of gridTalles) {
      for (const c of gridColors) {
        const raw = String(gridCellStocks[fashionGridCellKey(t, c)] ?? "").trim();
        if (raw === "") continue;
        const n = Math.max(0, Math.floor(Number(raw.replace(",", "."))));
        if (n > 0) cellStocksParsed[fashionGridCellKey(t, c)] = n;
      }
    }
    const useMatrix = Object.keys(cellStocksParsed).length > 0;

    const built = buildTalleColorVariantGrid({
      axes,
      talles: gridTalles,
      colors: gridColors,
      productName,
      existingVariants: variants,
      buildGeneratedSku,
      stockPerVariant: Math.max(0, Number(variantStock || 0)),
      cellStocks: useMatrix ? cellStocksParsed : undefined,
      fixedExtraAttrs: Object.keys(extras).length > 0 ? extras : undefined,
    });
    if (built.length === 0) {
      setApiError(
        useMatrix
          ? "La matriz no tiene celdas con cantidad mayor a cero."
          : "Elegí al menos un talle y un color.",
      );
      return;
    }
    const sigs = new Set(variants.map((v) => variantAttrSignature(axes, v.attributes)));
    const toAdd = built.filter((b) => !sigs.has(variantAttrSignature(axes, b.attributes)));
    if (toAdd.length === 0) {
      setApiError("Todas esas combinaciones ya están en la lista.");
      return;
    }
    setVariants((prev) => [...prev, ...toAdd]);
    setGridTalles([]);
    setGridColors([]);
    setGridCellStocks({});
    scrollVariantsListIntoView();
  };

  const resetForm = () => {
    setProductName("");
    setBasePrice("");
    setProductImageUrls([]);
    setImageUrlDraft("");
    setTagsCsv("");
    setVariants([]);
    setVariantStock(1);
    setVariantPrice("");
    setVariantAttrs({});
    setVariantImageUrls([]);
    setSelectedCategoryIds([]);
    setCategoryFilter("");
    setVariantMode("multi");
    setGridTalles([]);
    setGridColors([]);
    setGridCellStocks({});
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
    const payloadVariants = variants;

    if (payloadVariants.length === 0) {
      setApiError(
        "Agregá al menos una variante (talle/color/etc.) antes de guardar.",
      );
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
          variants: payloadVariants.map(({ id, ...v }) => ({
            sku: v.sku,
            stock: v.stock,
            price: v.price,
            attributes: v.attributes,
            imageUrls: v.imageUrls,
            ...(v.categoryIds.length > 0 ? { categoryIds: v.categoryIds } : {}),
          })),
          categoryIds: selectedCategoryIds,
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
    !creating &&
    !!productName.trim() &&
    Number(basePrice) > 0 &&
    (variantMode === "multi"
      ? variants.length > 0
      : axes.every((axis) => String(variantAttrs[axis] ?? "").trim().length > 0) || variants.length > 0);

  const summary = useMemo(() => {
    const name = productName.trim();
    const price = Number(basePrice || 0);
    const variantCount = variantMode === "multi" ? variants.length : Math.max(variants.length, 1);
    const totalStock =
      variantMode === "multi"
        ? variants.reduce((acc, v) => acc + Number(v.stock ?? 0), 0)
        : Math.max(0, Number(variantStock || 0));
    const categories = allCategories
      .filter((c) => selectedCategoryIds.includes(c.id))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "es"))
      .map((c) => c.name);
    return { name, price, variantCount, totalStock, categories };
  }, [allCategories, basePrice, productName, selectedCategoryIds, variantMode, variantStock, variants]);

  const productImagesCharCount = useMemo(
    () => productImageUrls.reduce((acc, s) => acc + String(s ?? "").length, 0),
    [productImageUrls],
  );
  const payloadTooLargeHint = productImagesCharCount > 1_400_000;

  const fashionGridAddPreview = useMemo(() => {
    if (!fashionGridPath) return null;
    const t = gridTalles.length;
    const c = gridColors.length;
    if (t === 0 || c === 0) return { state: "pick" as const };
    let matrixVariants = 0;
    let matrixUnits = 0;
    for (const ti of gridTalles) {
      for (const ci of gridColors) {
        const raw = String(gridCellStocks[fashionGridCellKey(ti, ci)] ?? "").trim();
        if (raw === "") continue;
        const n = Math.max(0, Math.floor(Number(raw.replace(",", "."))));
        if (n > 0) {
          matrixVariants += 1;
          matrixUnits += n;
        }
      }
    }
    const hasMatrix = matrixVariants > 0;
    const perUniform = Math.max(0, Math.floor(Number(variantStock === "" ? 0 : variantStock) || 0));
    const combos = t * c;
    if (hasMatrix) {
      return { state: "matrix" as const, variants: matrixVariants, units: matrixUnits };
    }
    return {
      state: "uniform" as const,
      variants: combos,
      units: combos * perUniform,
      perUniform,
    };
  }, [fashionGridPath, gridTalles, gridColors, gridCellStocks, variantStock]);

  if (!open) return null;

  /* ─── Shared save button ─────────────────────────────────── */
  const SaveBtn = ({ fullWidth }: { fullWidth?: boolean }) => (
    <button
      type="submit"
      disabled={!canSubmit}
      style={{
        width: fullWidth ? "100%" : undefined,
        padding: isMobile ? "14px 20px" : "11px 22px",
        borderRadius: 10,
        border: "none",
        background: canSubmit ? "var(--color-primary)" : "var(--color-disabled-bg)",
        color: canSubmit ? "#fff" : "var(--color-disabled)",
        fontSize: isMobile ? 15 : 14,
        fontWeight: 800,
        cursor: canSubmit ? "pointer" : "not-allowed",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        transition: "opacity 0.15s",
        opacity: canSubmit ? 1 : 0.6,
      }}
      aria-busy={creating || undefined}
    >
      {creating ? (
        <Spinner size="sm" className="text-[var(--color-surface)]" label="Guardando" />
      ) : (
        "Guardar producto"
      )}
    </button>
  );

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
        style={{ maxWidth: isMobile ? "100%" : 1180, width: "100%" }}
      >
        {/* ── Header ── */}
        <div className="ws-modal-header" style={{ padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "var(--color-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Plus size={18} color="#fff" aria-hidden />
            </div>
            <div>
              <h2
                id="create-product-title"
                style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--color-text)", letterSpacing: "-0.02em" }}
              >
                Nuevo producto
              </h2>
              {axes.length > 0 && (
                <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)" }}>
                  Variantes por: <strong style={{ color: "var(--color-text)" }}>{axes.map(formatAxisLabel).join(", ")}</strong>
                </p>
              )}
            </div>
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
        <div
          className="ws-modal-body"
          style={{ paddingBottom: isMobile ? 100 : 24 }}
        >
          {/* Error / warning banners */}
          {apiError ? (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--color-error)",
                backgroundColor: "var(--color-error-bg)",
                border: "1px solid color-mix(in srgb, var(--color-error) 30%, transparent)",
              }}
            >
              {apiError}
            </div>
          ) : null}
          {payloadTooLargeHint ? (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                color: "color-mix(in srgb, var(--color-warning) 85%, #000)",
                backgroundColor: "color-mix(in srgb, var(--color-warning) 14%, var(--color-surface))",
                border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
              }}
            >
              Las imágenes ocupan mucho espacio (~{Math.round(productImagesCharCount / 1024)} KB). Si da error al guardar, reducí la cantidad de fotos.
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(260px, 320px)",
              gap: isMobile ? 16 : 22,
              alignItems: "start",
            }}
          >
            {/* ── Left: form sections ── */}
            <div style={{ minWidth: 0, display: "grid", gap: 20 }}>

              {/* ── Sección 1: Datos básicos ── */}
              <FormSection num={1} title="Datos del producto">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                    gap: 14,
                  }}
                >
                  <label style={labelSt}>
                    Nombre
                    <input
                      required
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder="Ej. Remera algodón premium"
                      className="ws-input"
                      autoFocus
                    />
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
                      inputMode="decimal"
                    />
                  </label>
                  <label style={{ ...labelSt, gridColumn: isMobile ? undefined : "1 / -1" }}>
                    Etiquetas
                    <input
                      value={tagsCsv}
                      onChange={(e) => setTagsCsv(e.target.value)}
                      placeholder="remera, verano, oferta  (separadas por comas)"
                      className="ws-input"
                    />
                  </label>
                </div>

                {/* Category chips */}
                {allCategories.length > 0 ? (
                  <div style={{ marginTop: 18 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text)",
                        marginBottom: 10,
                      }}
                    >
                      Categorías
                      {selectedCategoryIds.length > 0 && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "var(--color-primary)",
                            color: "#fff",
                          }}
                        >
                          {selectedCategoryIds.length}
                        </span>
                      )}
                    </div>
                    <input
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      placeholder="Buscar categoría…"
                      className="ws-input"
                      style={{ marginBottom: 10, maxWidth: 280 }}
                    />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {filteredCategoryTree.map(({ row: c, depth }) => {
                        const selected = selectedCategoryIds.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              setSelectedCategoryIds((prev) =>
                                prev.includes(c.id)
                                  ? prev.filter((x) => x !== c.id)
                                  : [...prev, c.id],
                              )
                            }
                            style={{
                              padding: depth === 0 ? "6px 14px" : "5px 11px",
                              borderRadius: 999,
                              border: selected
                                ? "2px solid var(--color-primary)"
                                : "1.5px solid var(--color-border)",
                              background: selected ? "var(--color-primary)" : "var(--color-bg)",
                              color: selected ? "#fff" : depth > 0 ? "var(--color-muted)" : "var(--color-text)",
                              fontSize: depth === 0 ? 13 : 12,
                              fontWeight: selected ? 700 : depth === 0 ? 600 : 400,
                              cursor: "pointer",
                              transition: "all 0.12s",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: depth > 0 ? 4 : 0,
                            }}
                          >
                            {depth > 0 && (
                              <span style={{ fontSize: 10, opacity: 0.5, marginRight: 2 }}>{"·".repeat(depth)}</span>
                            )}
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </FormSection>

              {/* ── Sección 2: Fotos ── */}
              <FormSection num={2} title="Fotos del producto">
                <ImageDropZone
                  onFilesSelected={(files) => void handleProductImagesUpload(files)}
                  count={productImageUrls.length}
                  maxCount={MAX_PRODUCT_IMAGES}
                  label="Arrastrá fotos acá o hacé clic"
                  sublabel="JPG / PNG · hasta 10 imágenes"
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
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
                    disabled={!imageUrlDraft.trim() || productImageUrls.length >= MAX_PRODUCT_IMAGES}
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
                  {productImageUrls.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setProductImageUrls([])}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        background: "transparent",
                        cursor: "pointer",
                        fontSize: 13,
                        color: "var(--color-error)",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      Quitar todas
                    </button>
                  )}
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

              {/* ── Sección 3: Variantes y stock ── */}
              <FormSection num={3} title="Stock y variantes">

                {/* Solo modo multi (lista de variantes) */}

                {/* Grilla talle×color (fashion) */}
                {fashionGridPath ? (
                  <div
                    style={{
                      padding: "16px",
                      borderRadius: 14,
                      border: "1px solid color-mix(in srgb, var(--color-primary) 22%, var(--color-border))",
                      background: "color-mix(in srgb, var(--color-primary) 4%, var(--color-bg))",
                      display: "grid",
                      gap: 14,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: "var(--color-text)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span>⚡</span> Carga masiva · talle × color
                    </div>

                    {otherVariantAxesForFashion.length > 0 && (
                      <div
                        style={{
                          padding: "12px 14px",
                          borderRadius: 10,
                          border: "1px solid var(--color-border)",
                          background: "var(--color-surface)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: "var(--color-muted)",
                            marginBottom: 10,
                          }}
                        >
                          Igual en todas las variantes
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                            gap: 10,
                          }}
                        >
                          {otherVariantAxesForFashion.map((axis) => (
                            <label key={axis} style={labelSt}>
                              {formatAxisLabel(axis)}
                              <input
                                value={variantAttrs[axis] ?? ""}
                                onChange={(e) =>
                                  setVariantAttrs((prev) => ({ ...prev, [axis]: e.target.value }))
                                }
                                placeholder={
                                  normalizeAxisKey(axis) === "marca" ? "Ej. Nike" : `Valor de ${formatAxisLabel(axis)}`
                                }
                                className="ws-input"
                              />
                              <FashionAxisQuickPicks
                                axis={axis}
                                axes={axes}
                                currentValue={variantAttrs[axis] ?? ""}
                                onSelect={(v) => setVariantAttrs((prev) => ({ ...prev, [axis]: v }))}
                                businessCategory={businessCategory}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.1fr) repeat(2, minmax(0, 1fr))",
                        gap: 10,
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)",
                      }}
                    >
                      <div
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--color-border)",
                          background: "var(--color-bg)",
                          minWidth: 0,
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
                          SKU
                        </span>
                        <div
                          style={{
                            marginTop: 6,
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 600,
                            fontSize: 12,
                            wordBreak: "break-all",
                            color: "var(--color-text)",
                          }}
                        >
                          {generatedSkuPreview}
                        </div>
                      </div>
                      <label style={labelSt}>
                        Stock por combinación
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={variantStock}
                          onChange={(e) =>
                            setVariantStock(e.target.value.trim() === "" ? "" : Number(e.target.value))
                          }
                          placeholder="1"
                          className="ws-input"
                        />
                      </label>
                      <label style={labelSt}>
                        Precio variante (ARS)
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={variantPrice}
                          onChange={(e) =>
                            setVariantPrice(
                              e.target.value.trim() === "" ? "" : Number(e.target.value),
                            )
                          }
                          placeholder="Base del producto"
                          className="ws-input"
                        />
                      </label>
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <FashionVariantGridPicker
                        axes={axes}
                        businessCategory={businessCategory}
                        gridTalles={gridTalles}
                        gridColors={gridColors}
                        setGridTalles={setGridTalles}
                        setGridColors={setGridColors}
                        isMobile={isMobile}
                      />
                      <FashionGridQtyMatrix
                        gridTalles={gridTalles}
                        gridColors={gridColors}
                        cellStocks={gridCellStocks}
                        setCellStocks={setGridCellStocks}
                        fillFromStock={Math.max(0, Math.floor(Number(variantStock === "" ? 0 : variantStock) || 0))}
                        isMobile={isMobile}
                      />
                      <button
                        type="button"
                        onClick={() => applyFashionGrid()}
                        style={{
                          width: "100%",
                          padding: isMobile ? "14px 16px" : "12px 18px",
                          borderRadius: 12,
                          border: "none",
                          background: "var(--color-primary)",
                          color: "#fff",
                          fontSize: isMobile ? 15 : 14,
                          fontWeight: 800,
                          cursor: "pointer",
                          display: "grid",
                          gap: 3,
                          textAlign: "center",
                        }}
                      >
                        <span>Agregar desde matriz</span>
                        {fashionGridAddPreview?.state === "pick" && (
                          <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>
                            Elegí al menos un talle y un color
                          </span>
                        )}
                        {fashionGridAddPreview?.state === "matrix" && (
                          <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>
                            ~{fashionGridAddPreview.variants} variantes · {fashionGridAddPreview.units} u. totales
                          </span>
                        )}
                        {fashionGridAddPreview?.state === "uniform" && (
                          <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>
                            ~{fashionGridAddPreview.variants} combinaciones × {fashionGridAddPreview.perUniform} u.
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Formulario de variante (manual) */}
                {!fashionGridPath ? (
                  <div
                      data-variant-builder
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || e.shiftKey) return;
                        const el = e.target as HTMLElement;
                        if (!el.matches("input[data-axis-field]")) return;
                        e.preventDefault();
                        addVariant();
                      }}
                      style={{
                        border: "1px solid var(--color-border)",
                        borderRadius: 12,
                        padding: "16px 18px",
                        background: "var(--color-surface)",
                        display: "grid",
                        gap: 14,
                      }}
                    >
                      {/* SKU + stock + precio */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.1fr) repeat(2, minmax(0, 1fr))",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid var(--color-border)",
                            background: "var(--color-surface)",
                            minWidth: 0,
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
                            SKU
                          </span>
                          <div
                            style={{
                              marginTop: 6,
                              fontFamily: "ui-monospace, monospace",
                              fontWeight: 600,
                              fontSize: 12,
                              wordBreak: "break-all",
                              color: "var(--color-text)",
                            }}
                          >
                            {generatedSkuPreview}
                          </div>
                        </div>
                        <label style={labelSt}>
                          Stock inicial
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={variantStock}
                            onChange={(e) => setVariantStock(e.target.value.trim() === "" ? "" : Number(e.target.value))}
                            placeholder="1"
                            className="ws-input"
                          />
                        </label>
                        <label style={labelSt}>
                          Precio variante (ARS)
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={variantPrice}
                            onChange={(e) => setVariantPrice(e.target.value.trim() === "" ? "" : Number(e.target.value))}
                            placeholder="Base del producto"
                            className="ws-input"
                          />
                        </label>
                      </div>

                      {/* Ejes */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: isMobile ? "1fr" : `repeat(auto-fit, minmax(140px, 1fr))`,
                          gap: 10,
                        }}
                      >
                        {axes.map((axis) => (
                          <label key={axis} style={labelSt}>
                            {formatAxisLabel(axis)}
                            <input
                              data-axis-field
                              value={variantAttrs[axis] ?? ""}
                              onChange={(e) => setVariantAttrs((prev) => ({ ...prev, [axis]: e.target.value }))}
                              placeholder={
                                normalizeAxisKey(axis) === "color"
                                  ? "Ej. Negro"
                                  : normalizeAxisKey(axis) === "talle"
                                    ? "Ej. M / 40"
                                    : normalizeAxisKey(axis) === "marca"
                                      ? "Ej. Nike"
                                      : `Valor de ${formatAxisLabel(axis)}`
                              }
                              className="ws-input"
                            />
                            <FashionAxisQuickPicks
                              axis={axis}
                              axes={axes}
                              currentValue={variantAttrs[axis] ?? ""}
                              onSelect={(v) => setVariantAttrs((prev) => ({ ...prev, [axis]: v }))}
                              businessCategory={businessCategory}
                            />
                          </label>
                        ))}
                      </div>

                      {/* Fotos de la variante */}
                      <div style={{ display: "grid", gap: 8 }}>
                        <ImageDropZone
                          onFilesSelected={(files) => void handleVariantImagesUpload(files)}
                          count={variantImageUrls.length}
                          maxCount={MAX_VARIANT_IMAGES}
                          label="Foto específica de esta variante"
                          sublabel="Opcional"
                        />
                        <ImageThumbnailGrid
                          urls={variantImageUrls}
                          thumbHeight={72}
                          onRemove={(idx) => setVariantImageUrls((prev) => prev.filter((_, i) => i !== idx))}
                          onMoveUp={(idx) =>
                            setVariantImageUrls((prev) => {
                              const next = [...prev];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              return next;
                            })
                          }
                        />
                      </div>

                      {/* Botones */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <>
                          <button
                            type="button"
                            onClick={addVariant}
                            disabled={!variantAxesComplete}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: isMobile ? "12px 20px" : "9px 16px",
                              borderRadius: 10,
                              border: "none",
                              background: variantAxesComplete ? "var(--color-primary)" : "var(--color-disabled-bg)",
                              cursor: variantAxesComplete ? "pointer" : "not-allowed",
                              fontSize: isMobile ? 15 : 13,
                              fontWeight: 800,
                              color: variantAxesComplete ? "#fff" : "var(--color-disabled)",
                              opacity: variantAxesComplete ? 1 : 0.75,
                            }}
                          >
                            <Plus size={14} aria-hidden />
                            Agregar
                          </button>
                          <button
                            type="button"
                            onClick={duplicateFromLastVariant}
                            disabled={variants.length === 0}
                            style={{
                              padding: "9px 14px",
                              borderRadius: 8,
                              border: "1px solid var(--color-border)",
                              background: "var(--color-surface)",
                              cursor: variants.length === 0 ? "not-allowed" : "pointer",
                              fontSize: 13,
                              fontWeight: 600,
                              color: variants.length === 0 ? "var(--color-muted)" : "var(--color-text)",
                              opacity: variants.length === 0 ? 0.5 : 1,
                            }}
                          >
                            Copiar última
                          </button>
                          <button
                            type="button"
                            onClick={clearVariantDraft}
                            style={{
                              padding: "9px 14px",
                              borderRadius: 8,
                              border: "1px solid var(--color-border)",
                              background: "transparent",
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--color-muted)",
                            }}
                          >
                            Limpiar
                          </button>
                        </>
                      </div>
                    </div>
                ) : (
                  /* Carga manual oculta dentro de un details cuando hay grilla fashion */
                  <details
                    style={{
                      borderRadius: 12,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)",
                    }}
                  >
                    <summary
                      style={{
                        padding: "12px 16px",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--color-text)",
                        listStyle: "none",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span>✏️</span> Agregar una variante manualmente
                    </summary>
                    <div style={{ padding: "0 16px 16px" }}>
                      <div
                        data-variant-builder
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" || e.shiftKey) return;
                          const el = e.target as HTMLElement;
                          if (!el.matches("input[data-axis-field]")) return;
                          e.preventDefault();
                          addVariant();
                        }}
                        style={{
                          border: "2px dashed var(--color-growth-strong)",
                          borderRadius: 12,
                          padding: "16px 18px",
                          background: "var(--color-growth-soft)",
                          display: "grid",
                          gap: 14,
                          marginTop: 12,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: isMobile ? "1fr" : `repeat(${talleColorAxisList.length}, minmax(0,1fr))`,
                            gap: 12,
                          }}
                        >
                          {talleColorAxisList.map((axis) => (
                            <label key={axis} style={labelSt}>
                              {formatAxisLabel(axis)}
                              <input
                                data-axis-field
                                value={variantAttrs[axis] ?? ""}
                                onChange={(e) =>
                                  setVariantAttrs((prev) => ({ ...prev, [axis]: e.target.value }))
                                }
                                placeholder={normalizeAxisKey(axis) === "color" ? "Ej. Negro" : "Ej. M / 40"}
                                className="ws-input"
                              />
                              <FashionAxisQuickPicks
                                axis={axis}
                                axes={axes}
                                currentValue={variantAttrs[axis] ?? ""}
                                onSelect={(v) => setVariantAttrs((prev) => ({ ...prev, [axis]: v }))}
                                businessCategory={businessCategory}
                              />
                            </label>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: 8 }}>
                          <ImageDropZone
                            onFilesSelected={(files) => void handleVariantImagesUpload(files)}
                            count={variantImageUrls.length}
                            maxCount={MAX_VARIANT_IMAGES}
                            label="Foto de esta variante"
                            sublabel=""
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
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={addVariant}
                            disabled={!variantAxesComplete}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "9px 18px",
                              borderRadius: 8,
                              border: "none",
                              background: variantAxesComplete ? "var(--color-primary)" : "var(--color-disabled-bg)",
                              cursor: variantAxesComplete ? "pointer" : "not-allowed",
                              fontSize: 13,
                              fontWeight: 800,
                              color: variantAxesComplete ? "#fff" : "var(--color-disabled)",
                              opacity: variantAxesComplete ? 1 : 0.75,
                            }}
                          >
                            <Plus size={14} aria-hidden />
                            Agregar
                          </button>
                          <button
                            type="button"
                            onClick={duplicateFromLastVariant}
                            disabled={variants.length === 0}
                            style={{
                              padding: "9px 14px",
                              borderRadius: 8,
                              border: "1px solid var(--color-border)",
                              background: "var(--color-surface)",
                              cursor: variants.length === 0 ? "not-allowed" : "pointer",
                              fontSize: 13,
                              fontWeight: 600,
                              color: variants.length === 0 ? "var(--color-muted)" : "var(--color-text)",
                              opacity: variants.length === 0 ? 0.5 : 1,
                            }}
                          >
                            Copiar última
                          </button>
                          <button
                            type="button"
                            onClick={clearTalleColorDraft}
                            style={{
                              padding: "9px 14px",
                              borderRadius: 8,
                              border: "1px solid var(--color-border)",
                              background: "transparent",
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--color-muted)",
                            }}
                          >
                            Vaciar
                          </button>
                        </div>
                      </div>
                    </div>
                  </details>
                )}

                {/* Lista de variantes cargadas */}
                {variantMode === "multi" && variants.length > 0 ? (
                  <div ref={variantsListRef} style={{ display: "grid", gap: 8, marginTop: 16 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--color-text)",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        Variantes cargadas
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 800,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "var(--color-primary)",
                            color: "#fff",
                          }}
                        >
                          {variants.length}
                        </span>
                      </span>
                      <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
                        {variants.reduce((a, v) => a + Number(v.stock ?? 0), 0)} u. en total
                      </span>
                    </div>
                    <div
                      style={{
                        maxHeight: isMobile ? "min(46vh, 340px)" : "min(44vh, 400px)",
                        overflow: "auto",
                        WebkitOverflowScrolling: "touch",
                        borderRadius: 10,
                        border: "1px solid var(--color-border)",
                        background: "var(--color-bg)",
                      }}
                    >
                      {!isMobile ? (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(120px, 1.4fr) 56px 76px 44px 36px",
                            gap: 8,
                            padding: "8px 12px",
                            fontSize: 10,
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "var(--color-muted)",
                            borderBottom: "1px solid var(--color-border)",
                            background: "color-mix(in srgb, var(--color-bg) 85%, var(--color-surface))",
                            position: "sticky",
                            top: 0,
                            zIndex: 1,
                          }}
                        >
                          <span>SKU · ejes</span>
                          <span style={{ textAlign: "right" }}>Stock</span>
                          <span style={{ textAlign: "right" }}>Precio</span>
                          <span style={{ textAlign: "center" }}>Fotos</span>
                          <span />
                        </div>
                      ) : null}
                      {variants.map((item, idx) => {
                        const attrLine = Object.entries(item.attributes)
                          .map(([k, v]) => `${formatAxisLabel(k)} ${v}`)
                          .join(" · ");
                        return (
                          <div
                            key={item.id}
                            style={{
                              borderBottom: idx < variants.length - 1 ? "1px solid var(--color-border)" : undefined,
                              backgroundColor: "var(--color-surface)",
                              minWidth: isMobile ? 420 : undefined,
                            }}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(120px, 1.4fr) 56px 76px 44px 36px",
                                gap: 8,
                                alignItems: "center",
                                padding: "8px 12px",
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontFamily: "ui-monospace, monospace",
                                    fontWeight: 600,
                                    fontSize: 11,
                                    color: "var(--color-text)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={item.sku}
                                >
                                  {item.sku}
                                </div>
                                <div
                                  style={{
                                    marginTop: 2,
                                    fontSize: 11,
                                    color: "var(--color-muted)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={attrLine}
                                >
                                  {attrLine}
                                </div>
                              </div>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                value={item.stock}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const n = v === "" ? 0 : Math.max(0, Math.floor(Number(v)));
                                  if (Number.isNaN(n)) return;
                                  setVariants((prev) =>
                                    prev.map((row) => (row.id === item.id ? { ...row, stock: n } : row)),
                                  );
                                }}
                                className="ws-input"
                                style={{ width: 56, padding: "6px", fontSize: 12, fontWeight: 700, textAlign: "right" }}
                                aria-label={`Stock de ${item.sku}`}
                              />
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                inputMode="decimal"
                                value={item.price === null || item.price === undefined ? "" : item.price}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  const price =
                                    raw === "" || Number.isNaN(Number(raw)) ? null : Math.max(0, Number(raw));
                                  setVariants((prev) =>
                                    prev.map((row) => (row.id === item.id ? { ...row, price } : row)),
                                  );
                                }}
                                placeholder="Base"
                                className="ws-input"
                                style={{ width: 76, padding: "6px", fontSize: 12, textAlign: "right" }}
                                aria-label={`Precio de ${item.sku}`}
                              />
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 3,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: item.imageUrls.length > 0 ? "var(--color-primary)" : "var(--color-muted)",
                                }}
                                title={item.imageUrls.length ? "Fotos propias de esta variante" : "Sin fotos propias"}
                              >
                                <ImageIcon size={13} aria-hidden />
                                <span>{item.imageUrls.length}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setVariants((prev) => prev.filter((v) => v.id !== item.id))}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "var(--color-error)",
                                  cursor: "pointer",
                                  fontSize: 18,
                                  lineHeight: 1,
                                  padding: "4px 6px",
                                  fontWeight: 700,
                                }}
                                title="Quitar variante"
                                aria-label={`Quitar ${item.sku}`}
                              >
                                ×
                              </button>
                            </div>

                            {/* Fotos y categorías por variante */}
                            {allCategories.length > 0 && (
                              <details
                                style={{
                                  margin: "0 8px 8px",
                                  padding: "8px 10px",
                                  borderRadius: 8,
                                  border: "1px dashed color-mix(in srgb, var(--color-primary) 30%, var(--color-border))",
                                  background: "color-mix(in srgb, var(--color-bg) 90%, transparent)",
                                  fontSize: 11,
                                }}
                              >
                                <summary
                                  style={{
                                    cursor: "pointer",
                                    fontWeight: 700,
                                    color: "var(--color-muted)",
                                    listStyle: "none",
                                  }}
                                >
                                  + fotos y categorías de esta variante
                                  {item.categoryIds.length > 0 && ` (${item.categoryIds.length} cat.)`}
                                </summary>
                                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                                  <label
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 8,
                                      padding: "8px 12px",
                                      borderRadius: 8,
                                      border: "1px solid var(--color-border)",
                                      background: "var(--color-bg)",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      width: "fit-content",
                                    }}
                                  >
                                    <input
                                      type="file"
                                      accept="image/jpeg,image/png,image/webp"
                                      multiple
                                      style={{ display: "none" }}
                                      onChange={(e) => {
                                        const files = Array.from(e.target.files ?? []);
                                        e.target.value = "";
                                        void appendImagesToVariantRow(item.id, files);
                                      }}
                                    />
                                    + Agregar fotos
                                    <span style={{ color: "var(--color-muted)", fontWeight: 400 }}>
                                      ({Math.max(0, MAX_VARIANT_IMAGES - item.imageUrls.length)} restantes)
                                    </span>
                                  </label>
                                  {item.imageUrls.length > 0 && (
                                    <ImageThumbnailGrid
                                      urls={item.imageUrls}
                                      thumbHeight={56}
                                      onRemove={(ix) =>
                                        setVariants((prev) =>
                                          prev.map((row) =>
                                            row.id === item.id
                                              ? { ...row, imageUrls: row.imageUrls.filter((_, j) => j !== ix) }
                                              : row,
                                          ),
                                        )
                                      }
                                      onMoveUp={(ix) =>
                                        setVariants((prev) =>
                                          prev.map((row) => {
                                            if (row.id !== item.id) return row;
                                            const next = [...row.imageUrls];
                                            [next[ix - 1], next[ix]] = [next[ix], next[ix - 1]];
                                            return { ...row, imageUrls: next };
                                          }),
                                        )
                                      }
                                    />
                                  )}
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                    {filteredCategoryTree.map(({ row: c, depth }) => {
                                      const sel = item.categoryIds.includes(c.id);
                                      return (
                                        <button
                                          key={`${item.id}-${c.id}`}
                                          type="button"
                                          onClick={() => toggleVariantRowCategory(item.id, c.id)}
                                          style={{
                                            padding: depth === 0 ? "4px 11px" : "3px 9px",
                                            borderRadius: 999,
                                            border: sel
                                              ? "1.5px solid var(--color-primary)"
                                              : "1.5px solid var(--color-border)",
                                            background: sel ? "var(--color-primary)" : "var(--color-surface)",
                                            color: sel ? "#fff" : "var(--color-muted)",
                                            fontSize: 11,
                                            fontWeight: sel ? 700 : 400,
                                            cursor: "pointer",
                                          }}
                                        >
                                          {c.name}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </details>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </FormSection>
            </div>

            {/* ── Right rail: resumen + guardar (solo desktop) ── */}
            {!isMobile && (
              <aside
                style={{
                  position: "sticky",
                  top: 16,
                  borderRadius: 14,
                  border: "1px solid var(--color-border)",
                  backgroundColor: "var(--color-surface)",
                  overflow: "hidden",
                  boxShadow: "var(--shadow-md)",
                }}
              >
                {/* Resumen */}
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: "var(--color-muted)",
                      marginBottom: 8,
                    }}
                  >
                    Resumen
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: summary.name ? "var(--color-text)" : "var(--color-muted)",
                      lineHeight: 1.25,
                      marginBottom: 4,
                    }}
                  >
                    {summary.name || "Sin nombre aún"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                    {summary.variantCount} variante{summary.variantCount !== 1 ? "s" : ""} · {summary.totalStock} u.
                  </div>
                </div>

                <div style={{ padding: "12px 16px", display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Precio base</span>
                    <strong style={{ fontSize: 13, color: "var(--color-text)" }}>
                      {new Intl.NumberFormat("es-AR", {
                        style: "currency",
                        currency: "ARS",
                        maximumFractionDigits: 0,
                      }).format(Number.isFinite(summary.price) ? summary.price : 0)}
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Fotos</span>
                    <strong style={{ fontSize: 13, color: "var(--color-text)" }}>
                      {productImageUrls.length}
                    </strong>
                  </div>
                  {summary.categories.length > 0 ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Categorías</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {summary.categories.slice(0, 5).map((c) => (
                          <span
                            key={c}
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "3px 8px",
                              borderRadius: 999,
                              background: "var(--color-primary-ultra-light)",
                              color: "var(--color-primary)",
                            }}
                          >
                            {c}
                          </span>
                        ))}
                        {summary.categories.length > 5 && (
                          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
                            +{summary.categories.length - 5} más
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Sin categorías</span>
                  )}
                </div>

                {/* Botones desktop */}
                <div
                  style={{
                    padding: "12px 16px",
                    borderTop: "1px solid var(--color-border)",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <SaveBtn fullWidth />
                  <button
                    type="button"
                    onClick={handleClose}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid var(--color-border)",
                      backgroundColor: "transparent",
                      color: "var(--color-muted)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </aside>
            )}
          </div>

          {/* Resumen compacto en mobile (debajo del formulario) */}
          {isMobile && (
            <div
              style={{
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                padding: "12px 14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: summary.name ? "var(--color-text)" : "var(--color-muted)" }}>
                  {summary.name || "Sin nombre aún"}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>
                  {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(
                    Number.isFinite(summary.price) ? summary.price : 0,
                  )}{" "}
                  · {summary.variantCount} variante{summary.variantCount !== 1 ? "s" : ""} · {summary.totalStock} u.
                </div>
              </div>
              {summary.categories.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {summary.categories.slice(0, 3).map((c) => (
                    <span
                      key={c}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--color-primary-ultra-light)",
                        color: "var(--color-primary)",
                        fontWeight: 600,
                      }}
                    >
                      {c}
                    </span>
                  ))}
                  {summary.categories.length > 3 && (
                    <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
                      +{summary.categories.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer desktop ── */}
        {!isMobile && (
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
            <SaveBtn />
          </div>
        )}

        {/* ── Barra inferior sticky en mobile ── */}
        {isMobile && (
          <div
            style={{
              position: "sticky",
              bottom: 0,
              left: 0,
              right: 0,
              padding: "10px 16px",
              background: "var(--color-surface)",
              borderTop: "1px solid var(--color-border)",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              zIndex: 10,
              boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
            }}
          >
            <SaveBtn fullWidth />
            <button
              type="button"
              onClick={handleClose}
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                color: "var(--color-muted)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Cancelar
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
