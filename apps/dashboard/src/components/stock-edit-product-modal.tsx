"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Plus, Pencil, ChevronDown } from "lucide-react";
import {
  formatAxisLabel,
  StockFieldHint,
  FormSection,
  ImageDropZone,
  ImageThumbnailGrid,
  uploadImagesToSupabase,
} from "@/components/stock-ui";
import { Spinner } from "@/components/ui";
import { getClientApiBase } from "@/lib/api-base";
import { buildGeneratedSku } from "@/lib/stock-sku";
import { FashionAxisQuickPicks } from "@/components/stock-fashion-axis-pickers";
import { normalizeAxisKey } from "@/lib/stock-fashion-ui";

export type StockProductVariantRow = {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  attributes: Record<string, string>;
  variantTalle?: string | null;
  variantColor?: string | null;
  variantMarca?: string | null;
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
  categoryIds?: string[];
  categoryNames?: string[];
  productCategoryIds?: string[];
  variantCategoryIds?: string[];
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
  variantCategoryIds: string[];
};

const MAX_PRODUCT_IMAGES = 10;
const MAX_VARIANT_IMAGES = 6;

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

function authHeaders(): HeadersInit | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
  if (!token || !tenantId) return null;
  return { Authorization: `Bearer ${token}`, "x-tenant-id": tenantId, "Content-Type": "application/json" };
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

/* ─── Pill toggle reutilizable ───────────────────────────────────────────── */
function ActiveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      title={value ? "Activa en catálogo" : "Inactiva — no aparece en tienda"}
      style={{
        position: "relative",
        width: 34,
        height: 18,
        borderRadius: 999,
        border: "none",
        background: value ? "var(--color-primary)" : "var(--color-border)",
        cursor: "pointer",
        transition: "background 0.18s",
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
          transition: "left 0.18s var(--ease-default)",
        }}
      />
    </button>
  );
}

export function StockEditProductModal({
  open,
  onClose,
  axes,
  isMobile,
  rows,
  onSaved,
  businessCategory,
}: {
  open: boolean;
  onClose: () => void;
  axes: string[];
  isMobile: boolean;
  rows: StockProductVariantRow[];
  onSaved: () => void;
  businessCategory?: string;
}) {
  /* ── State ── */
  const [productName, setProductName] = useState("");
  const [basePrice, setBasePrice] = useState<number | "">("");
  const [productImageUrls, setProductImageUrls] = useState<string[]>([]);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [draftAttrs, setDraftAttrs] = useState<Record<string, string>>({});
  const [draftStock, setDraftStock] = useState<number | "">("");
  const [draftPrice, setDraftPrice] = useState<number | "">("");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [draftImageUrls, setDraftImageUrls] = useState<string[]>([]);
  const [draftVariantCategoryIds, setDraftVariantCategoryIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState("");
  const [allCategories, setAllCategories] = useState<CategoryOption[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");

  /* ── Derived (all memos before early return) ── */
  const categoryTree = useMemo(() => buildTree(allCategories), [allCategories]);
  const filteredCategoryTree = useMemo(() => {
    const q = categoryFilter.trim().toLowerCase();
    if (!q) return categoryTree;
    return categoryTree.filter((x) => x.row.name.toLowerCase().includes(q));
  }, [categoryFilter, categoryTree]);

  const totalStock = useMemo(
    () => lines.reduce((acc, l) => acc + (l.stock === "" ? 0 : Number(l.stock ?? 0)), 0),
    [lines],
  );

  const selectedCategoryNames = useMemo(
    () =>
      allCategories
        .filter((c) => selectedCategoryIds.includes(c.id))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "es"))
        .map((c) => c.name),
    [allCategories, selectedCategoryIds],
  );

  const draftSkuPreview = buildGeneratedSku(
    productName,
    Object.fromEntries(axes.map((axis) => [axis, String(draftAttrs[axis] ?? "").trim()])),
    lines.map((l) => l.sku),
  );

  /* ── Effects ── */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const headers = authHeaders();
      if (!headers) return;
      const res = await fetch(`${getClientApiBase()}/categories`, { headers, cache: "no-store" });
      if (!cancelled && res.ok) setAllCategories((await res.json()) as CategoryOption[]);
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || rows.length === 0) return;
    const first = rows[0];
    setProductName(first.name);
    setBasePrice(toNum(first.basePrice));
    setProductImageUrls(
      Array.isArray(first.imageUrls) && first.imageUrls.length > 0
        ? first.imageUrls
        : typeof first.imageUrl === "string" && first.imageUrl.trim()
          ? [first.imageUrl.trim()]
          : [],
    );
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
        variantCategoryIds: Array.isArray(r.variantCategoryIds)
          ? r.variantCategoryIds.map((x) => String(x))
          : [],
      })),
    );
    setDraftAttrs({});
    setDraftStock("");
    setDraftPrice("");
    setDraftOpen(false);
    setDraftError("");
    setApiError("");
    const prodCats =
      Array.isArray(first.productCategoryIds) && first.productCategoryIds.length > 0
        ? first.productCategoryIds.map((x) => String(x))
        : Array.isArray(first.categoryIds)
          ? first.categoryIds.filter(
              (id) => !(Array.isArray(first.variantCategoryIds) && first.variantCategoryIds.includes(id)),
            )
          : [];
    setSelectedCategoryIds(prodCats);
  }, [open, rows]);

  /* ── Handlers ── */
  const handleProductImagesUpload = async (files: File[]) => {
    try {
      const bounded = files.slice(0, Math.max(0, MAX_PRODUCT_IMAGES - productImageUrls.length));
      if (bounded.length === 0) return;
      const tenantId = typeof window !== "undefined" ? (window.localStorage.getItem("ws_tenant_id") ?? "") : "";
      const urls = await uploadImagesToSupabase(bounded, tenantId || undefined);
      if (urls.length > 0) setProductImageUrls((prev) => [...prev, ...urls]);
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "No se pudieron subir las imágenes");
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

  const appendDraftVariant = () => {
    const attrs = Object.fromEntries(
      Object.entries(draftAttrs).map(([k, v]) => [k, String(v ?? "").trim()]).filter(([, v]) => v.length > 0),
    );
    const missing = axes.filter((axis) => !attrs[axis]);
    if (missing.length > 0) {
      setDraftError(`Completá: ${missing.map(formatAxisLabel).join(", ")}`);
      return;
    }
    setDraftError("");
    const sku = buildGeneratedSku(productName, attrs, lines.map((l) => l.sku));
    const stock = draftStock === "" ? 0 : Math.max(0, Math.floor(Number(draftStock)));
    const price = draftPrice === "" || Number.isNaN(Number(draftPrice)) ? "" : Math.max(0, Number(draftPrice));
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
        imageUrls: draftImageUrls,
        variantCategoryIds: draftVariantCategoryIds,
      },
    ]);
    setDraftAttrs({});
    setDraftStock("");
    setDraftPrice("");
    setDraftImageUrls([]);
    setDraftVariantCategoryIds([]);
    setDraftOpen(false);
  };

  const cancelDraft = () => {
    setDraftOpen(false);
    setDraftError("");
    setDraftAttrs({});
    setDraftStock("");
    setDraftPrice("");
    setDraftImageUrls([]);
    setDraftVariantCategoryIds([]);
  };

  const handleDraftVariantImagesUpload = async (files: File[]) => {
    try {
      const bounded = files.slice(0, Math.max(0, MAX_VARIANT_IMAGES - draftImageUrls.length));
      if (bounded.length === 0) return;
      const tenantId = typeof window !== "undefined" ? (window.localStorage.getItem("ws_tenant_id") ?? "") : "";
      const urls = await uploadImagesToSupabase(bounded, tenantId || undefined);
      if (urls.length > 0) setDraftImageUrls((prev) => [...prev, ...urls]);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "No se pudieron subir las imágenes");
    }
  };

  const toggleDraftVariantCategory = (categoryId: string) => {
    setDraftVariantCategoryIds((prev) => {
      const set = new Set(prev);
      if (set.has(categoryId)) set.delete(categoryId);
      else set.add(categoryId);
      return [...set];
    });
  };

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
          imageUrls: productImageUrls,
          tags: tagsCsv.split(",").map((t) => t.trim()).filter(Boolean),
          categoryIds: selectedCategoryIds,
        }),
      });
      if (!productRes.ok) throw new Error(await productRes.text());

      const persistBody = (line: EditLine) => ({
        sku: line.sku.trim(),
        attributes: line.attributes,
        stock: line.stock === "" ? 0 : Math.max(0, Math.floor(Number(line.stock))),
        isActive: line.isActive,
        price: line.price === "" ? null : Math.max(0, Number(line.price)),
        imageUrls: line.imageUrls,
        categoryIds: line.variantCategoryIds,
      });

      for (const line of lines.filter((l) => !l.isNew && l.variantId)) {
        const vr = await fetch(`${getClientApiBase()}/products/variants/${line.variantId}`, {
          method: "PATCH", headers, body: JSON.stringify(persistBody(line)),
        });
        if (!vr.ok) throw new Error(`${line.sku}: ${(await vr.text()) || vr.statusText}`);
      }

      for (const line of lines.filter((l) => l.isNew)) {
        const vr = await fetch(`${getClientApiBase()}/products/${productId}/variants`, {
          method: "POST", headers, body: JSON.stringify(persistBody(line)),
        });
        if (!vr.ok) throw new Error(`Alta ${line.sku}: ${(await vr.text()) || vr.statusText}`);
      }

      onSaved();
      onClose();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "No se pudo guardar el producto");
    } finally {
      setSaving(false);
    }
  };

  /* ── After all hooks ── */
  if (!open) return null;

  const canSubmit = !saving && !!productName.trim() && Number(basePrice) >= 0 && lines.every((l) => !!String(l.sku).trim());

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
      aria-busy={saving || undefined}
    >
      {saving ? <Spinner size="sm" className="text-[var(--color-surface)]" label="Guardando" /> : "Guardar cambios"}
    </button>
  );

  /* Desktop column template — shared between header row and variant rows */
  const COLS_DESKTOP = "minmax(100px, 180px) 1fr 68px 88px 42px 32px 28px";
  const COLS_MOBILE = "1fr 68px 32px 28px";

  return (
    <div className="ws-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-product-title">
      <form onSubmit={(ev) => void save(ev)} className="ws-modal-panel" style={{ maxWidth: isMobile ? "100%" : 1100, width: "100%" }}>

        {/* ── Header ── */}
        <div className="ws-modal-header" style={{ padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Pencil size={16} color="#fff" aria-hidden />
            </div>
            <div>
              <h2 id="edit-product-title" style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "var(--color-text)", letterSpacing: "-0.02em" }}>
                Editar producto
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)" }}>
                {productName || rows[0]?.name || ""} · {lines.length} variante{lines.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button type="button" className="ws-btn-close" onClick={onClose} aria-label="Cerrar sin guardar">
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="ws-modal-body" style={{ paddingBottom: isMobile ? 100 : 24 }}>
          {apiError ? (
            <div role="alert" style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, color: "var(--color-error)", backgroundColor: "var(--color-error-bg)", border: "1px solid color-mix(in srgb, var(--color-error) 30%, transparent)" }}>
              {apiError}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(260px, 320px)", gap: isMobile ? 16 : 22, alignItems: "start" }}>

            {/* ── Left: form sections ── */}
            <div style={{ minWidth: 0, display: "grid", gap: 20 }}>

              {/* 1 · Datos del producto */}
              <FormSection num={1} title="Datos del producto">
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
                  <label style={labelSt}>
                    Nombre del producto
                    <input required value={productName} onChange={(e) => setProductName(e.target.value)} className="ws-input" autoFocus />
                    <StockFieldHint>Aplica a todas las variantes de este producto.</StockFieldHint>
                  </label>
                  <label style={labelSt}>
                    Precio de lista (ARS)
                    <input type="number" min={0} step="0.01" required value={basePrice} onChange={(e) => setBasePrice(e.target.value.trim() === "" ? "" : Number(e.target.value))} className="ws-input" inputMode="decimal" />
                    <StockFieldHint>Precio por defecto si la variante no tiene precio propio.</StockFieldHint>
                  </label>
                  <label style={{ ...labelSt, gridColumn: isMobile ? undefined : "1 / -1" }}>
                    Etiquetas
                    <input value={tagsCsv} onChange={(e) => setTagsCsv(e.target.value)} placeholder="remera, verano  (separadas por comas)" className="ws-input" />
                  </label>
                </div>

                {allCategories.length > 0 ? (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
                      Categorías
                      {selectedCategoryIds.length > 0 && (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--color-primary)", color: "#fff" }}>
                          {selectedCategoryIds.length}
                        </span>
                      )}
                    </div>
                    <StockFieldHint style={{ marginBottom: 10 }}>Filtrado en inventario y tienda pública.</StockFieldHint>
                    <input value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} placeholder="Buscar categoría…" className="ws-input" style={{ marginBottom: 10, maxWidth: 280 }} />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {filteredCategoryTree.map(({ row: c, depth }) => {
                        const selected = selectedCategoryIds.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setSelectedCategoryIds((prev) => prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                            style={{
                              padding: depth === 0 ? "6px 14px" : "5px 11px",
                              borderRadius: 999,
                              border: selected ? "2px solid var(--color-primary)" : "1.5px solid var(--color-border)",
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
                            {depth > 0 && <span style={{ fontSize: 10, opacity: 0.5, marginRight: 2 }}>{"·".repeat(depth)}</span>}
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </FormSection>

              {/* 2 · Fotos */}
              <FormSection num={2} title="Fotos del producto" description="La primera imagen es la foto principal.">
                <ImageDropZone onFilesSelected={(files) => void handleProductImagesUpload(files)} count={productImageUrls.length} maxCount={MAX_PRODUCT_IMAGES} label="Arrastrá fotos acá o hacé clic" sublabel="JPG / PNG · hasta 10 imágenes" />
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                  <input value={imageUrlDraft} onChange={(e) => setImageUrlDraft(e.target.value)} placeholder="O pegá una URL de imagen…" className="ws-input" style={{ flex: "1 1 180px", minWidth: 0 }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addImageUrl(); } }} />
                  <button type="button" onClick={addImageUrl} disabled={!imageUrlDraft.trim() || productImageUrls.length >= MAX_PRODUCT_IMAGES} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
                    Agregar URL
                  </button>
                  {productImageUrls.length > 0 ? (
                    <button type="button" onClick={() => setProductImageUrls([])} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--color-border)", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--color-error)", whiteSpace: "nowrap", flexShrink: 0 }}>
                      Quitar todas
                    </button>
                  ) : null}
                </div>
                <ImageThumbnailGrid
                  urls={productImageUrls}
                  onRemove={(idx) => setProductImageUrls((prev) => prev.filter((_, i) => i !== idx))}
                  onMoveUp={(idx) => setProductImageUrls((prev) => { const next = [...prev]; [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]; return next; })}
                />
              </FormSection>

              {/* 3 · Variantes — tabla compacta */}
              <FormSection num={3} title={`Variantes (${lines.length})`}>
                <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden", background: "var(--color-bg)" }}>

                  {/* Column headers — desktop, only when there are variants */}
                  {!isMobile && lines.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: COLS_DESKTOP,
                        gap: 8,
                        padding: "7px 12px 7px 15px",
                        fontSize: 10,
                        fontWeight: 800,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        color: "var(--color-muted)",
                        borderBottom: "1px solid var(--color-border)",
                        background: "color-mix(in srgb, var(--color-surface) 80%, var(--color-bg))",
                      }}
                    >
                      <span>Variante</span>
                      <span>SKU</span>
                      <span style={{ textAlign: "right" }}>Depósito</span>
                      <span style={{ textAlign: "right" }}>Precio</span>
                      <span style={{ textAlign: "center" }}>Activa</span>
                      <span />
                      <span />
                    </div>
                  )}

                  {/* Variant rows */}
                  {lines.map((line, idx) => (
                    <VariantEditCard
                      key={line.clientKey}
                      line={line}
                      idx={idx}
                      axes={axes}
                      isMobile={isMobile}
                      categoryRows={filteredCategoryTree}
                      colsDesktop={COLS_DESKTOP}
                      colsMobile={COLS_MOBILE}
                      onUpdateLine={(patch) => setLines((prev) => prev.map((L) => L.clientKey === line.clientKey ? { ...L, ...patch } : L))}
                      onRemoveLine={() => setLines((prev) => prev.filter((L) => L.clientKey !== line.clientKey))}
                      onError={setApiError}
                    />
                  ))}

                  {/* Add variant — draft form or ghost button */}
                  {draftOpen ? (
                    <div
                      style={{
                        padding: "16px",
                        background: "color-mix(in srgb, var(--color-growth-soft) 60%, var(--color-bg))",
                        borderTop: lines.length > 0 ? "1px solid var(--color-border)" : undefined,
                        display: "grid",
                        gap: 12,
                        boxShadow: "inset 3px 0 0 var(--color-growth-strong)",
                      }}
                    >
                      {draftError && (
                        <p style={{ margin: 0, fontSize: 12, color: "var(--color-error)", fontWeight: 600 }}>
                          {draftError}
                        </p>
                      )}

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: isMobile
                            ? "1fr"
                            : `repeat(${Math.max(axes.length, 1) + 2}, minmax(0, 1fr))`,
                          gap: 10,
                        }}
                      >
                        {axes.map((axis) => (
                          <label key={`draft-${axis}`} style={labelSt}>
                            {formatAxisLabel(axis)}
                            <input
                              value={draftAttrs[axis] ?? ""}
                              onChange={(e) => { setDraftError(""); setDraftAttrs((prev) => ({ ...prev, [axis]: e.target.value })); }}
                              placeholder={
                                normalizeAxisKey(axis) === "color" ? "Ej. Negro"
                                : normalizeAxisKey(axis) === "talle" ? "Ej. M / 40"
                                : normalizeAxisKey(axis) === "marca" ? "Ej. Nike"
                                : `${formatAxisLabel(axis)}…`
                              }
                              className="ws-input"
                            />
                            <FashionAxisQuickPicks axis={axis} axes={axes} currentValue={draftAttrs[axis] ?? ""} onSelect={(v) => { setDraftError(""); setDraftAttrs((prev) => ({ ...prev, [axis]: v })); }} businessCategory={businessCategory} />
                          </label>
                        ))}
                        <label style={labelSt}>
                          Stock
                          <input type="number" min={0} inputMode="numeric" value={draftStock} onChange={(e) => setDraftStock(e.target.value.trim() === "" ? "" : Number(e.target.value))} placeholder="0" className="ws-input" />
                        </label>
                        <label style={labelSt}>
                          Precio (ARS)
                          <input type="number" min={0} step="0.01" inputMode="decimal" value={draftPrice} onChange={(e) => setDraftPrice(e.target.value.trim() === "" ? "" : Number(e.target.value))} placeholder="Base" className="ws-input" />
                        </label>
                      </div>

                      <details
                        style={{
                          borderRadius: 12,
                          border: "1px dashed color-mix(in srgb, var(--color-primary) 30%, var(--color-border))",
                          background: "color-mix(in srgb, var(--color-bg) 90%, transparent)",
                          padding: "10px 12px",
                        }}
                      >
                        <summary
                          style={{
                            cursor: "pointer",
                            fontWeight: 800,
                            color: "var(--color-muted)",
                            listStyle: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                          }}
                        >
                          <span>+ fotos y categorías de esta variante</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-muted)" }}>
                            {draftImageUrls.length} foto{draftImageUrls.length !== 1 ? "s" : ""} ·{" "}
                            {draftVariantCategoryIds.length} cat.
                          </span>
                        </summary>
                        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                          <ImageDropZone
                            onFilesSelected={(files) => void handleDraftVariantImagesUpload(files)}
                            count={draftImageUrls.length}
                            maxCount={MAX_VARIANT_IMAGES}
                            label="Fotos de esta variante"
                            sublabel="Opcional"
                          />
                          {draftImageUrls.length > 0 && (
                            <ImageThumbnailGrid
                              urls={draftImageUrls}
                              thumbHeight={64}
                              onRemove={(idx) => setDraftImageUrls((prev) => prev.filter((_, i) => i !== idx))}
                              onMoveUp={(idx) =>
                                setDraftImageUrls((prev) => {
                                  const next = [...prev];
                                  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                  return next;
                                })
                              }
                            />
                          )}

                          {allCategories.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {filteredCategoryTree.map(({ row: c, depth }) => {
                                const sel = draftVariantCategoryIds.includes(c.id);
                                return (
                                  <button
                                    key={`draft-cat-${c.id}`}
                                    type="button"
                                    onClick={() => toggleDraftVariantCategory(c.id)}
                                    style={{
                                      padding: depth === 0 ? "4px 11px" : "3px 9px",
                                      borderRadius: 999,
                                      border: sel
                                        ? "1.5px solid var(--color-primary)"
                                        : "1.5px solid var(--color-border)",
                                      background: sel ? "var(--color-primary)" : "var(--color-surface)",
                                      color: sel ? "#fff" : "var(--color-muted)",
                                      fontSize: 11,
                                      fontWeight: sel ? 700 : 500,
                                      cursor: "pointer",
                                    }}
                                    title={c.name}
                                  >
                                    {c.name}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </details>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--color-muted)" }}>
                          SKU: {draftSkuPreview}
                        </span>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={appendDraftVariant}
                            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--color-primary)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                          >
                            <Plus size={13} aria-hidden /> Agregar
                          </button>
                          <button
                            type="button"
                            onClick={cancelDraft}
                            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDraftOpen(true)}
                      style={{
                        width: "100%",
                        padding: "11px 16px",
                        border: "none",
                        borderTop: lines.length > 0 ? "1px dashed color-mix(in srgb, var(--color-border) 80%, transparent)" : undefined,
                        background: "transparent",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--color-muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        transition: "color 0.15s, background 0.15s",
                      }}
                      onMouseEnter={(e) => { const b = e.currentTarget; b.style.color = "var(--color-primary)"; b.style.background = "var(--color-primary-ultra-light)"; }}
                      onMouseLeave={(e) => { const b = e.currentTarget; b.style.color = "var(--color-muted)"; b.style.background = "transparent"; }}
                    >
                      <Plus size={14} aria-hidden /> Agregar variante
                    </button>
                  )}
                </div>
              </FormSection>
            </div>

            {/* ── Right aside: resumen sticky (desktop) ── */}
            {!isMobile && (
              <aside style={{ position: "sticky", top: 16, borderRadius: 14, border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)", overflow: "hidden", boxShadow: "var(--shadow-md)" }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-muted)", marginBottom: 8 }}>Resumen</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: productName ? "var(--color-text)" : "var(--color-muted)", lineHeight: 1.25, marginBottom: 4 }}>
                    {productName || "Sin nombre"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                    {lines.length} variante{lines.length !== 1 ? "s" : ""} · {totalStock} u.
                  </div>
                </div>

                <div style={{ padding: "12px 16px", display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Precio base</span>
                    <strong style={{ fontSize: 13, color: "var(--color-text)" }}>
                      {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0)}
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Fotos</span>
                    <strong style={{ fontSize: 13, color: "var(--color-text)" }}>{productImageUrls.length}</strong>
                  </div>
                  {selectedCategoryNames.length > 0 ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 13, color: "var(--color-muted)" }}>Categorías</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {selectedCategoryNames.slice(0, 5).map((c) => (
                          <span key={c} style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 999, background: "var(--color-primary-ultra-light)", color: "var(--color-primary)" }}>{c}</span>
                        ))}
                        {selectedCategoryNames.length > 5 && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>+{selectedCategoryNames.length - 5} más</span>}
                      </div>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Sin categorías</span>
                  )}
                </div>

                <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border)", display: "grid", gap: 8 }}>
                  <SaveBtn fullWidth />
                  <button type="button" onClick={onClose} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--color-border)", backgroundColor: "transparent", color: "var(--color-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Cancelar
                  </button>
                </div>
              </aside>
            )}
          </div>

          {/* Resumen compacto mobile */}
          {isMobile && (
            <div style={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: productName ? "var(--color-text)" : "var(--color-muted)" }}>{productName || "Sin nombre"}</div>
                <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>
                  {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0)}{" "}
                  · {lines.length} variante{lines.length !== 1 ? "s" : ""} · {totalStock} u.
                </div>
              </div>
              {selectedCategoryNames.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {selectedCategoryNames.slice(0, 3).map((c) => (
                    <span key={c} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "var(--color-primary-ultra-light)", color: "var(--color-primary)", fontWeight: 600 }}>{c}</span>
                  ))}
                  {selectedCategoryNames.length > 3 && <span style={{ fontSize: 11, color: "var(--color-muted)" }}>+{selectedCategoryNames.length - 3}</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer desktop ── */}
        {!isMobile && (
          <div className="ws-modal-footer">
            <button type="button" onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", cursor: "pointer", fontSize: 14, fontWeight: 500, color: "var(--color-text)" }}>
              Cancelar
            </button>
            <SaveBtn />
          </div>
        )}

        {/* ── Barra sticky mobile ── */}
        {isMobile && (
          <div style={{ position: "sticky", bottom: 0, left: 0, right: 0, padding: "10px 16px", background: "var(--color-surface)", borderTop: "1px solid var(--color-border)", display: "grid", gridTemplateColumns: "1fr auto", gap: 8, zIndex: 10, boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
            <SaveBtn fullWidth />
            <button type="button" onClick={onClose} style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-muted)", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              Cancelar
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

/* ── Fila de variante editable ───────────────────────────────────────────── */

function VariantEditCard({
  line,
  idx,
  axes,
  isMobile,
  categoryRows,
  colsDesktop,
  colsMobile,
  onUpdateLine,
  onRemoveLine,
  onError,
}: {
  line: EditLine;
  idx: number;
  axes: string[];
  isMobile: boolean;
  categoryRows: Array<{ row: CategoryOption; depth: number; isLast: boolean }>;
  colsDesktop: string;
  colsMobile: string;
  onUpdateLine: (patch: Partial<EditLine>) => void;
  onRemoveLine: () => void;
  onError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const handleVariantImagesUpload = async (files: File[]) => {
    try {
      const bounded = files.slice(0, Math.max(0, MAX_VARIANT_IMAGES - line.imageUrls.length));
      if (bounded.length === 0) return;
      const tenantId = typeof window !== "undefined" ? (window.localStorage.getItem("ws_tenant_id") ?? "") : "";
      const urls = await uploadImagesToSupabase(bounded, tenantId || undefined);
      if (urls.length > 0) onUpdateLine({ imageUrls: [...line.imageUrls, ...urls] });
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudieron subir las imágenes de la variante");
    }
  };

  const attrPills = Object.entries(line.attributes)
    .filter(([, v]) => String(v ?? "").trim())
    .map(([k, v]) => ({ k, v: String(v).trim() }));

  const accentColor = line.isNew ? "var(--color-growth-strong)" : "var(--color-primary)";
  const rowBg = line.isNew
    ? "color-mix(in srgb, var(--color-growth-soft) 55%, var(--color-bg))"
    : "var(--color-bg)";
  const expandedBg = "var(--color-surface)";

  return (
    <div>
      {/* ── Collapsed row ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? colsMobile : colsDesktop,
          gap: 8,
          alignItems: "center",
          padding: "9px 12px 9px 0",
          borderTop: idx > 0 ? "1px solid var(--color-border)" : undefined,
          background: rowBg,
          boxShadow: `inset 3px 0 0 ${accentColor}`,
          paddingLeft: 12,
          transition: "background 0.15s",
        }}
      >
        {/* Attribute pills */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
          {attrPills.length > 0 ? (
            attrPills.map(({ k, v }) => (
              <span
                key={k}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: line.isNew ? "var(--color-growth-soft)" : "var(--color-primary-ultra-light)",
                  color: line.isNew ? "var(--color-growth-strong)" : "var(--color-primary)",
                  border: line.isNew ? "1px solid color-mix(in srgb, var(--color-growth-strong) 40%, transparent)" : "none",
                  whiteSpace: "nowrap",
                }}
              >
                {v}
              </span>
            ))
          ) : (
            <span style={{ fontSize: 11, color: "var(--color-muted)", fontStyle: "italic" }}>Sin atributos</span>
          )}
          {line.isNew && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 999, background: "var(--color-growth-strong)", color: "#fff", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              New
            </span>
          )}
        </div>

        {/* SKU — desktop */}
        {!isMobile && (
          <span
            style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
            title={line.sku}
          >
            {line.sku}
          </span>
        )}

        {/* Stock — always visible, inline editable */}
        <input
          type="number"
          min={line.reservedStock}
          step={1}
          value={line.stock}
          onChange={(e) => onUpdateLine({ stock: e.target.value.trim() === "" ? "" : Number(e.target.value) })}
          className="ws-input"
          style={{ textAlign: "right", padding: "5px 7px", fontSize: 13, fontWeight: 700, width: "100%" }}
          title={`Depósito — mín. ${line.reservedStock} reservados`}
        />

        {/* Price — desktop, inline editable */}
        {!isMobile && (
          <input
            type="number"
            min={0}
            step="0.01"
            value={line.price}
            onChange={(e) => onUpdateLine({ price: e.target.value.trim() === "" ? "" : Number(e.target.value) })}
            placeholder="Base"
            className="ws-input"
            style={{ textAlign: "right", padding: "5px 7px", fontSize: 12, width: "100%" }}
            title="Precio variante (vacío = precio base)"
          />
        )}

        {/* Active toggle — desktop */}
        {!isMobile && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <ActiveToggle value={line.isActive} onChange={(v) => onUpdateLine({ isActive: v })} />
          </div>
        )}

        {/* Expand / collapse */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ border: "none", background: "transparent", cursor: "pointer", color: expanded ? "var(--color-primary)" : "var(--color-muted)", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6 }}
          title={expanded ? "Colapsar" : "Editar atributos, imágenes y categorías"}
          aria-label={expanded ? "Colapsar variante" : "Expandir variante"}
          aria-expanded={expanded}
        >
          <ChevronDown
            size={15}
            style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 0.2s var(--ease-default)" }}
          />
        </button>

        {/* Remove — solo variantes nuevas */}
        {line.isNew ? (
          <button
            type="button"
            onClick={onRemoveLine}
            style={{ border: "none", background: "transparent", color: "var(--color-error)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6 }}
            title="Quitar esta variante"
            aria-label="Quitar variante"
          >
            <X size={13} />
          </button>
        ) : (
          <div aria-hidden />
        )}
      </div>

      {/* ── Panel expandido ── */}
      {expanded && (
        <div
          style={{
            padding: "12px 14px",
            background: expandedBg,
            borderTop: "1px solid var(--color-border)",
            display: "grid",
            gap: 12,
            boxShadow: `inset 3px 0 0 ${accentColor}`,
          }}
        >
          {/* Axis fields + SKU en una sola fila compacta */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : `repeat(${Math.max(axes.length, 1) + 1}, minmax(0, 1fr))`,
              gap: 10,
              alignItems: "end",
            }}
          >
            {axes.map((axis) => (
              <label key={`${line.clientKey}-${axis}`} style={{ ...labelSt, fontSize: 12 }}>
                {formatAxisLabel(axis)}
                <input
                  value={line.attributes[axis] ?? ""}
                  onChange={(e) => onUpdateLine({ attributes: { ...line.attributes, [axis]: e.target.value } })}
                  placeholder={
                    normalizeAxisKey(axis) === "color" ? "Ej. Negro"
                    : normalizeAxisKey(axis) === "talle" ? "Ej. M / 40"
                    : normalizeAxisKey(axis) === "marca" ? "Ej. Nike"
                    : ""
                  }
                  className="ws-input"
                  style={{ fontSize: 13 }}
                />
              </label>
            ))}
            <label style={{ ...labelSt, fontSize: 12 }}>
              SKU
              <input required value={line.sku} onChange={(e) => onUpdateLine({ sku: e.target.value })} className="ws-input ws-input-mono" style={{ fontSize: 12 }} />
            </label>
          </div>

          {/* Mobile-only: price + active */}
          {isMobile && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
              <label style={{ ...labelSt, fontSize: 12 }}>
                Precio variante (ARS)
                <input type="number" min={0} step="0.01" value={line.price} onChange={(e) => onUpdateLine({ price: e.target.value.trim() === "" ? "" : Number(e.target.value) })} placeholder="Vacío = precio base" className="ws-input" />
              </label>
              <label style={{ ...labelSt, gap: 8, fontSize: 12 }}>
                <span style={{ color: "var(--color-muted)" }}>Activa</span>
                <ActiveToggle value={line.isActive} onChange={(v) => onUpdateLine({ isActive: v })} />
              </label>
            </div>
          )}

          {/* Categorías + Fotos como secciones colapsables sutiles */}
          <div style={{ display: "grid", gap: 6, borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
            {categoryRows.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--color-muted)", listStyle: "none", display: "inline-flex", alignItems: "center", gap: 5, userSelect: "none", letterSpacing: "0.03em" }}>
                  <span>Categorías específicas</span>
                  {line.variantCategoryIds.length > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "var(--color-primary)", color: "#fff" }}>
                      {line.variantCategoryIds.length}
                    </span>
                  )}
                </summary>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                  {categoryRows.map(({ row: c, depth }) => {
                    const sel = line.variantCategoryIds.includes(c.id);
                    return (
                      <button
                        key={`${line.clientKey}-vc-${c.id}`}
                        type="button"
                        onClick={() => {
                          const set = new Set(line.variantCategoryIds);
                          if (set.has(c.id)) set.delete(c.id); else set.add(c.id);
                          onUpdateLine({ variantCategoryIds: [...set] });
                        }}
                        style={{
                          padding: depth === 0 ? "3px 10px" : "2px 8px",
                          borderRadius: 999,
                          border: sel ? "1.5px solid var(--color-primary)" : "1.5px solid var(--color-border)",
                          background: sel ? "var(--color-primary)" : "var(--color-surface)",
                          color: sel ? "#fff" : depth > 0 ? "var(--color-muted)" : "var(--color-text)",
                          fontSize: depth === 0 ? 12 : 11,
                          fontWeight: sel ? 700 : depth === 0 ? 600 : 400,
                          cursor: "pointer",
                          transition: "all 0.12s",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        {depth > 0 && <span style={{ fontSize: 9, opacity: 0.4 }}>{"·".repeat(depth)}</span>}
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </details>
            )}

            <details>
              <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--color-muted)", listStyle: "none", display: "inline-flex", alignItems: "center", gap: 5, userSelect: "none", letterSpacing: "0.03em" }}>
                <span>Fotos de esta variante</span>
                {line.imageUrls.length > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "var(--color-border)", color: "var(--color-text)" }}>
                    {line.imageUrls.length}
                  </span>
                )}
              </summary>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                <ImageDropZone onFilesSelected={(files) => void handleVariantImagesUpload(files)} count={line.imageUrls.length} maxCount={MAX_VARIANT_IMAGES} label="Fotos de esta variante" sublabel="Opcional · máx. 6" />
                {line.imageUrls.length > 0 && (
                  <ImageThumbnailGrid
                    urls={line.imageUrls}
                    thumbHeight={64}
                    onRemove={(imgIdx) => { const next = [...line.imageUrls]; next.splice(imgIdx, 1); onUpdateLine({ imageUrls: next }); }}
                    onMoveUp={(imgIdx) => { const next = [...line.imageUrls]; [next[imgIdx - 1], next[imgIdx]] = [next[imgIdx], next[imgIdx - 1]]; onUpdateLine({ imageUrls: next }); }}
                  />
                )}
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
