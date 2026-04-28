"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type StockView = "all" | "out" | "low" | "reserved";

function displayAxisValue(row: StockProductVariantRow, axis: string): string {
  const raw = row.attributes?.[axis];
  if (raw != null && String(raw).trim()) return String(raw).trim();
  const k = axis.toLowerCase();
  if (k === "talle" || k === "talla") return row.variantTalle?.trim() || "—";
  if (k === "color") return row.variantColor?.trim() || "—";
  if (k === "marca" || k === "modelo") return row.variantMarca?.trim() || "—";
  return "—";
}

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
  const [isMobile, setIsMobile] = useState(false);
  const [editRows, setEditRows] = useState<StockProductVariantRow[] | null>(
    null,
  );
  const [publicCatalogSlug, setPublicCatalogSlug] = useState<string | null>(
    null,
  );
  const [catalogShareUrl, setCatalogShareUrl] = useState<string | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterTalle, setFilterTalle] = useState("");
  const [filterColor, setFilterColor] = useState("");
  const [filterMarca, setFilterMarca] = useState("");
  const [facetTalles, setFacetTalles] = useState<string[]>([]);
  const [facetColors, setFacetColors] = useState<string[]>([]);
  const [facetMarcas, setFacetMarcas] = useState<string[]>([]);
  const [categoryFilterList, setCategoryFilterList] = useState<
    CategoryFilterRow[]
  >([]);
  const [businessCategory, setBusinessCategory] = useState<string>("general");
  const [adjustingIds, setAdjustingIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<StockView>("all");
  const [setStockVariantId, setSetStockVariantId] = useState<string | null>(
    null,
  );
  const [setStockDraft, setSetStockDraft] = useState<string>("");
  const searchDebounceRef = useRef<number | null>(null);
  const syncingUrlRef = useRef(false);

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

  const lowStockThreshold = 3;

  const displayedRows = useMemo(() => {
    if (view === "all") return rows;
    if (view === "out")
      return rows.filter((r) => Number(r.availableStock ?? 0) <= 0);
    if (view === "reserved")
      return rows.filter((r) => Number(r.reservedStock ?? 0) > 0);
    return rows.filter((r) => {
      const avail = Number(r.availableStock ?? 0);
      return avail > 0 && avail < lowStockThreshold;
    });
  }, [rows, view]);

  const load = async (snapshot?: {
    categoryId: string;
    q: string;
    talle: string;
    color: string;
    marca: string;
  }) => {
    const auth = authContext();
    if (!auth) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    try {
      const categoryId = (snapshot?.categoryId ?? filterCategoryId).trim();
      const q = (snapshot?.q ?? filterSearch).trim();
      const talle = (snapshot?.talle ?? filterTalle).trim();
      const color = (snapshot?.color ?? filterColor).trim();
      const marca = (snapshot?.marca ?? filterMarca).trim();
      const params = new URLSearchParams();
      if (categoryId) params.set("categoryId", categoryId);
      if (q) params.set("q", q);
      if (talle) params.set("talle", talle);
      if (color) params.set("color", color);
      if (marca) params.set("marca", marca);
      const qs = params.toString();
      const facetQs = categoryId
        ? `?categoryId=${encodeURIComponent(categoryId)}`
        : "";

      const [productsRes, knowledgeRes, facetRes] = await Promise.all([
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
        fetch(`${getClientApiBase()}/products/facet-options${facetQs}`, {
          headers: {
            Authorization: `Bearer ${auth.token}`,
            "x-tenant-id": auth.tenantId,
          },
          cache: "no-store",
        }),
      ]);
      if (!productsRes.ok) throw new Error(await productsRes.text());
      if (!knowledgeRes.ok) throw new Error(await knowledgeRes.text());
      if (facetRes.ok) {
        const facetJson = (await facetRes.json()) as {
          talles?: string[];
          colors?: string[];
          marcas?: string[];
        };
        setFacetTalles(Array.isArray(facetJson.talles) ? facetJson.talles : []);
        setFacetColors(Array.isArray(facetJson.colors) ? facetJson.colors : []);
        setFacetMarcas(Array.isArray(facetJson.marcas) ? facetJson.marcas : []);
      } else {
        setFacetTalles([]);
        setFacetColors([]);
        setFacetMarcas([]);
      }
      setRows((await productsRes.json()) as VariantRow[]);
      const knowledge = (await knowledgeRes.json()) as {
        knowledge?: {
          productVariantAxes?: string[];
          businessCategory?: string;
        };
        publicCatalogSlug?: string | null;
      };
      const loadedAxes = Array.isArray(knowledge?.knowledge?.productVariantAxes)
        ? knowledge.knowledge.productVariantAxes
            .map((item) => String(item ?? "").trim())
            .filter(Boolean)
        : [];
      setAxes(loadedAxes.length > 0 ? loadedAxes : ["talle", "color"]);
      const cat = String(knowledge?.knowledge?.businessCategory ?? "").trim();
      setBusinessCategory(cat || "general");
      const slug =
        typeof knowledge.publicCatalogSlug === "string" &&
        knowledge.publicCatalogSlug.trim()
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

  const syncUrlFromState = (next?: {
    categoryId?: string;
    q?: string;
    talle?: string;
    color?: string;
    marca?: string;
    view?: StockView;
  }) => {
    if (typeof window === "undefined") return;
    if (syncingUrlRef.current) return;
    const params = new URLSearchParams(window.location.search);

    const categoryId = (next?.categoryId ?? filterCategoryId).trim();
    const q = (next?.q ?? filterSearch).trim();
    const talle = (next?.talle ?? filterTalle).trim();
    const color = (next?.color ?? filterColor).trim();
    const marca = (next?.marca ?? filterMarca).trim();
    const v = (next?.view ?? view).trim();

    const setOrDelete = (k: string, value: string) => {
      if (value) params.set(k, value);
      else params.delete(k);
    };

    setOrDelete("categoryId", categoryId);
    setOrDelete("q", q);
    setOrDelete("talle", talle);
    setOrDelete("color", color);
    setOrDelete("marca", marca);
    setOrDelete("view", v === "all" ? "" : v);

    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", url);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    syncingUrlRef.current = true;
    try {
      const params = new URLSearchParams(window.location.search);
      const categoryId = String(params.get("categoryId") ?? "").trim();
      const q = String(params.get("q") ?? "").trim();
      const talle = String(params.get("talle") ?? "").trim();
      const color = String(params.get("color") ?? "").trim();
      const marca = String(params.get("marca") ?? "").trim();
      const v = String(params.get("view") ?? "").trim() as StockView;

      if (categoryId) setFilterCategoryId(categoryId);
      if (q) setFilterSearch(q);
      if (talle) setFilterTalle(talle);
      if (color) setFilterColor(color);
      if (marca) setFilterMarca(marca);
      if (v === "out" || v === "low" || v === "reserved") setView(v);
    } finally {
      window.setTimeout(() => {
        syncingUrlRef.current = false;
      }, 0);
    }
  }, []);

  useEffect(() => {
    void load();
  }, []);

  // Auto-aplicar: selects inmediato; texto con debounce
  useEffect(() => {
    syncUrlFromState();
    void load({
      categoryId: filterCategoryId,
      q: filterSearch,
      talle: filterTalle,
      color: filterColor,
      marca: filterMarca,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategoryId, filterTalle, filterColor, filterMarca, view]);

  useEffect(() => {
    syncUrlFromState();
    if (searchDebounceRef.current)
      window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      void load({
        categoryId: filterCategoryId,
        q: filterSearch,
        talle: filterTalle,
        color: filterColor,
        marca: filterMarca,
      });
    }, 400);
    return () => {
      if (searchDebounceRef.current)
        window.clearTimeout(searchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSearch]);

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
      if (res.ok)
        setCategoryFilterList((await res.json()) as CategoryFilterRow[]);
    })();
  }, []);

  const adjust = async (variantId: string, stockDelta: number) => {
    const auth = authContext();
    if (!auth) return;
    if (adjustingIds.has(variantId)) return;

    const original = rows.find((r) => r.variantId === variantId);
    if (!original) return;

    // Actualización optimista: solo la fila tocada
    setAdjustingIds((prev) => new Set(prev).add(variantId));
    setRows((prev) =>
      prev.map((r) => {
        if (r.variantId !== variantId) return r;
        const newStock = Math.max(0, r.stock + stockDelta);
        const newAvailable = Math.max(0, r.availableStock + stockDelta);
        return { ...r, stock: newStock, availableStock: newAvailable };
      }),
    );

    try {
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
        // Revertir si falla
        setRows((prev) =>
          prev.map((r) => (r.variantId === variantId ? original : r)),
        );
        // eslint-disable-next-line no-alert
        alert(await response.text());
      }
    } catch {
      setRows((prev) =>
        prev.map((r) => (r.variantId === variantId ? original : r)),
      );
    } finally {
      setAdjustingIds((prev) => {
        const next = new Set(prev);
        next.delete(variantId);
        return next;
      });
    }
  };

  const hasActiveFilters =
    !!filterCategoryId ||
    !!filterSearch ||
    !!filterTalle ||
    !!filterColor ||
    !!filterMarca;

  const activeFilterCount =
    (filterCategoryId ? 1 : 0) +
    (filterSearch ? 1 : 0) +
    (filterTalle ? 1 : 0) +
    (filterColor ? 1 : 0) +
    (filterMarca ? 1 : 0);

  const activeFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filterCategoryId) {
      const cat = categoryFilterList.find(
        (c) => c.id === filterCategoryId,
      )?.name;
      parts.push(`Categoría: ${cat ?? "—"}`);
    }
    if (filterTalle) parts.push(`Talle: ${filterTalle}`);
    if (filterColor) parts.push(`Color: ${filterColor}`);
    if (filterMarca) parts.push(`Marca: ${filterMarca}`);
    if (view !== "all") {
      const v =
        view === "out"
          ? "Sin stock"
          : view === "low"
            ? `Bajo stock (<${lowStockThreshold})`
            : "Con reservas";
      parts.push(`Vista: ${v}`);
    }
    return parts.join(" · ");
  }, [
    filterCategoryId,
    filterTalle,
    filterColor,
    filterMarca,
    view,
    categoryFilterList,
    lowStockThreshold,
  ]);

  const selectStyle: React.CSSProperties = {
    padding: "9px 10px",
    borderRadius: 8,
    border: "1.5px solid var(--color-border)",
    fontSize: 13,
    background: "var(--color-bg)",
    color: "var(--color-text)",
    outline: "none",
    fontFamily: "inherit",
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
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
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
                fontSize: 18,
              }}
            >
              📦
            </div>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: isMobile ? 20 : 22,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: "var(--color-text)",
                  lineHeight: 1.2,
                }}
              >
                Inventario
              </h1>
              <a
                href="/stock/categories"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--color-primary)",
                  textDecoration: "none",
                }}
              >
                Categorías →
              </a>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() =>
                void load({
                  categoryId: filterCategoryId,
                  q: filterSearch,
                  talle: filterTalle,
                  color: filterColor,
                  marca: filterMarca,
                })
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                whiteSpace: "nowrap",
              }}
              title="Forzar recarga"
            >
              {loading ? "Actualizando…" : "Actualizar"}
            </button>

            <button
              type="button"
              onClick={() => setShowModal(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                backgroundColor: "var(--color-primary)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: isMobile ? "10px 16px" : "10px 18px",
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
              Nuevo producto
            </button>
          </div>
        </div>

        {/* ── Filtros ── */}
        {/* Buscador siempre visible; selects + vistas dentro de Filtros (colapsado) */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-text)",
              flex: "1 1 320px",
              minWidth: 240,
            }}
          >
            Buscar producto
            <input
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Nombre, SKU o etiqueta…"
              className="ws-input"
              style={{ fontSize: 13 }}
            />
          </label>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={() => {
                setFilterCategoryId("");
                setFilterSearch("");
                setFilterTalle("");
                setFilterColor("");
                setFilterMarca("");
                setView("all");
                syncUrlFromState({
                  categoryId: "",
                  q: "",
                  talle: "",
                  color: "",
                  marca: "",
                  view: "all",
                });
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                background: "transparent",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
                color: "var(--color-muted)",
                whiteSpace: "nowrap",
              }}
              title="Limpiar filtros"
            >
              Limpiar
            </button>
          ) : null}
        </div>

        <details
          open={false}
          style={{
            marginBottom: 16,
            borderRadius: 12,
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface)",
          }}
        >
          <summary
            style={{
              listStyle: "none",
              cursor: "pointer",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              userSelect: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 900,
                  color: "var(--color-text)",
                }}
              >
                Filtros
              </span>
              {activeFilterCount > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--color-primary-ultra-light)",
                    color: "var(--color-primary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {activeFilterCount} activo{activeFilterCount !== 1 ? "s" : ""}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                  Sin filtros
                </span>
              )}
              {activeFilterCount > 0 && (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--color-muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: isMobile ? 180 : 460,
                  }}
                  title={activeFilterSummary}
                >
                  {activeFilterSummary}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div
                style={{
                  display: "inline-flex",
                  gap: 6,
                  padding: 4,
                  borderRadius: 12,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg)",
                  flexWrap: "wrap",
                }}
                role="tablist"
                aria-label="Vista de stock"
                onClick={(e) => e.preventDefault()}
              >
                {(
                  [
                    { id: "all", label: "Todo" },
                    { id: "out", label: "Sin stock" },
                    { id: "low", label: `Bajo stock` },
                    { id: "reserved", label: "Con reservas" },
                  ] as Array<{ id: StockView; label: string }>
                ).map((opt) => {
                  const active = view === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={(e) => {
                        e.preventDefault();
                        setView(opt.id);
                        syncUrlFromState({ view: opt.id });
                      }}
                      style={{
                        padding: "7px 10px",
                        borderRadius: 10,
                        border: "none",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 800,
                        background: active
                          ? "var(--color-primary)"
                          : "transparent",
                        color: active ? "#fff" : "var(--color-text)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <span style={{ color: "var(--color-muted)", fontSize: 12 }}>
                {isMobile ? "Tocar para abrir" : "Abrir filtros"}
              </span>
            </div>
          </summary>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "flex-end",
              padding: "0 16px 14px 16px",
            }}
          >
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-text)",
              }}
            >
              Categoría
              <select
                value={filterCategoryId}
                onChange={(e) => setFilterCategoryId(e.target.value)}
                style={{ ...selectStyle, minWidth: 180 }}
              >
                <option value="">Todas</option>
                {[...categoryFilterList]
                  .sort(
                    (a, b) =>
                      a.sortOrder - b.sortOrder ||
                      a.name.localeCompare(b.name, "es"),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>

            {facetTalles.length > 0 && (
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}
              >
                Talle
                <select
                  value={filterTalle}
                  onChange={(e) => setFilterTalle(e.target.value)}
                  style={{ ...selectStyle, minWidth: 100 }}
                >
                  <option value="">Todos</option>
                  {facetTalles.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  {filterTalle && !facetTalles.includes(filterTalle) && (
                    <option value={filterTalle}>{filterTalle}</option>
                  )}
                </select>
              </label>
            )}

            {facetColors.length > 0 && (
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}
              >
                Color
                <select
                  value={filterColor}
                  onChange={(e) => setFilterColor(e.target.value)}
                  style={{ ...selectStyle, minWidth: 100 }}
                >
                  <option value="">Todos</option>
                  {facetColors.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {filterColor && !facetColors.includes(filterColor) && (
                    <option value={filterColor}>{filterColor}</option>
                  )}
                </select>
              </label>
            )}

            {facetMarcas.length > 0 && (
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}
              >
                Marca / modelo
                <select
                  value={filterMarca}
                  onChange={(e) => setFilterMarca(e.target.value)}
                  style={{ ...selectStyle, minWidth: 120 }}
                >
                  <option value="">Todos</option>
                  {facetMarcas.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {filterMarca && !facetMarcas.includes(filterMarca) && (
                    <option value={filterMarca}>{filterMarca}</option>
                  )}
                </select>
              </label>
            )}
          </div>
        </details>

        <StockTableMobileHint />

        {error ? (
          <div
            role="alert"
            style={{
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--color-error)",
              background: "var(--color-error-bg)",
              border:
                "1px solid color-mix(in srgb, var(--color-error) 30%, transparent)",
            }}
          >
            {error}
          </div>
        ) : null}

        {/* ── Tabla ── */}
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: "var(--color-surface)",
            display: "flex",
            flexDirection: "column",
            minHeight: isMobile ? 520 : 640,
          }}
          aria-busy={loading}
        >
          {/* Caption / resumen */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              background: "var(--color-surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {loading && <Spinner size="sm" label="Cargando" />}

              {!loading && rows.length > 0 && <></>}
            </div>
          </div>

          <div
            style={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              overscrollBehaviorX: "contain",
              flex: 1,
            }}
          >
            <table
              aria-label="Inventario por variante"
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: "1px",
                backgroundColor: "var(--color-border)",
                tableLayout: "fixed",
                minWidth: 640 + axes.length * 88,
              }}
            >
              {/* Anchos fijos de columna */}
              <colgroup>
                <col style={{ width: 52 }} /> {/* Foto */}
                <col /> {/* Producto (expande para ocupar ancho disponible) */}
                {axes.map((a) => (
                  <col key={a} style={{ width: 88 }} />
                ))}
                <col style={{ width: 100 }} /> {/* Precio */}
                <col style={{ width: 130 }} /> {/* Stock */}
                <col style={{ width: 80 }} /> {/* +/- */}
                <col style={{ width: 82 }} /> {/* Estado */}
                <col style={{ width: 68 }} /> {/* Editar */}
              </colgroup>

              <thead>
                <tr>
                  <StockTableTh title="Foto" hint="">
                    Foto
                  </StockTableTh>
                  <StockTableTh
                    title="Nombre, categoría y código interno"
                    hint=""
                  >
                    Producto
                  </StockTableTh>
                  {axes.map((axis) => (
                    <StockTableTh
                      key={axis}
                      title={`Variante: ${formatAxisLabel(axis)}`}
                      hint=""
                    >
                      {formatAxisLabel(axis)}
                    </StockTableTh>
                  ))}
                  <StockTableTh title="Precio de venta" hint="">
                    Precio
                  </StockTableTh>
                  <StockTableTh
                    title="Stock disponible para vender (y total en depósito)"
                    hint=""
                  >
                    Stock
                  </StockTableTh>
                  <StockTableTh
                    title="Sumar o restar una unidad al depósito"
                    hint=""
                  >
                    Ajuste
                  </StockTableTh>
                  <StockTableTh title="Estado en el catálogo" hint="">
                    Estado
                  </StockTableTh>
                  <StockTableTh title="Editar el producto completo" hint="">
                    {" "}
                  </StockTableTh>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <StockTableSkeleton rows={14} axisCount={axes.length} baseCols={7} />
                ) : displayedRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6 + axes.length}
                      style={{
                        padding: "48px 20px",
                        textAlign: "center",
                        ...stockGridCellBg(false),
                      }}
                    >
                      <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 15,
                          fontWeight: 800,
                          color: "var(--color-text)",
                        }}
                      >
                        {rows.length === 0
                          ? "Todavía no cargaste productos"
                          : "No hay resultados con estos filtros / vista"}
                      </p>
                      <p
                        style={{
                          margin: "6px auto 18px",
                          fontSize: 13,
                          color: "var(--color-muted)",
                          maxWidth: 320,
                          lineHeight: 1.5,
                        }}
                      >
                        {rows.length === 0
                          ? "Tocá «Nuevo producto» para empezar."
                          : "Probá limpiar filtros o cambiar la vista (Todo / Sin stock / Bajo stock / Con reservas)."}
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowModal(true)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "10px 20px",
                          borderRadius: 10,
                          border: "none",
                          background: "var(--color-primary)",
                          color: "#fff",
                          fontSize: 14,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        + Nuevo producto
                      </button>
                    </td>
                  </tr>
                ) : (
                  displayedRows.map((row) => {
                    const hi = false;
                    const available = Number(row.availableStock ?? 0);
                    const reserved = Number(row.reservedStock ?? 0);
                    const isAdjusting = adjustingIds.has(row.variantId);
                    const isLow =
                      available > 0 && available < lowStockThreshold;
                    const isOut = available <= 0;

                    return (
                      <tr
                        key={row.variantId}
                        style={{
                          opacity: isAdjusting ? 0.7 : 1,
                          transition: "opacity 0.15s",
                        }}
                      >
                        {/* Foto */}
                        <StockGridTd
                          emphasize={hi}
                          narrow
                          style={{ width: 52 }}
                        >
                          <StockProductThumb
                            imageUrl={row.imageUrl}
                            name={row.name}
                          />
                        </StockGridTd>

                        {/* Producto: nombre + chips + SKU (sin hover) */}
                        <StockGridTd
                          emphasize={hi}
                          style={{ padding: "8px 12px" }}
                        >
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 13,
                              color: "var(--color-text)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={row.name}
                          >
                            {row.name}
                          </div>
                          {Array.isArray(row.categoryNames) &&
                            row.categoryNames.length > 0 && (
                              <div
                                style={{
                                  display: "flex",
                                  gap: 3,
                                  marginTop: 3,
                                  flexWrap: "nowrap",
                                  overflow: "hidden",
                                }}
                              >
                                {row.categoryNames.slice(0, 1).map((cat) => (
                                  <span
                                    key={cat}
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      padding: "1px 6px",
                                      borderRadius: 999,
                                      background:
                                        "var(--color-primary-ultra-light)",
                                      color: "var(--color-primary)",
                                      whiteSpace: "nowrap",
                                      flexShrink: 0,
                                    }}
                                    title={cat}
                                  >
                                    {cat}
                                  </span>
                                ))}
                                {row.categoryNames.length > 1 && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "var(--color-muted)",
                                      flexShrink: 0,
                                    }}
                                    title={row.categoryNames.join(" · ")}
                                  >
                                    +{row.categoryNames.length - 1}
                                  </span>
                                )}
                              </div>
                            )}
                          <div
                            style={{
                              marginTop: 4,
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                color: "var(--color-muted)",
                                fontFamily: "ui-monospace, monospace",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                minWidth: 0,
                              }}
                              title={row.sku}
                            >
                              {row.sku}
                            </span>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard.writeText(row.sku)}
                              style={{
                                padding: "3px 6px",
                                borderRadius: 8,
                                border: "1px solid var(--color-border)",
                                background: "transparent",
                                color: "var(--color-muted)",
                                fontWeight: 800,
                                fontSize: 10,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                              }}
                              title="Copiar SKU"
                            >
                              Copiar
                            </button>
                          </div>
                        </StockGridTd>

                        {/* Ejes — truncados */}
                        {axes.map((axis) => (
                          <StockGridTd
                            key={`${row.variantId}-${axis}`}
                            emphasize={hi}
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 88,
                            }}
                            title={displayAxisValue(row, axis)}
                          >
                            {displayAxisValue(row, axis)}
                          </StockGridTd>
                        ))}

                        {/* Precio */}
                        <StockGridTd
                          emphasize={hi}
                          style={{
                            fontWeight: 700,
                            fontSize: 13,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          }).format(Number(row.effectivePrice))}
                        </StockGridTd>

                        {/* Stock combinado: disponible + depósito + reservado + set */}
                        <StockGridTd
                          emphasize={hi}
                          style={{ padding: "8px 12px" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              {/* Disponible como badge principal */}
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontSize: 14,
                                    fontWeight: 800,
                                    color:
                                      available > 0
                                        ? "var(--color-success)"
                                        : "var(--color-error)",
                                    background:
                                      available > 0
                                        ? "var(--color-success-bg)"
                                        : "var(--color-error-bg)",
                                    padding: "2px 9px",
                                    borderRadius: 999,
                                    lineHeight: 1.5,
                                  }}
                                >
                                  {available}
                                </span>

                                {isOut ? (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 800,
                                      padding: "1px 6px",
                                      borderRadius: 999,
                                      background: "var(--color-error-bg)",
                                      color: "var(--color-error)",
                                    }}
                                  >
                                    Sin stock
                                  </span>
                                ) : isLow ? (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 800,
                                      padding: "1px 6px",
                                      borderRadius: 999,
                                      background:
                                        "color-mix(in srgb, var(--color-warning) 18%, transparent)",
                                      color: "var(--color-warning)",
                                    }}
                                  >
                                    Bajo stock
                                  </span>
                                ) : null}

                                {reserved > 0 ? (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 800,
                                      padding: "1px 6px",
                                      borderRadius: 999,
                                      background:
                                        "color-mix(in srgb, var(--color-primary) 14%, transparent)",
                                      color: "var(--color-primary)",
                                    }}
                                  >
                                    {reserved} reserv.
                                  </span>
                                ) : null}
                              </div>

                              {/* De X en depósito */}
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "var(--color-muted)",
                                  marginTop: 3,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                de {row.stock} en depósito
                              </div>
                            </div>

                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                flexShrink: 0,
                              }}
                            >
                              {setStockVariantId === row.variantId ? (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <input
                                    value={setStockDraft}
                                    onChange={(e) =>
                                      setSetStockDraft(e.target.value)
                                    }
                                    inputMode="numeric"
                                    placeholder="Dep."
                                    className="ws-input"
                                    style={{
                                      width: 70,
                                      fontSize: 12,
                                      padding: "6px 8px",
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Escape") {
                                        setSetStockVariantId(null);
                                        setSetStockDraft("");
                                      }
                                      if (e.key === "Enter") {
                                        const nextStock = Math.max(
                                          0,
                                          Math.floor(
                                            Number(
                                              String(setStockDraft).replace(
                                                ",",
                                                ".",
                                              ),
                                            ),
                                          ),
                                        );
                                        const delta =
                                          nextStock - Number(row.stock ?? 0);
                                        setSetStockVariantId(null);
                                        setSetStockDraft("");
                                        if (delta !== 0)
                                          void adjust(row.variantId, delta);
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextStock = Math.max(
                                        0,
                                        Math.floor(
                                          Number(
                                            String(setStockDraft).replace(
                                              ",",
                                              ".",
                                            ),
                                          ),
                                        ),
                                      );
                                      const delta =
                                        nextStock - Number(row.stock ?? 0);
                                      setSetStockVariantId(null);
                                      setSetStockDraft("");
                                      if (delta !== 0)
                                        void adjust(row.variantId, delta);
                                    }}
                                    style={{
                                      padding: "6px 8px",
                                      borderRadius: 8,
                                      border: "none",
                                      background: "var(--color-primary)",
                                      color: "#fff",
                                      fontWeight: 800,
                                      fontSize: 12,
                                      cursor: "pointer",
                                    }}
                                    disabled={isAdjusting}
                                    title="Setear stock en depósito"
                                  >
                                    OK
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSetStockVariantId(null);
                                      setSetStockDraft("");
                                    }}
                                    style={{
                                      padding: "6px 8px",
                                      borderRadius: 8,
                                      border: "1px solid var(--color-border)",
                                      background: "transparent",
                                      color: "var(--color-muted)",
                                      fontWeight: 800,
                                      fontSize: 12,
                                      cursor: "pointer",
                                    }}
                                    title="Cancelar"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSetStockVariantId(row.variantId);
                                    setSetStockDraft(String(row.stock ?? ""));
                                  }}
                                  style={{
                                    padding: "6px 8px",
                                    borderRadius: 8,
                                    border: "1px solid var(--color-border)",
                                    background: "transparent",
                                    color: "var(--color-text)",
                                    fontWeight: 800,
                                    fontSize: 12,
                                    cursor: "pointer",
                                  }}
                                  disabled={isAdjusting}
                                  title="Setear stock en depósito"
                                >
                                  Set
                                </button>
                              )}
                            </div>
                          </div>
                        </StockGridTd>

                        {/* Ajuste +/- */}
                        <StockGridTd emphasize={hi} narrow>
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              alignItems: "center",
                            }}
                          >
                            <button
                              type="button"
                              aria-label={`Sumar una unidad — ${row.name}`}
                              onClick={() => void adjust(row.variantId, 1)}
                              disabled={isAdjusting}
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                border: "1.5px solid var(--color-border)",
                                background: isAdjusting
                                  ? "var(--color-bg)"
                                  : "var(--color-success-bg)",
                                cursor: isAdjusting ? "wait" : "pointer",
                                fontWeight: 900,
                                fontSize: 18,
                                lineHeight: 1,
                                touchAction: "manipulation",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "var(--color-success)",
                                transition: "background 0.12s",
                              }}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              aria-label={`Restar una unidad — ${row.name}`}
                              onClick={() => void adjust(row.variantId, -1)}
                              disabled={isAdjusting}
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                border: "1.5px solid var(--color-border)",
                                background: isAdjusting
                                  ? "var(--color-bg)"
                                  : "var(--color-error-bg)",
                                cursor: isAdjusting ? "wait" : "pointer",
                                fontWeight: 900,
                                fontSize: 18,
                                lineHeight: 1,
                                touchAction: "manipulation",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "var(--color-error)",
                                transition: "background 0.12s",
                              }}
                            >
                              −
                            </button>
                          </div>
                        </StockGridTd>

                        {/* Estado */}
                        <StockGridTd emphasize={hi} narrow>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "3px 8px",
                              borderRadius: 999,
                              whiteSpace: "nowrap",
                              ...(row.isActive
                                ? {
                                    color: "var(--color-success)",
                                    background: "var(--color-success-bg)",
                                    border:
                                      "1px solid color-mix(in srgb, var(--color-success) 30%, transparent)",
                                  }
                                : {
                                    color: "var(--color-muted)",
                                    background: "var(--color-disabled-bg)",
                                    border: "1px solid var(--color-border)",
                                  }),
                            }}
                          >
                            {row.isActive ? "Activa" : "Inactiva"}
                          </span>
                        </StockGridTd>

                        {/* Editar */}
                        <StockGridTd emphasize={hi} narrow align="center">
                          {firstVariantIdByProduct.get(row.productId) ===
                          row.variantId ? (
                            <button
                              type="button"
                              aria-label={`Editar ${row.name}`}
                              onClick={() =>
                                setEditRows(
                                  rows.filter(
                                    (r) => r.productId === row.productId,
                                  ),
                                )
                              }
                              style={{
                                padding: "5px 10px",
                                borderRadius: 8,
                                border:
                                  "1.5px solid color-mix(in srgb, var(--color-primary) 40%, var(--color-border))",
                                background: "var(--color-surface)",
                                cursor: "pointer",
                                fontSize: 12,
                                fontWeight: 700,
                                color: "var(--color-primary)",
                                whiteSpace: "nowrap",
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
          businessCategory={businessCategory}
        />

        {editRows != null && editRows.length > 0 ? (
          <StockEditProductModal
            open
            axes={axes}
            isMobile={isMobile}
            rows={editRows}
            onClose={() => setEditRows(null)}
            onSaved={() => void load()}
            businessCategory={businessCategory}
          />
        ) : null}
      </section>
    </main>
  );
}
