/** Partes de SKU en mayúsculas alfanuméricas (para armar códigos de variante). */
export function slugifySkuPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

/** SKU sugerido a partir del nombre del producto, atributos y SKUs ya usados. */
export function buildGeneratedSku(
  productName: string,
  attributes: Record<string, string>,
  existingSkus: string[],
): string {
  const baseParts = [
    slugifySkuPart(productName || "PRODUCTO"),
    ...Object.values(attributes)
      .map((value) => slugifySkuPart(String(value ?? "")))
      .filter(Boolean),
  ].filter(Boolean);
  const baseSku = baseParts.join("-") || "PRODUCTO";
  const normalizedExisting = new Set(
    existingSkus.map((item) => item.toUpperCase()),
  );
  if (!normalizedExisting.has(baseSku)) return baseSku;

  let suffix = 2;
  while (normalizedExisting.has(`${baseSku}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseSku}-${suffix}`;
}
