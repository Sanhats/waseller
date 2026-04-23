/**
 * Normaliza el nombre del negocio a un segmento de URL seguro (minúsculas, guiones).
 * No garantiza unicidad global; usar reserva en BD para colisiones.
 */
export declare function slugifyTenantCatalogSlug(name: string): string;
