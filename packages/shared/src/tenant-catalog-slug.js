"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugifyTenantCatalogSlug = slugifyTenantCatalogSlug;
const MAX_SLUG_LEN = 80;
/**
 * Normaliza el nombre del negocio a un segmento de URL seguro (minúsculas, guiones).
 * No garantiza unicidad global; usar reserva en BD para colisiones.
 */
function slugifyTenantCatalogSlug(name) {
    const base = name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAX_SLUG_LEN);
    return base || "tienda";
}
