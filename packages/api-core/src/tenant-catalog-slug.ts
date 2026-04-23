const MAX_SLUG_LEN = 80;

/**
 * Normaliza el nombre del negocio a un segmento de URL seguro (minúsculas, guiones).
 * Debe mantenerse alineado con la lógica de catálogo público en el producto.
 */
export function slugifyTenantCatalogSlug(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LEN);
  return base || "tienda";
}
