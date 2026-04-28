"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  Store, Globe, Palette, Type, Phone, ImageIcon, Star,
  ChevronDown, ChevronRight, Save, ExternalLink, Check,
  AlertCircle, Upload, X, Loader2, Search, LayoutGrid
} from "lucide-react";
import { getClientApiBase } from "@/lib/api-base";
import {
  type StoreConfig,
  DEFAULT_STORE_CONFIG,
  normalizeStoreConfig
} from "@waseller/shared";

type StoreConfigBrand = StoreConfig["brand"];
type StoreConfigHero = StoreConfig["hero"];
type StoreConfigColors = StoreConfig["colors"];
type StoreConfigTypography = StoreConfig["typography"];
type StoreConfigContact = StoreConfig["contact"];
type StoreConfigUiTexts = StoreConfig["uiTexts"];

type ProductSummary = {
  productId: string;
  name: string;
  imageUrl?: string | null;
  minPrice: number;
};

type CategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
};

type Palette = {
  name: string;
  label: string;
  swatches: string[];
  colors: StoreConfigColors;
};

const PALETTES: Palette[] = [
  {
    name: "noir",
    label: "Noir",
    swatches: ["#1a1a1a", "#c9a84c", "#f8f8f8", "#ffffff"],
    colors: { primary: "#1a1a1a", secondary: "#c9a84c", background: "#f8f8f8", surface: "#ffffff", textPrimary: "#1a1a1a", textSecondary: "#666666", border: "#e0e0e0" },
  },
  {
    name: "crema",
    label: "Crema",
    swatches: ["#8b6f47", "#c4956a", "#faf6f0", "#ffffff"],
    colors: { primary: "#8b6f47", secondary: "#c4956a", background: "#faf6f0", surface: "#ffffff", textPrimary: "#2c1810", textSecondary: "#7a6055", border: "#e8ddd4" },
  },
  {
    name: "bosque",
    label: "Bosque",
    swatches: ["#2d5016", "#6b8f3e", "#f4f7f0", "#ffffff"],
    colors: { primary: "#2d5016", secondary: "#6b8f3e", background: "#f4f7f0", surface: "#ffffff", textPrimary: "#1a2e0a", textSecondary: "#5a7040", border: "#d4e0c8" },
  },
  {
    name: "oceano",
    label: "Océano",
    swatches: ["#1d4e6b", "#4a9ebe", "#f0f6fa", "#ffffff"],
    colors: { primary: "#1d4e6b", secondary: "#4a9ebe", background: "#f0f6fa", surface: "#ffffff", textPrimary: "#0d2d40", textSecondary: "#5a8099", border: "#ccdde8" },
  },
  {
    name: "petalo",
    label: "Pétalo",
    swatches: ["#9e5b6b", "#d4849a", "#fdf5f6", "#ffffff"],
    colors: { primary: "#9e5b6b", secondary: "#d4849a", background: "#fdf5f6", surface: "#ffffff", textPrimary: "#3d1a22", textSecondary: "#9e7280", border: "#f0d8de" },
  },
  {
    name: "carbon",
    label: "Carbón",
    swatches: ["#e0b56b", "#c49b4a", "#141414", "#1e1e1e"],
    colors: { primary: "#e0b56b", secondary: "#c49b4a", background: "#141414", surface: "#1e1e1e", textPrimary: "#f0f0f0", textSecondary: "#999999", border: "#2a2a2a" },
  },
  {
    name: "lavanda",
    label: "Lavanda",
    swatches: ["#6b5b8e", "#9b84be", "#f6f4fc", "#ffffff"],
    colors: { primary: "#6b5b8e", secondary: "#9b84be", background: "#f6f4fc", surface: "#ffffff", textPrimary: "#2a1f3d", textSecondary: "#7a6b9a", border: "#ddd6ee" },
  },
  {
    name: "hueso",
    label: "Hueso",
    swatches: ["#3d3530", "#7a6a5a", "#f7f3ee", "#ffffff"],
    colors: { primary: "#3d3530", secondary: "#7a6a5a", background: "#f7f3ee", surface: "#ffffff", textPrimary: "#1a1410", textSecondary: "#7a6a5a", border: "#e4ddd6" },
  },
  {
    name: "terracota",
    label: "Terracota",
    swatches: ["#b85c38", "#e8a87c", "#fdf8f5", "#ffffff"],
    colors: { primary: "#b85c38", secondary: "#e8a87c", background: "#fdf8f5", surface: "#ffffff", textPrimary: "#3d2418", textSecondary: "#8b6a5a", border: "#eddcd3" },
  },
  {
    name: "arrecife",
    label: "Arrecife",
    swatches: ["#0077b6", "#48cae4", "#f0fbff", "#ffffff"],
    colors: { primary: "#0077b6", secondary: "#48cae4", background: "#f0fbff", surface: "#ffffff", textPrimary: "#023e8a", textSecondary: "#5c8dad", border: "#caf0f8" },
  },
  {
    name: "granate",
    label: "Granate",
    swatches: ["#722f37", "#c9a227", "#faf7f2", "#ffffff"],
    colors: { primary: "#722f37", secondary: "#c9a227", background: "#faf7f2", surface: "#ffffff", textPrimary: "#2a1215", textSecondary: "#7a5c60", border: "#e8dfd9" },
  },
  {
    name: "oliva",
    label: "Oliva",
    swatches: ["#606c38", "#bc6c25", "#fefae0", "#ffffff"],
    colors: { primary: "#606c38", secondary: "#bc6c25", background: "#fefae0", surface: "#ffffff", textPrimary: "#283618", textSecondary: "#6b705c", border: "#dde5c4" },
  },
  {
    name: "ciruela",
    label: "Ciruela",
    swatches: ["#3d0c11", "#9e2a2b", "#fff5f5", "#ffffff"],
    colors: { primary: "#3d0c11", secondary: "#9e2a2b", background: "#fff5f5", surface: "#ffffff", textPrimary: "#1a0508", textSecondary: "#8b5a5c", border: "#f0d6d8" },
  },
  {
    name: "hormigon",
    label: "Hormigón",
    swatches: ["#495057", "#adb5bd", "#f8f9fa", "#ffffff"],
    colors: { primary: "#495057", secondary: "#adb5bd", background: "#f8f9fa", surface: "#ffffff", textPrimary: "#212529", textSecondary: "#6c757d", border: "#dee2e6" },
  },
  {
    name: "carmesi",
    label: "Carmesí",
    swatches: ["#9d174d", "#d63384", "#fff0f6", "#ffffff"],
    colors: { primary: "#9d174d", secondary: "#d63384", background: "#fff0f6", surface: "#ffffff", textPrimary: "#3d0a1f", textSecondary: "#a66884", border: "#f3d4e1" },
  },
  {
    name: "musgo",
    label: "Musgo",
    swatches: ["#415d43", "#7d9b76", "#f4faf4", "#ffffff"],
    colors: { primary: "#415d43", secondary: "#7d9b76", background: "#f4faf4", surface: "#ffffff", textPrimary: "#1e2a1f", textSecondary: "#5f7160", border: "#d8e6d9" },
  },
  {
    name: "papaya",
    label: "Papaya",
    swatches: ["#e85d04", "#f48c06", "#fff8f3", "#ffffff"],
    colors: { primary: "#e85d04", secondary: "#f48c06", background: "#fff8f3", surface: "#ffffff", textPrimary: "#3d1f0a", textSecondary: "#9a6b4a", border: "#ffe4d6" },
  },
  {
    name: "cielo",
    label: "Cielo",
    swatches: ["#5c6bc0", "#7e57c2", "#f3f5ff", "#ffffff"],
    colors: { primary: "#5c6bc0", secondary: "#7e57c2", background: "#f3f5ff", surface: "#ffffff", textPrimary: "#1a237e", textSecondary: "#6a6f9e", border: "#d7ddf0" },
  },
  {
    name: "esmeralda",
    label: "Esmeralda",
    swatches: ["#047857", "#34d399", "#ecfdf5", "#ffffff"],
    colors: { primary: "#047857", secondary: "#34d399", background: "#ecfdf5", surface: "#ffffff", textPrimary: "#064e3b", textSecondary: "#4c7c6f", border: "#c5ebe0" },
  },
  {
    name: "caramelo",
    label: "Caramelo",
    swatches: ["#78350f", "#d97706", "#fffbeb", "#ffffff"],
    colors: { primary: "#78350f", secondary: "#d97706", background: "#fffbeb", surface: "#ffffff", textPrimary: "#422006", textSecondary: "#a16207", border: "#fde6c4" },
  },
];

const FONT_OPTIONS = [
  "Inter", "Geist", "Playfair Display", "Cormorant Garamond",
  "Libre Baskerville", "Raleway", "Montserrat", "Lato",
  "Open Sans", "Nunito", "DM Sans", "Plus Jakarta Sans",
];

function authContext(): { token: string; tenantId: string } | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("ws_auth_token") ?? "";
  const tenantId = window.localStorage.getItem("ws_tenant_id") ?? "";
  if (!token || !tenantId) return null;
  return { token, tenantId };
}

type SectionKey = "brand" | "hero" | "colors" | "typography" | "home" | "contact" | "ui" | "featured";

/* ── Image upload hook ─────────────────────────────────────────── */
function useImageUpload(folder: string) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      const ctx = authContext();
      if (!ctx) return null;
      setUploading(true);
      setUploadError("");
      try {
        const form = new FormData();
        form.append("files", file);
        form.append("folder", folder);
        const res = await fetch(`${window.location.origin}/api/uploads/images`, {
          method: "POST",
          headers: { "x-tenant-id": ctx.tenantId },
          body: form,
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { message?: string };
          throw new Error(d.message ?? "Error al subir imagen");
        }
        const data = await res.json() as { urls: string[] };
        return data.urls[0] ?? null;
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Error al subir imagen");
        return null;
      } finally {
        setUploading(false);
      }
    },
    [folder]
  );

  return { upload, uploading, uploadError, clearError: () => setUploadError("") };
}

/* ── ImageField: URL input + upload button ──────────────────────── */
function ImageField({
  label,
  hint,
  value,
  onChange,
  folder = "store-config",
  accept = "image/*",
}: {
  label: string;
  hint?: string;
  value?: string;
  onChange: (url: string) => void;
  folder?: string;
  accept?: string;
}) {
  const { upload, uploading, uploadError, clearError } = useImageUpload(folder);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await upload(file);
    if (url) onChange(url);
    // reset input so same file can be re-selected
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          type="url"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…/imagen.jpg"
          className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          title="Subir desde dispositivo"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-60"
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? "Subiendo…" : "Subir"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleFile}
        />
      </div>
      {value?.trim() && (
        <div className="relative mt-1 h-20 w-32 overflow-hidden rounded-lg border border-[var(--color-border)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.trim()} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <X size={10} />
          </button>
        </div>
      )}
      {hint && !uploadError && <p className="text-xs text-[var(--color-muted)]">{hint}</p>}
      {uploadError && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle size={11} />
          {uploadError}
          <button type="button" onClick={clearError} className="ml-1 underline">Cerrar</button>
        </p>
      )}
    </div>
  );
}

/* ── Generic helpers ────────────────────────────────────────────── */
function SectionHeader({
  icon: Icon, title, subtitle, expanded, onToggle
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string; subtitle: string; expanded: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface)]"
    >
      <Icon size={18} className="shrink-0 text-[var(--color-primary)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
        <p className="text-xs text-[var(--color-muted)]">{subtitle}</p>
      </div>
      {expanded
        ? <ChevronDown size={16} className="shrink-0 text-[var(--color-muted)]" />
        : <ChevronRight size={16} className="shrink-0 text-[var(--color-muted)]" />}
    </button>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{label}</label>
      {children}
      {hint && <p className="text-xs text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30";

const textareaCls = inputCls + " resize-none leading-relaxed";

function paletteMatchesActive(p: Palette, active: StoreConfigColors): boolean {
  const keys: (keyof StoreConfigColors)[] = [
    "primary", "secondary", "background", "surface", "textPrimary", "textSecondary", "border"
  ];
  return keys.every((k) => (p.colors[k] ?? "") === (active[k] ?? ""));
}

function PaletteGrid({
  active,
  onSelect,
}: {
  active: StoreConfigColors;
  onSelect: (colors: StoreConfigColors) => void;
}) {
  const activeKey = PALETTES.find((p) => paletteMatchesActive(p, active))?.name;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Paletas predeterminadas (aplican todos los colores del tema)
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {PALETTES.map((palette) => {
          const isActive = activeKey === palette.name;
          return (
            <button
              key={palette.name}
              type="button"
              onClick={() => onSelect(palette.colors)}
              title={palette.label}
              className="group relative flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-all hover:border-[var(--color-primary)]"
              style={{
                borderColor: isActive ? "var(--color-primary)" : "var(--color-border)",
                backgroundColor: isActive ? "var(--color-primary)/5" : "var(--color-bg)",
              }}
            >
              {/* 4 swatch squares */}
              <div className="grid grid-cols-2 gap-0.5 rounded-md overflow-hidden w-full aspect-square">
                {palette.swatches.map((color, i) => (
                  <div
                    key={i}
                    className="w-full h-full"
                    style={{ backgroundColor: color, minHeight: "12px" }}
                  />
                ))}
              </div>
              <span
                className="text-[9px] font-semibold uppercase tracking-wide leading-none"
                style={{ color: isActive ? "var(--color-primary)" : "var(--color-muted)" }}
              >
                {palette.label}
              </span>
              {isActive && (
                <div className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-[var(--color-primary)] flex items-center justify-center">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="white">
                    <path d="M1.5 4l2 2 3-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorInput({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || "#1a1a1a"}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-10 cursor-pointer rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5"
      />
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#1a1a1a"
        className={inputCls}
      />
    </div>
  );
}

/* ── ProductPicker ───────────────────────────────────────────────── */
function ProductPicker({
  label,
  badgeColor,
  selectedIds,
  allProducts,
  onToggle
}: {
  label: string;
  badgeColor: string;
  selectedIds: string[];
  allProducts: ProductSummary[];
  onToggle: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const selectedSet = new Set(selectedIds);
  const selected = allProducts.filter((p) => selectedSet.has(p.productId));
  const filtered = allProducts.filter((p) => {
    if (selectedSet.has(p.productId)) return false;
    if (!search.trim()) return true;
    return p.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{label}</label>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((p) => (
            <div
              key={p.productId}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
              style={{ borderColor: badgeColor, color: badgeColor }}
            >
              {p.imageUrl?.trim() && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl.trim()} alt="" className="h-4 w-4 rounded-full object-cover" />
              )}
              <span className="max-w-[140px] truncate">{p.name}</span>
              <button
                type="button"
                onClick={() => onToggle(p.productId)}
                className="ml-0.5 text-[var(--color-muted)] hover:text-red-500"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search + add */}
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <Search size={14} className="shrink-0 text-[var(--color-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none"
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-xs text-[var(--color-muted)]">
              {search ? "Sin resultados" : "Todos los productos ya están seleccionados"}
            </p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.productId}
                type="button"
                onClick={() => onToggle(p.productId)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface)] transition-colors"
              >
                {p.imageUrl?.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl.trim()} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-[var(--color-border)]" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-text)]">{p.name}</span>
                <span className="shrink-0 text-xs text-[var(--color-muted)]">
                  ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(p.minPrice)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────── */
function mergeLoadedConfig(incoming: Record<string, unknown>): StoreConfig {
  return normalizeStoreConfig({ ...DEFAULT_STORE_CONFIG, ...incoming });
}

export default function TiendaConfigPage() {
  const [config, setConfig] = useState<StoreConfig>(DEFAULT_STORE_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [publicSlug, setPublicSlug] = useState<string | null>(null);
  const [allProducts, setAllProducts] = useState<ProductSummary[]>([]);
  const [allCategories, setAllCategories] = useState<CategoryRow[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set(["brand", "home"]));
  const [isMobile, setIsMobile] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const ctx = authContext();
    if (!ctx) return;
    const base = getClientApiBase();
    Promise.all([
      fetch(`${base}/tienda-config`, {
        headers: { Authorization: `Bearer ${ctx.token}`, "x-tenant-id": ctx.tenantId }
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${base}/ops/tenant-knowledge`, {
        headers: { Authorization: `Bearer ${ctx.token}`, "x-tenant-id": ctx.tenantId }
      }).then((r) => (r.ok ? r.json() : null))
    ]).then(([cfg, knowledge]) => {
      if (cfg) setConfig(mergeLoadedConfig(cfg as Record<string, unknown>));
      if ((knowledge as Record<string, unknown>)?.publicCatalogSlug)
        setPublicSlug((knowledge as Record<string, unknown>).publicCatalogSlug as string);
      setLoading(false);
    }).catch(() => setLoading(false));

    // Load products for the picker (don't block the form loading)
    const ctx2 = authContext();
    if (ctx2) {
      fetch(`${getClientApiBase()}/products`, {
        headers: { Authorization: `Bearer ${ctx2.token}`, "x-tenant-id": ctx2.tenantId }
      }).then((r) => r.ok ? r.json() : null)
        .then((data: unknown) => {
          if (!Array.isArray(data)) return;
          type RawVariant = { productId: string; name: string; imageUrl?: string | null; effectivePrice?: number };
          const variants = data as RawVariant[];
          const map = new Map<string, ProductSummary>();
          for (const v of variants) {
            if (v.productId && !map.has(v.productId)) {
              map.set(v.productId, {
                productId: v.productId,
                name: v.name,
                imageUrl: v.imageUrl ?? null,
                minPrice: v.effectivePrice ?? 0
              });
            }
          }
          setAllProducts([...map.values()]);
        }).catch(() => null);
    }

    if (ctx) {
      fetch(`${getClientApiBase()}/categories`, {
        headers: { Authorization: `Bearer ${ctx.token}`, "x-tenant-id": ctx.tenantId }
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: unknown) => {
          if (!Array.isArray(data)) return;
          setAllCategories(data as CategoryRow[]);
        })
        .catch(() => null);
    }
  }, []);

  function toggleSection(key: SectionKey) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    const ctx = authContext();
    if (!ctx) return;
    setSaving(true);
    setError("");
    try {
      const base = getClientApiBase();
      const res = await fetch(`${base}/tienda-config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ctx.token}`,
          "x-tenant-id": ctx.tenantId
        },
        body: JSON.stringify(config)
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(d.message ?? "Error al guardar");
      }
      setSaved(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const setBrand = (patch: Partial<StoreConfigBrand>) =>
    setConfig((c) => ({ ...c, brand: { ...c.brand, ...patch } }));
  const setHero = (patch: Partial<StoreConfigHero>) =>
    setConfig((c) => ({ ...c, hero: { ...c.hero, ...patch } }));
  const setColors = (patch: Partial<StoreConfigColors>) =>
    setConfig((c) => ({ ...c, colors: { ...c.colors, ...patch } }));
  const setTypography = (patch: Partial<StoreConfigTypography>) =>
    setConfig((c) => ({ ...c, typography: { ...c.typography, ...patch } }));
  const setContact = (patch: Partial<StoreConfigContact>) =>
    setConfig((c) => ({ ...c, contact: { ...c.contact, ...patch } }));
  const setUiTexts = (patch: Partial<StoreConfigUiTexts>) =>
    setConfig((c) => ({ ...c, uiTexts: { ...c.uiTexts, ...patch } }));

  const updateHomeSlot = (index: number, patch: { categoryId?: string; imageUrl?: string }) => {
    setConfig((c) => {
      const cur = [...(c.home?.categoryShowcase ?? [])];
      while (cur.length < 3) cur.push({});
      cur[index] = { ...cur[index], ...patch };
      return {
        ...c,
        home: { categoryShowcase: cur.slice(0, 3) }
      };
    });
  };

  const activeCategories = allCategories
    .filter((x) => x.isActive)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const toggleFeaturedNew = (id: string) =>
    setConfig((c) => {
      const ids = c.featured.newProductIds;
      return {
        ...c,
        featured: {
          ...c.featured,
          newProductIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
        }
      };
    });

  const toggleFeaturedSale = (id: string) =>
    setConfig((c) => {
      const ids = c.featured.saleProductIds;
      return {
        ...c,
        featured: {
          ...c.featured,
          saleProductIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
        }
      };
    });

  return (
    <div
      className="flex h-[100dvh] w-full overflow-hidden"
      style={{ flexDirection: isMobile ? "column-reverse" : "row" }}
    >
      <AppSidebar active="tienda" compact={isMobile} />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--color-bg)]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-6 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <Store size={20} className="text-[var(--color-primary)]" />
            <div>
              <h1 className="text-base font-semibold text-[var(--color-text)]">Configurar Tienda Pública</h1>
              <p className="text-xs text-[var(--color-muted)]">
                Marca, colores, portada, categorías en la home y productos destacados
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {publicSlug && (
              <a
                href={`/tienda/${publicSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              >
                <ExternalLink size={13} />
                Ver tienda
              </a>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
            >
              {saved ? (
                <><Check size={14} />Guardado</>
              ) : saving ? (
                <><Loader2 size={14} className="animate-spin" />Guardando…</>
              ) : (
                <><Save size={14} />Guardar cambios</>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[var(--color-primary)]" />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-6 py-6 space-y-3">

            {/* ── IDENTIDAD DE MARCA ── */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <SectionHeader
                icon={Store} title="Identidad de marca"
                subtitle="Nombre, tipo de tienda, logo y slogan"
                expanded={expandedSections.has("brand")} onToggle={() => toggleSection("brand")}
              />
              {expandedSections.has("brand") && (
                <div className="border-t border-[var(--color-border)] px-4 py-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Nombre de la tienda">
                    <input className={inputCls} placeholder="Ej: MAISON ÉLÉGANCE"
                      value={config.brand.storeName ?? ""} onChange={(e) => setBrand({ storeName: e.target.value })} />
                  </FormField>
                  <FormField label="Tipo de tienda">
                    <select className={inputCls} value={config.brand.storeType ?? ""}
                      onChange={(e) => setBrand({ storeType: e.target.value as StoreConfigBrand["storeType"] })}>
                      <option value="">Seleccionar…</option>
                      <option value="women">Mujer</option>
                      <option value="men">Hombre</option>
                      <option value="unisex">Unisex</option>
                      <option value="general">General</option>
                    </select>
                  </FormField>
                  <FormField label="Slogan / Tagline" hint="Frase corta que define la marca">
                    <input className={inputCls} placeholder="Donde la elegancia encuentra su expresión"
                      value={config.brand.tagline ?? ""} onChange={(e) => setBrand({ tagline: e.target.value })} />
                  </FormField>
                  <div />
                  <div className="sm:col-span-2">
                    <ImageField
                      label="Logo de la tienda"
                      hint="Se muestra en el header de la tienda pública"
                      value={config.brand.logoUrl}
                      onChange={(url) => setBrand({ logoUrl: url })}
                      folder="store-config"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <FormField label="Descripción de la marca" hint="Aparece en el footer y mejora el SEO">
                      <textarea className={textareaCls} rows={3}
                        placeholder="Colección curada de moda femenina premium…"
                        value={config.brand.description ?? ""} onChange={(e) => setBrand({ description: e.target.value })} />
                    </FormField>
                  </div>
                </div>
              )}
            </div>

            {/* ── COLORES ── */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <SectionHeader
                icon={Palette} title="Paleta de colores"
                subtitle="Colores principales del tema visual"
                expanded={expandedSections.has("colors")} onToggle={() => toggleSection("colors")}
              />
              {expandedSections.has("colors") && (
                <div className="border-t border-[var(--color-border)] px-4 py-5 flex flex-col gap-5">
                  <PaletteGrid active={config.colors} onSelect={setColors} />
                  <div className="h-px" style={{ backgroundColor: "var(--color-border)" }} />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Color primario" hint="Color principal de la marca">
                    <ColorInput value={config.colors.primary} onChange={(v) => setColors({ primary: v })} />
                  </FormField>
                  <FormField label="Color secundario" hint="Acentos y detalles">
                    <ColorInput value={config.colors.secondary} onChange={(v) => setColors({ secondary: v })} />
                  </FormField>
                  <FormField label="Color de fondo" hint="Background de la página">
                    <ColorInput value={config.colors.background} onChange={(v) => setColors({ background: v })} />
                  </FormField>
                  <FormField label="Color de superficie" hint="Fondo de tarjetas">
                    <ColorInput value={config.colors.surface} onChange={(v) => setColors({ surface: v })} />
                  </FormField>
                  <FormField label="Texto principal">
                    <ColorInput value={config.colors.textPrimary} onChange={(v) => setColors({ textPrimary: v })} />
                  </FormField>
                  <FormField label="Texto secundario">
                    <ColorInput value={config.colors.textSecondary} onChange={(v) => setColors({ textSecondary: v })} />
                  </FormField>
                  <FormField label="Color de bordes">
                    <ColorInput value={config.colors.border} onChange={(v) => setColors({ border: v })} />
                  </FormField>

                  {/* Live preview */}
                  <div className="sm:col-span-2">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Preview</p>
                    <div className="rounded-xl border p-4 flex items-center gap-3"
                      style={{ backgroundColor: config.colors.background || "#fafafa", borderColor: config.colors.border || "#e5e5e5" }}>
                      <div className="h-10 w-10 rounded-lg flex items-center justify-center text-white text-sm font-bold"
                        style={{ backgroundColor: config.colors.primary || "#1a1a1a" }}>A</div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: config.colors.textPrimary || "#1a1a1a" }}>
                          {config.brand.storeName || "Nombre de tienda"}
                        </p>
                        <p className="text-xs" style={{ color: config.colors.textSecondary || "#6b6b6b" }}>
                          {config.brand.tagline || "Tu slogan aquí"}
                        </p>
                      </div>
                      <div className="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: config.colors.secondary || config.colors.primary || "#d4af37" }}>
                        Ver más
                      </div>
                    </div>
                  </div>
                  </div>{/* end grid */}
                </div>
              )}
            </div>

            {/* ── TIPOGRAFÍA ── */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <SectionHeader
                icon={Type} title="Tipografía"
                subtitle="Fuentes para títulos y textos"
                expanded={expandedSections.has("typography")} onToggle={() => toggleSection("typography")}
              />
              {expandedSections.has("typography") && (
                <div className="border-t border-[var(--color-border)] px-4 py-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Fuente principal" hint="Para títulos y headers">
                    <select className={inputCls} value={config.typography.headingFont ?? ""}
                      onChange={(e) => setTypography({ headingFont: e.target.value })}>
                      <option value="">Por defecto (Geist)</option>
                      {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Fuente secundaria" hint="Para textos y body">
                    <select className={inputCls} value={config.typography.bodyFont ?? ""}
                      onChange={(e) => setTypography({ bodyFont: e.target.value })}>
                      <option value="">Por defecto (Geist)</option>
                      {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </FormField>
                  {(config.typography.headingFont || config.typography.bodyFont) && (
                    <div className="sm:col-span-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                      <style>{`@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(config.typography.headingFont || "Inter")}:wght@400;600;700&family=${encodeURIComponent(config.typography.bodyFont || "Inter")}:wght@400;500&display=swap');`}</style>
                      <p className="text-xl font-bold mb-1"
                        style={{ fontFamily: config.typography.headingFont ? `"${config.typography.headingFont}", serif` : undefined }}>
                        {config.brand.storeName || "Nombre de la tienda"}
                      </p>
                      <p className="text-sm text-[var(--color-muted)]"
                        style={{ fontFamily: config.typography.bodyFont ? `"${config.typography.bodyFont}", sans-serif` : undefined }}>
                        Texto de ejemplo con la tipografía seleccionada.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── HERO ── */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <SectionHeader
                icon={ImageIcon} title="Portada principal (Hero)"
                subtitle="Carrusel superior: título, imagen de fondo y botón"
                expanded={expandedSections.has("hero")} onToggle={() => toggleSection("hero")}
              />
              {expandedSections.has("hero") && (
                <div className="border-t border-[var(--color-border)] px-4 py-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Título principal">
                    <input className={inputCls} placeholder="Nueva Colección Primavera"
                      value={config.hero.title ?? ""} onChange={(e) => setHero({ title: e.target.value })} />
                  </FormField>
                  <FormField label="Subtítulo">
                    <input className={inputCls} placeholder="Piezas únicas que definen tu estilo…"
                      value={config.hero.subtitle ?? ""} onChange={(e) => setHero({ subtitle: e.target.value })} />
                  </FormField>
                  <div className="sm:col-span-2">
                    <ImageField
                      label="Imagen de fondo del Hero"
                      hint="Recomendado: 1920×600 px. Podés sumar más diapositivas desde banners en el JSON avanzado si lo necesitás."
                      value={config.hero.backgroundImageUrl}
                      onChange={(url) => setHero({ backgroundImageUrl: url })}
                      folder="store-config"
                    />
                  </div>
                  <FormField label="Texto del botón CTA">
                    <input className={inputCls} placeholder="Explorar Colección"
                      value={config.hero.ctaText ?? ""} onChange={(e) => setHero({ ctaText: e.target.value })} />
                  </FormField>
                  <FormField label="Link del botón CTA" hint="Ruta interna o URL">
                    <input className={inputCls} placeholder="/tienda/mi-slug/catalogo"
                      value={config.hero.ctaLink ?? ""} onChange={(e) => setHero({ ctaLink: e.target.value })} />
                  </FormField>
                </div>
              )}
            </div>

            {/* ── HOME: CATEGORÍAS DESTACADAS ── */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <SectionHeader
                icon={LayoutGrid} title="Categorías en la página de inicio"
                subtitle="Elegí hasta 3 categorías y una imagen opcional por tarjeta"
                expanded={expandedSections.has("home")} onToggle={() => toggleSection("home")}
              />
              {expandedSections.has("home") && (
                <div className="border-t border-[var(--color-border)] px-4 py-5 space-y-4">
                  <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                    Si no configurás ninguna categoría aquí, la tienda muestra automáticamente las tres primeras categorías raíz.
                    Las imágenes se muestran en la grilla &quot;Categorías&quot; de la home pública.
                  </p>
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                    {[0, 1, 2].map((idx) => {
                      const slot = config.home?.categoryShowcase?.[idx] ?? {};
                      return (
                        <div
                          key={idx}
                          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 space-y-3"
                        >
                          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                            Tarjeta {idx + 1}
                          </p>
                          <FormField label="Categoría">
                            <select
                              className={inputCls}
                              value={slot.categoryId ?? ""}
                              onChange={(e) =>
                                updateHomeSlot(idx, { categoryId: e.target.value || undefined })
                              }
                            >
                              <option value="">— Sin seleccionar —</option>
                              {activeCategories.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {cat.name}
                                </option>
                              ))}
                            </select>
                          </FormField>
                          <ImageField
                            label="Imagen de la tarjeta"
                            hint="Cuadrada o vertical, se recorta al centro"
                            value={slot.imageUrl}
                            onChange={(url) => updateHomeSlot(idx, { imageUrl: url })}
                            folder="store-config"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── TEXTOS DE INTERFAZ ── */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <SectionHeader
                icon={Globe} title="Textos de la interfaz"
                subtitle="Etiquetas, moneda y buscador"
                expanded={expandedSections.has("ui")} onToggle={() => toggleSection("ui")}
              />
              {expandedSections.has("ui") && (
                <div className="border-t border-[var(--color-border)] px-4 py-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Símbolo de moneda">
                    <input className={inputCls} placeholder="$" value={config.uiTexts.currencySymbol ?? ""}
                      onChange={(e) => setUiTexts({ currencySymbol: e.target.value })} />
                  </FormField>
                  <FormField label="Placeholder del buscador">
                    <input className={inputCls} placeholder="Buscar productos…" value={config.uiTexts.searchPlaceholder ?? ""}
                      onChange={(e) => setUiTexts({ searchPlaceholder: e.target.value })} />
                  </FormField>
                  <FormField label='Etiqueta "Nuevo"'>
                    <input className={inputCls} placeholder="Nuevo" value={config.uiTexts.newBadge ?? ""}
                      onChange={(e) => setUiTexts({ newBadge: e.target.value })} />
                  </FormField>
                  <FormField label='Etiqueta "Oferta"'>
                    <input className={inputCls} placeholder="Oferta" value={config.uiTexts.saleBadge ?? ""}
                      onChange={(e) => setUiTexts({ saleBadge: e.target.value })} />
                  </FormField>
                  <FormField label="Texto del botón filtrar">
                    <input className={inputCls} placeholder="Filtrar" value={config.uiTexts.filterText ?? ""}
                      onChange={(e) => setUiTexts({ filterText: e.target.value })} />
                  </FormField>
                </div>
              )}
            </div>

            {/* ── PRODUCTOS DESTACADOS ── */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <SectionHeader
                icon={Star} title="Productos destacados"
                subtitle="Novedades y ofertas que aparecen en la página principal"
                expanded={expandedSections.has("featured")} onToggle={() => toggleSection("featured")}
              />
              {expandedSections.has("featured") && (
                <div className="border-t border-[var(--color-border)] px-4 py-5 space-y-6">
                  {allProducts.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted)]">
                      Cargando productos…
                    </p>
                  ) : (
                    <>
                      <ProductPicker
                        label={`Novedades ${config.uiTexts.newBadge ? `("${config.uiTexts.newBadge}")` : ""} — seleccioná los productos nuevos`}
                        badgeColor="var(--color-primary)"
                        selectedIds={config.featured.newProductIds}
                        allProducts={allProducts}
                        onToggle={toggleFeaturedNew}
                      />
                      <ProductPicker
                        label={`Ofertas ${config.uiTexts.saleBadge ? `("${config.uiTexts.saleBadge}")` : ""} — seleccioná los productos en descuento`}
                        badgeColor="#ef4444"
                        selectedIds={config.featured.saleProductIds}
                        allProducts={allProducts}
                        onToggle={toggleFeaturedSale}
                      />
                      <p className="text-xs text-[var(--color-muted)]">
                        Definí acá las insignias &quot;Nuevo&quot; y &quot;Oferta&quot; y los bloques de últimos ingresos en la home.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── CONTACTO / FOOTER ── */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <SectionHeader
                icon={Phone} title="Información de contacto"
                subtitle="Footer público: redes y datos de contacto"
                expanded={expandedSections.has("contact")} onToggle={() => toggleSection("contact")}
              />
              {expandedSections.has("contact") && (
                <div className="border-t border-[var(--color-border)] px-4 py-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <FormField label="Sobre nosotros" hint="Descripción corta que aparece en el footer">
                      <textarea className={textareaCls} rows={3}
                        placeholder="MAISON ÉLÉGANCE representa lo mejor de la moda local…"
                        value={config.contact.aboutText ?? ""} onChange={(e) => setContact({ aboutText: e.target.value })} />
                    </FormField>
                  </div>
                  <FormField label="Email de contacto">
                    <input className={inputCls} type="email" placeholder="hello@tienda.com"
                      value={config.contact.email ?? ""} onChange={(e) => setContact({ email: e.target.value })} />
                  </FormField>
                  <FormField label="Teléfono">
                    <input className={inputCls} placeholder="+54 11 1234-5678"
                      value={config.contact.phone ?? ""} onChange={(e) => setContact({ phone: e.target.value })} />
                  </FormField>
                  <FormField label="Instagram" hint="Solo el usuario, sin @">
                    <input className={inputCls} placeholder="mitienda"
                      value={config.contact.instagram ?? ""} onChange={(e) => setContact({ instagram: e.target.value })} />
                  </FormField>
                  <FormField label="Facebook" hint="Solo el usuario">
                    <input className={inputCls} placeholder="mitienda"
                      value={config.contact.facebook ?? ""} onChange={(e) => setContact({ facebook: e.target.value })} />
                  </FormField>
                  <FormField label="TikTok" hint="Solo el usuario, sin @">
                    <input className={inputCls} placeholder="mitienda"
                      value={config.contact.tiktok ?? ""} onChange={(e) => setContact({ tiktok: e.target.value })} />
                  </FormField>
                  <FormField label="Pinterest" hint="Solo el usuario">
                    <input className={inputCls} placeholder="mitienda"
                      value={config.contact.pinterest ?? ""} onChange={(e) => setContact({ pinterest: e.target.value })} />
                  </FormField>
                </div>
              )}
            </div>

            {/* Catalog URL */}
            {publicSlug && (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4">
                <p className="text-xs text-[var(--color-muted)] mb-1">URL de tu tienda pública</p>
                <a href={`/tienda/${publicSlug}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline">
                  <Globe size={13} />
                  {`/tienda/${publicSlug}`}
                </a>
              </div>
            )}

            <div className="h-8" />
          </div>
        )}
      </main>
    </div>
  );
}
