"use client";

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
