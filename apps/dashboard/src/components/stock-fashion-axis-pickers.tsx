"use client";

import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { formatAxisLabel } from "@/components/stock-ui";
import {
  APPAREL_SIZE_LETTERS,
  APPAREL_SIZE_NUMBERS,
  FASHION_BRAND_HINTS,
  FASHION_COLOR_SWATCHES,
  FASHION_MODEL_HINTS,
  FOOTWEAR_SIZES,
  axesIncludeTalleAndColor,
  fashionGridCellKey,
  normalizeAxisKey,
  shouldShowFashionStockUi,
  toggleStringInList,
} from "@/lib/stock-fashion-ui";

const chipWrap: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 6,
};

const chipBtn = (active?: boolean, touch?: boolean): CSSProperties => ({
  padding: touch ? "8px 12px" : "4px 10px",
  minHeight: touch ? 40 : undefined,
  borderRadius: 999,
  fontSize: touch ? 13 : 12,
  fontWeight: 600,
  cursor: "pointer",
  border: active
    ? "1.5px solid var(--color-primary)"
    : "1px solid var(--color-border)",
  background: active ? "color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))" : "var(--color-surface)",
  color: "var(--color-text)",
});

/** Chips compactos para «Ideas» (modelo): muchas opciones en poco alto. */
const ideasChipWrap: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignContent: "flex-start",
  gap: 4,
  marginTop: 4,
  maxHeight: 88,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  paddingBottom: 2,
  scrollbarGutter: "stable",
};

const chipBtnIdeas = (active?: boolean): CSSProperties => ({
  padding: "2px 7px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.2,
  cursor: "pointer",
  border: active
    ? "1px solid var(--color-primary)"
    : "1px solid var(--color-border)",
  background: active ? "color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))" : "var(--color-surface)",
  color: "var(--color-text)",
});

export function FashionAxisQuickPicks({
  axis,
  axes,
  currentValue,
  onSelect,
  businessCategory,
}: {
  axis: string;
  axes: string[];
  currentValue: string;
  onSelect: (value: string) => void;
  businessCategory?: string;
}) {
  const k = normalizeAxisKey(axis);

  /** Marca: atajos útiles en cualquier rubro (no depende del modo showroom). */
  if (k === "marca") {
    return (
      <div style={{ marginTop: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Marcas</span>
        <div style={chipWrap}>
          {FASHION_BRAND_HINTS.map((v) => (
            <button key={v} type="button" style={chipBtn(currentValue.trim().toLowerCase() === v.toLowerCase())} onClick={() => onSelect(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!shouldShowFashionStockUi(businessCategory, axes)) return null;

  if (k === "talle") {
    return (
      <div style={{ marginTop: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Letras</span>
        <div style={chipWrap}>
          {APPAREL_SIZE_LETTERS.map((v) => (
            <button key={v} type="button" style={chipBtn(currentValue === v)} onClick={() => onSelect(v)}>
              {v}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", display: "block", marginTop: 8 }}>
          Núm. ropa
        </span>
        <div style={chipWrap}>
          {APPAREL_SIZE_NUMBERS.map((v) => (
            <button key={v} type="button" style={chipBtn(currentValue === v)} onClick={() => onSelect(v)}>
              {v}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", display: "block", marginTop: 8 }}>
          Calzado
        </span>
        <div style={chipWrap}>
          {FOOTWEAR_SIZES.map((v) => (
            <button key={v} type="button" style={chipBtn(currentValue === v)} onClick={() => onSelect(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (k === "color") {
    return (
      <div style={{ marginTop: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)" }}>Colores</span>
        <div style={chipWrap}>
          {FASHION_COLOR_SWATCHES.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              title={value}
              style={chipBtn(currentValue.trim().toLowerCase() === value.toLowerCase())}
              onClick={() => onSelect(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (k === "modelo") {
    return (
      <div style={{ marginTop: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-muted)", letterSpacing: "0.02em" }}>
          Ideas
        </span>
        <div style={ideasChipWrap} title="Deslizá para ver más">
          {FASHION_MODEL_HINTS.map((v) => (
            <button key={v} type="button" style={chipBtnIdeas(currentValue === v)} onClick={() => onSelect(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

const gridBox: CSSProperties = {
  marginTop: 12,
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid color-mix(in srgb, var(--color-primary) 28%, var(--color-border))",
  background: "color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))",
  display: "grid",
  gap: 10,
};

function MultiPickRow({
  title,
  selected,
  onToggle,
  options,
  touch,
}: {
  title: string;
  selected: string[];
  onToggle: (v: string) => void;
  options: readonly string[];
  touch?: boolean;
}) {
  return (
    <div>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-muted)" }}>{title}</span>
      <div style={chipWrap}>
        {options.map((v) => {
          const on = selected.some((s) => s.toLowerCase() === v.toLowerCase());
          return (
            <button key={v} type="button" style={chipBtn(on, touch)} onClick={() => onToggle(v)}>
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Grilla talle × color: selección múltiple antes de generar variantes. */
export function FashionVariantGridPicker({
  axes,
  businessCategory,
  gridTalles,
  gridColors,
  setGridTalles,
  setGridColors,
  isMobile,
}: {
  axes: string[];
  businessCategory?: string;
  gridTalles: string[];
  gridColors: string[];
  setGridTalles: Dispatch<SetStateAction<string[]>>;
  setGridColors: Dispatch<SetStateAction<string[]>>;
  isMobile?: boolean;
}) {
  if (!shouldShowFashionStockUi(businessCategory, axes)) return null;
  if (!axesIncludeTalleAndColor(axes)) return null;

  const touch = Boolean(isMobile);
  const box: CSSProperties = {
    ...gridBox,
    padding: touch ? "10px 10px" : "12px 14px",
    maxHeight: touch ? "min(52vh, 340px)" : "min(44vh, 360px)",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
  };

  return (
    <div style={box}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>Elegí talles y colores</p>
      <MultiPickRow
        title="Letras"
        selected={gridTalles}
        onToggle={(v) => setGridTalles((prev) => toggleStringInList(prev, v))}
        options={APPAREL_SIZE_LETTERS}
        touch={touch}
      />
      <MultiPickRow
        title="Núm. ropa"
        selected={gridTalles}
        onToggle={(v) => setGridTalles((prev) => toggleStringInList(prev, v))}
        options={APPAREL_SIZE_NUMBERS}
        touch={touch}
      />
      <MultiPickRow
        title="Calzado"
        selected={gridTalles}
        onToggle={(v) => setGridTalles((prev) => toggleStringInList(prev, v))}
        options={FOOTWEAR_SIZES}
        touch={touch}
      />
      <MultiPickRow
        title="Colores"
        selected={gridColors}
        onToggle={(v) => setGridColors((prev) => toggleStringInList(prev, v))}
        options={FASHION_COLOR_SWATCHES.map((c) => c.value)}
        touch={touch}
      />
      <div style={{ fontSize: 11, color: "var(--color-muted)", lineHeight: 1.35 }}>
        {gridTalles.length ? gridTalles.join(", ") : "—"} · {gridColors.length ? gridColors.join(", ") : "—"}
      </div>
    </div>
  );
}

/** Matriz editable: cantidad por par talle×color; celdas vacías no cuentan si usás stock uniforme arriba. */
export function FashionGridQtyMatrix({
  gridTalles,
  gridColors,
  cellStocks,
  setCellStocks,
  fillFromStock,
  isMobile,
}: {
  gridTalles: string[];
  gridColors: string[];
  cellStocks: Record<string, string>;
  setCellStocks: Dispatch<SetStateAction<Record<string, string>>>;
  fillFromStock: number;
  isMobile?: boolean;
}) {
  if (gridTalles.length === 0 || gridColors.length === 0) return null;

  const fillAll = () => {
    const n = Math.max(0, Math.floor(Number(fillFromStock)));
    const next: Record<string, string> = {};
    for (const t of gridTalles) {
      for (const c of gridColors) {
        next[fashionGridCellKey(t, c)] = String(n);
      }
    }
    setCellStocks(next);
  };

  const clearMatrix = () => setCellStocks({});

  const th: CSSProperties = {
    fontSize: isMobile ? 9 : 10,
    fontWeight: 700,
    color: "var(--color-muted)",
    textAlign: "center",
    padding: "4px 2px",
    maxWidth: isMobile ? 52 : 72,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const inputCell: CSSProperties = {
    width: "100%",
    minWidth: isMobile ? 40 : 44,
    maxWidth: 56,
    margin: "0 auto",
    display: "block",
    padding: "4px 6px",
    fontSize: isMobile ? 12 : 13,
    textAlign: "center",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
  };

  const btnSecondary: CSSProperties = {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text)",
  };

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-muted)" }}>Cantidades por celda</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            onClick={fillAll}
            style={btnSecondary}
            title="Copia el número de «Stock uniforme» del bloque de arriba en todas las celdas"
          >
            Igual en todas ({Math.max(0, Math.floor(fillFromStock))})
          </button>
          <button type="button" onClick={clearMatrix} style={{ ...btnSecondary, color: "var(--color-muted)" }}>
            Vaciar matriz
          </button>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "var(--color-muted)", lineHeight: 1.4 }}>
        Si cargás al menos un número acá, al generar solo se agregan las celdas con cantidad mayor a cero. Si dejás toda la matriz vacía, se usa
        el «stock uniforme» del bloque de arriba en cada combinación talle × color.
      </p>
      <div
        style={{
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          borderRadius: 10,
          border: "1px solid var(--color-border)",
          background: "var(--color-bg)",
          padding: isMobile ? 6 : 8,
        }}
      >
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            minWidth: Math.max(200, 52 + gridColors.length * 52),
          }}
        >
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", maxWidth: 44 }}>Talle</th>
              {gridColors.map((c) => (
                <th key={c} style={th} title={c}>
                  {c.length > 10 ? `${c.slice(0, 9)}…` : c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gridTalles.map((t) => (
              <tr key={t}>
                <td
                  style={{
                    fontSize: isMobile ? 11 : 12,
                    fontWeight: 700,
                    padding: "6px 4px",
                    color: "var(--color-text)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t}
                </td>
                {gridColors.map((c) => {
                  const key = fashionGridCellKey(t, c);
                  return (
                    <td key={key} style={{ padding: "4px 2px", verticalAlign: "middle" }}>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={cellStocks[key] ?? ""}
                        placeholder="—"
                        aria-label={`Stock ${t} ${c}`}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          setCellStocks((prev) => {
                            const next = { ...prev };
                            if (raw === "") delete next[key];
                            else next[key] = raw;
                            return next;
                          });
                        }}
                        style={inputCell}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
