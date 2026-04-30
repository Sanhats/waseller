import { cache } from "react";
import { prisma } from "@waseller/db";

/**
 * Lookup del tenant por slug público, deduplicado dentro del mismo request.
 * Layout, page y catalogo lo llaman; React `cache()` evita el round-trip extra.
 */
export const getTenantBySlug = cache(async (slug: string) => {
  return prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: {
      id: true,
      name: true,
      storeConfig: { select: { config: true } },
    },
  });
});
