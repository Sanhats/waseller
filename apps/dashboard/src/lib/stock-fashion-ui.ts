/**
 * UI orientada a indumentaria / calzado (showrooms, ropa dama, lencería, etc.).
 * Los ejes siguen siendo los de `tenant_knowledge` (`productVariantAxes`).
 */

export const APPAREL_SIZE_LETTERS = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
  "4XL",
  "5XL",
  "6XL",
  "7XL",
  "8XL",
  "NB",
  "RN",
  "0-3M",
  "3-6M",
  "6-9M",
  "9-12M",
  "12-18M",
  "18-24M",
  "2A",
  "3A",
  "4A",
  "5A",
  "6A",
  "8A",
  "10A",
  "12A",
  "14A",
  "16A",
  "Único",
] as const;

 /** Talles numéricos habituales en ropa (AR / dama, hombre, juvenil e infantil); el vendedor puede escribir otros. */
 export const APPAREL_SIZE_NUMBERS = [
  "0",
  "1",
  "2",
  "4",
  "6",
  "8",
  "10",
  "12",
  "14",
  "16",
  "18",
  "20",
  "22",
  "24",
  "26",
  "28",
  "30",
  "32",
  "34",
  "36",
  "38",
  "40",
  "42",
  "44",
  "46",
  "48",
  "50",
  "52",
  "54",
  "56",
  "58",
  "60",
] as const;

/** Números de calzado frecuentes (AR). */
export const FOOTWEAR_SIZES = [
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
] as const;

export const FASHION_COLOR_SWATCHES = [
  { label: "Negro", value: "Negro" },
  { label: "Blanco", value: "Blanco" },
  { label: "Gris", value: "Gris" },
  { label: "Plateado", value: "Plateado" },
  { label: "Beige", value: "Beige" },
  { label: "Nude", value: "Nude" },
  { label: "Camel", value: "Camel" },
  { label: "Marrón", value: "Marrón" },
  { label: "Chocolate", value: "Chocolate" },
  { label: "Terracota", value: "Terracota" },
  { label: "Rojo", value: "Rojo" },
  { label: "Bordo", value: "Bordo" },
  { label: "Coral", value: "Coral" },
  { label: "Rosa", value: "Rosa" },
  { label: "Fucsia", value: "Fucsia" },
  { label: "Lila", value: "Lila" },
  { label: "Lavanda", value: "Lavanda" },
  { label: "Violeta", value: "Violeta" },
  { label: "Azul", value: "Azul" },
  { label: "Celeste", value: "Celeste" },
  { label: "Marino", value: "Marino" },
  { label: "Jean", value: "Jean" },
  { label: "Turquesa", value: "Turquesa" },
  { label: "Verde", value: "Verde" },
  { label: "Oliva", value: "Oliva" },
  { label: "Militar", value: "Militar" },
  { label: "Menta", value: "Menta" },
  { label: "Amarillo", value: "Amarillo" },
  { label: "Mostaza", value: "Mostaza" },
  { label: "Naranja", value: "Naranja" },
  { label: "Dorado", value: "Dorado" },
  { label: "Cobre", value: "Cobre" },
  { label: "Animal Print", value: "Animal Print" },
  { label: "Print Floral", value: "Print Floral" },
  { label: "Rayado", value: "Rayado" },
  { label: "Cuadrillé", value: "Cuadrillé" },
  { label: "Lunares", value: "Lunares" },
  { label: "Multicolor", value: "Multicolor" },
  { label: "Transparente", value: "Transparente" },
] as const;

export const FASHION_MODEL_HINTS = [
  "Básico",
  "Clásico",
  "Conjunto",
  "Oversize",
  "Slim Fit",
  "Regular Fit",
  "Loose Fit",
  "Crop",
  "Wide Leg",
  "Recto",
  "Skinny",
  "Mom Fit",
  "Cargo",
  "Jogger",
  "Palazzo",
  "Oxford",
  "Body",
  "Top",
  "Musculosa",
  "Remera",
  "Camisa",
  "Blusa",
  "Sweater",
  "Buzo",
  "Hoodie",
  "Campera",
  "Chaleco",
  "Tapado",
  "Blazer",
  "Sastrero",
  "Vestido",
  "Midi",
  "Maxi",
  "Mini",
  "Pollera",
  "Short",
  "Bermuda",
  "Enterito",
  "Mono",
  "Pijama",
  "Lencería",
  "Deportivo",
  "Running",
  "Urbano",
  "Streetwear",
  "Formal",
  "Elegante",
  "Casual",
  "Fiesta",
  "Boho",
  "Vintage",
  "Premium",
  "Infantil",
  "Bebé",
  "Escolar",
  "Unisex",
  "Maternity",
  "Plus Size",
] as const;

/** Atajos para el eje «marca» (también sirven como línea o modelo comercial). */
export const FASHION_BRAND_HINTS = [
  "Nike",
  "Adidas",
  "Puma",
  "Reebok",
  "New Balance",
  "Converse",
  "Vans",
  "Topper",
  "Penalty",
  "Olympikus",
  "Umbro",
  "Lacoste",
  "Tommy Hilfiger",
  "Calvin Klein",
  "Levi's",
  "Lee",
  "Wrangler",
  "Zara",
  "H&M",
  "Benetton",
  "Cher",
  "Ayres",
  "Ricky Sarkany",
  "María Cher",
  "Etiqueta Negra",
  "Marcelo Burlon",
  "Sin marca",
  "Importado",
] as const;

export function normalizeAxisKey(axis: string): string {
  return String(axis ?? "")
    .trim()
    .toLowerCase();
}

export function toggleStringInList(list: string[], value: string): string[] {
  const v = value.trim();
  if (!v) return list;
  const i = list.findIndex((x) => x.toLowerCase() === v.toLowerCase());
  if (i >= 0) return list.filter((_, j) => j !== i);
  return [...list, v];
}

/** Mostrar atajos de showroom cuando el rubro es indumentaria o los ejes son típicos talle+color. */
export function shouldShowFashionStockUi(
  businessCategory: string | undefined,
  axes: string[],
): boolean {
  const cat = String(businessCategory ?? "").trim();
  if (cat === "indumentaria_calzado") return true;
  const n = axes.map(normalizeAxisKey);
  return n.includes("talle") && n.includes("color");
}

export function axesIncludeTalleAndColor(axes: string[]): boolean {
  const n = axes.map(normalizeAxisKey);
  return n.includes("talle") && n.includes("color");
}

const FASHION_GRID_CELL_SEP = "\u0001";

/** Clave estable para cantidad en matriz talle × color (evita `|` en valores de eje). */
export function fashionGridCellKey(talle: string, color: string): string {
  return `${talle}${FASHION_GRID_CELL_SEP}${color}`;
}

export type DraftVariantLike = {
  id: string;
  sku: string;
  stock: number;
  price: number | null;
  attributes: Record<string, string>;
  imageUrls: string[];
  /** Categorías solo de esta variante (además de las del producto). */
  categoryIds?: string[];
};

/**
 * Genera variantes para todas las combinaciones talle × color.
 * Otros ejes (p. ej. `modelo`) se rellenan con `fixedExtraAttrs` (mismo valor en todas las filas).
 *
 * Si `cellStocks` tiene al menos un valor &gt; 0, solo se emiten esas celdas (cantidad desigual por par).
 * Si no, se usa `stockPerVariant` en el producto cartesiano completo.
 */
export function buildTalleColorVariantGrid<T extends DraftVariantLike>(opts: {
  axes: string[];
  talles: string[];
  colors: string[];
  productName: string;
  existingVariants: T[];
  buildGeneratedSku: (
    productName: string,
    attributes: Record<string, string>,
    existingSkus: string[],
  ) => string;
  stockPerVariant?: number;
  /** Cantidad por par talle+color; solo filas con stock &gt; 0 (clave = `fashionGridCellKey`). */
  cellStocks?: Record<string, number>;
  /** Valores fijos por eje (claves = nombre de eje tal cual en `axes`). */
  fixedExtraAttrs?: Record<string, string>;
}): T[] {
  const {
    axes,
    talles,
    colors,
    productName,
    existingVariants,
    buildGeneratedSku,
  } = opts;
  const stockPer = Math.max(0, Number(opts.stockPerVariant ?? 0));
  const cellMap = opts.cellStocks;
  const usePerCellStock = Boolean(
    cellMap && Object.values(cellMap).some((n) => Math.max(0, Math.floor(Number(n))) > 0),
  );
  const extras = opts.fixedExtraAttrs ?? {};
  const nAxes = axes.map(normalizeAxisKey);
  if (!nAxes.includes("talle") || !nAxes.includes("color")) return [];
  const tList = talles.map((t) => String(t).trim()).filter(Boolean);
  const cList = colors.map((c) => String(c).trim()).filter(Boolean);
  if (tList.length === 0 || cList.length === 0) return [];

  const otherAxes = axes.filter((a) => {
    const k = normalizeAxisKey(a);
    return k !== "talle" && k !== "color";
  });
  for (const a of otherAxes) {
    if (!String(extras[a] ?? "").trim()) return [];
  }

  const out: T[] = [];
  const skus = existingVariants.map((v) => v.sku);

  for (const talle of tList) {
    for (const color of cList) {
      const cellStock = usePerCellStock
        ? Math.max(0, Math.floor(Number(cellMap![fashionGridCellKey(talle, color)] ?? 0)))
        : stockPer;
      if (usePerCellStock && cellStock <= 0) continue;

      const attrs: Record<string, string> = { ...extras };
      for (const axis of axes) {
        const k = normalizeAxisKey(axis);
        if (k === "talle") attrs[axis] = talle;
        else if (k === "color") attrs[axis] = color;
        else if (attrs[axis] === undefined) attrs[axis] = "";
      }
      const missing = axes.some((a) => !String(attrs[a] ?? "").trim());
      if (missing) continue;
      const sku = buildGeneratedSku(productName, attrs, skus);
      skus.push(sku);
      const row: DraftVariantLike = {
        id: `${sku}-${Date.now()}-${out.length}`,
        sku,
        stock: cellStock,
        price: null,
        attributes: attrs,
        imageUrls: [],
        categoryIds: [],
      };
      out.push(row as unknown as T);
    }
  }
  return out;
}
