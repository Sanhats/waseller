"use client";

import { Upload } from "lucide-react";
import { useState } from "react";
import type { CSSProperties, ReactNode, TdHTMLAttributes } from "react";

/** Etiqueta legible para ejes de variante (ej. talle → Talle). */
export function formatAxisLabel(axis: string): string {
  const t = axis.trim();
  if (!t) return axis;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Tabla con “rejilla”: líneas finas entre celdas (border-spacing). */
export const stockGridTableStyle: CSSProperties = {
  width: "100%",
  minWidth: 1240,
  borderCollapse: "separate",
  borderSpacing: "1px",
  backgroundColor: "var(--color-border)",
};

export function stockGridCellBg(emphasize?: boolean): CSSProperties {
  return {
    backgroundColor: emphasize
      ? "var(--color-primary-ultra-light)"
      : "var(--color-surface)",
  };
}

/** Celda de datos con fondo de cuadrícula y alineación consistente. */
export function StockGridTd({
  children,
  align = "left",
  emphasize,
  narrow,
  style,
  ...rest
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  emphasize?: boolean;
  narrow?: boolean;
} & Omit<TdHTMLAttributes<HTMLTableCellElement>, "align">) {
  return (
    <td
      {...rest}
      style={{
        ...stockGridCellBg(emphasize),
        padding: narrow ? "8px 10px" : "10px 12px",
        verticalAlign: "middle",
        textAlign: align,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

const mutedHint: CSSProperties = {
  marginTop: 4,
  display: "block",
  fontSize: 10,
  fontWeight: 400,
  textTransform: "none",
  letterSpacing: "normal",
  color: "var(--color-muted)",
  lineHeight: 1.35,
  opacity: 0.92,
};

/** Cabecera de tabla de stock: título corto, subtítulo y `title` (tooltip en escritorio; en táctil, pulsación larga). */
export function StockTableTh({
  children,
  hint,
  title,
}: {
  children: ReactNode;
  hint?: string;
  title: string;
}) {
  return (
    <th
      title={title}
      scope="col"
      style={{
        ...stockGridCellBg(false),
        textAlign: "left",
        padding: "10px 14px 12px",
        color: "var(--color-muted)",
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        verticalAlign: "bottom",
      }}
    >
      <span style={{ display: "block" }}>{children}</span>
      {hint ? <span style={mutedHint}>{hint}</span> : null}
    </th>
  );
}

export function StockFieldHint({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 400,
        color: "var(--color-muted)",
        lineHeight: 1.45,
        marginTop: 4,
        display: "block",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function StockSectionTitle({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--color-text)",
      }}
    >
      {children}
    </p>
  );
}

/** Miniatura de producto en tabla de inventario; placeholder si no hay URL o falla la carga. */
export function StockProductThumb({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  const url = typeof imageUrl === "string" && imageUrl.trim() ? imageUrl.trim() : "";
  const boxStyle: CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 8,
    flexShrink: 0,
    border: "1px solid var(--color-border)",
    backgroundColor: "var(--color-bg)",
    overflow: "hidden",
  };
  if (!url || broken) {
    return (
      <div
        style={{
          ...boxStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--color-muted)",
        }}
        title="Sin foto cargada"
        aria-label="Sin foto"
      >
        —
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Foto de ${name}`}
      title="Imagen del producto"
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      style={{
        ...boxStyle,
        display: "block",
        objectFit: "cover",
      }}
    />
  );
}

/** Comprime un archivo de imagen a JPEG data URL (compartida entre modales). */
export async function compressImageToDataUrl(
  file: File,
  opts: { maxWidth: number; maxHeight: number; quality: number },
): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onerror = () => reject(new Error("No se pudo cargar la imagen"));
    el.onload = () => resolve(el);
    el.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  let width = img.width;
  let height = img.height;
  if (width > height && width > opts.maxWidth) {
    height *= opts.maxWidth / width;
    width = opts.maxWidth;
  } else if (height > opts.maxHeight) {
    width *= opts.maxHeight / height;
    height = opts.maxHeight;
  }
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", opts.quality);
}

/** Cabecera de sección con badge numérico y línea divisora. */
export function FormSection({
  num,
  title,
  description,
  children,
}: {
  num: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "var(--color-primary)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
          aria-hidden
        >
          {num}
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text)",
          }}
        >
          {title}
        </span>
        <div
          style={{ flex: 1, height: 1, background: "var(--color-border)", marginLeft: 4 }}
          aria-hidden
        />
      </div>
      {description ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)", lineHeight: 1.55 }}>
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** Zona de carga de imágenes con ícono e indicador de cantidad. */
export function ImageDropZone({
  onFilesSelected,
  count,
  maxCount,
  label = "Subí fotos",
  sublabel = "JPG, PNG, WebP · se comprimen automáticamente a 512 px",
}: {
  onFilesSelected: (files: File[]) => void;
  count: number;
  maxCount: number;
  label?: string;
  sublabel?: string;
}) {
  const atMax = count >= maxCount;
  return (
    <label
      className="ws-drop-zone"
      style={{ opacity: atMax ? 0.55 : 1, cursor: atMax ? "not-allowed" : "pointer" }}
    >
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={atMax}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFilesSelected(files);
        }}
        style={{ display: "none" }}
      />
      <Upload size={18} aria-hidden style={{ color: "var(--color-primary)", opacity: 0.75 }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
        {count > 0 ? `${count} foto(s) cargada(s) — tocá para sumar más` : label}
      </span>
      <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
        {atMax ? `Límite de ${maxCount} imágenes alcanzado` : sublabel}
      </span>
    </label>
  );
}

/** Grilla de miniaturas con controles de quitar/reordenar. */
export function ImageThumbnailGrid({
  urls,
  onRemove,
  onMoveUp,
  thumbHeight = 90,
}: {
  urls: string[];
  onRemove: (idx: number) => void;
  onMoveUp: (idx: number) => void;
  thumbHeight?: number;
}) {
  if (urls.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
        gap: 10,
      }}
    >
      {urls.map((u, idx) => (
        <ImageThumb
          key={`${u.slice(0, 30)}-${idx}`}
          url={u}
          isPrimary={idx === 0}
          thumbHeight={thumbHeight}
          onRemove={() => onRemove(idx)}
          onMoveUp={idx > 0 ? () => onMoveUp(idx) : undefined}
        />
      ))}
    </div>
  );
}

function ImageThumb({
  url,
  isPrimary,
  thumbHeight,
  onRemove,
  onMoveUp,
}: {
  url: string;
  isPrimary: boolean;
  thumbHeight: number;
  onRemove: () => void;
  onMoveUp?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        border: `1.5px solid ${isPrimary ? "var(--color-primary)" : "var(--color-border)"}`,
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--color-bg)",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={isPrimary ? "Foto principal" : "Foto de galería"}
          style={{
            width: "100%",
            height: thumbHeight,
            objectFit: "cover",
            display: "block",
            transition: "opacity 0.15s",
            opacity: hovered ? 0.82 : 1,
          }}
        />
        {isPrimary && (
          <div
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              background: "var(--color-primary)",
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 99,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Principal
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          padding: "6px 8px",
          background: "var(--color-surface)",
          borderTop: "1px solid var(--color-border)",
          justifyContent: "space-between",
        }}
      >
        <button
          type="button"
          onClick={onRemove}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--color-error)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            padding: 0,
          }}
        >
          Quitar
        </button>
        {onMoveUp ? (
          <button
            type="button"
            onClick={onMoveUp}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--color-primary)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              padding: 0,
            }}
          >
            ↑ Subir
          </button>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-muted)" }}>
            Principal
          </span>
        )}
      </div>
    </div>
  );
}

/** Aviso bajo el título en pantallas chicas: tabla ancha + tooltips táctiles. */
export function StockTableMobileHint() {
  return (
    <p
      className="lg:hidden"
      style={{
        margin: "0 0 10px",
        padding: "10px 12px",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.45,
        color: "var(--color-text)",
        backgroundColor: "var(--color-primary-ultra-light)",
        border: "1px solid color-mix(in srgb, var(--color-primary) 22%, transparent)",
      }}
    >
      <span style={{ fontWeight: 700, color: "var(--color-primary)" }}>En el celu:</span> deslizá la tabla hacia los
      lados para ver todas las columnas. Para leer la ayuda larga de una columna, mantené pulsado el encabezado (tooltip
      nativo).
    </p>
  );
}
