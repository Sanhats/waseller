export type StoreConfig = {
  version: 1;
  brand: {
    storeName?: string;
    storeType?: "women" | "men" | "unisex" | "general";
    tagline?: string;
    description?: string;
    logoUrl?: string;
    faviconUrl?: string;
  };
  hero: {
    title?: string;
    subtitle?: string;
    backgroundImageUrl?: string;
    ctaText?: string;
    ctaLink?: string;
  };
  colors: {
    primary?: string;
    secondary?: string;
    background?: string;
    surface?: string;
    textPrimary?: string;
    textSecondary?: string;
    border?: string;
  };
  typography: {
    headingFont?: string;
    bodyFont?: string;
  };
  contact: {
    aboutText?: string;
    email?: string;
    phone?: string;
    instagram?: string;
    facebook?: string;
    tiktok?: string;
    pinterest?: string;
  };
  uiTexts: {
    searchPlaceholder?: string;
    currencySymbol?: string;
    newBadge?: string;
    saleBadge?: string;
    filterText?: string;
  };
  featured: {
    newProductIds: string[];
    saleProductIds: string[];
  };
  /** Bloques editables de la home pública (p. ej. categorías con imagen). */
  home?: {
    /** Hasta 6 entradas en orden; vacío = la tienda usa categorías raíz por defecto. */
    categoryShowcase?: Array<{
      categoryId?: string;
      imageUrl?: string;
    }>;
  };
  banners?: Array<{
    title?: string;
    subtitle?: string;
    backgroundImageUrl?: string;
    ctaText?: string;
    ctaLink?: string;
  }>;
};

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  version: 1,
  brand: {},
  hero: {},
  colors: {},
  typography: {},
  contact: {},
  uiTexts: {},
  featured: { newProductIds: [], saleProductIds: [] },
  home: { categoryShowcase: [] }
};

export function normalizeStoreConfig(raw: unknown): StoreConfig {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const brand = (input.brand && typeof input.brand === "object" ? input.brand : {}) as Record<string, unknown>;
  const hero = (input.hero && typeof input.hero === "object" ? input.hero : {}) as Record<string, unknown>;
  const colors = (input.colors && typeof input.colors === "object" ? input.colors : {}) as Record<string, unknown>;
  const typography = (input.typography && typeof input.typography === "object" ? input.typography : {}) as Record<string, unknown>;
  const contact = (input.contact && typeof input.contact === "object" ? input.contact : {}) as Record<string, unknown>;
  const uiTexts = (input.uiTexts && typeof input.uiTexts === "object" ? input.uiTexts : {}) as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const storeTypeRaw = String(brand.storeType ?? "").toLowerCase();
  const storeType = (["women", "men", "unisex", "general"].includes(storeTypeRaw) ? storeTypeRaw : undefined) as
    | "women"
    | "men"
    | "unisex"
    | "general"
    | undefined;

  const rawBanners = Array.isArray(input.banners) ? input.banners : [];
  const banners = rawBanners
    .filter((b): b is Record<string, unknown> => b !== null && typeof b === "object")
    .map((b) => ({
      title: str(b.title),
      subtitle: str(b.subtitle),
      backgroundImageUrl: str(b.backgroundImageUrl),
      ctaText: str(b.ctaText),
      ctaLink: str(b.ctaLink)
    }));

  const homeIn = input.home && typeof input.home === "object" ? (input.home as Record<string, unknown>) : {};
  const rawShowcase = Array.isArray(homeIn.categoryShowcase) ? homeIn.categoryShowcase : [];
  const categoryShowcase = rawShowcase
    .slice(0, 6)
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
    .map((row) => {
      const cid = str(row.categoryId);
      const iu = str(row.imageUrl);
      const o: { categoryId?: string; imageUrl?: string } = {};
      if (cid) o.categoryId = cid;
      if (iu) o.imageUrl = iu;
      return o;
    })
    .filter((row) => row.categoryId);

  return {
    version: 1,
    brand: {
      storeName: str(brand.storeName),
      storeType,
      tagline: str(brand.tagline),
      description: str(brand.description),
      logoUrl: str(brand.logoUrl),
      faviconUrl: str(brand.faviconUrl)
    },
    hero: {
      title: str(hero.title),
      subtitle: str(hero.subtitle),
      backgroundImageUrl: str(hero.backgroundImageUrl),
      ctaText: str(hero.ctaText),
      ctaLink: str(hero.ctaLink)
    },
    colors: {
      primary: str(colors.primary),
      secondary: str(colors.secondary),
      background: str(colors.background),
      surface: str(colors.surface),
      textPrimary: str(colors.textPrimary),
      textSecondary: str(colors.textSecondary),
      border: str(colors.border)
    },
    typography: {
      headingFont: str(typography.headingFont),
      bodyFont: str(typography.bodyFont)
    },
    contact: {
      aboutText: str(contact.aboutText),
      email: str(contact.email),
      phone: str(contact.phone),
      instagram: str(contact.instagram),
      facebook: str(contact.facebook),
      tiktok: str(contact.tiktok),
      pinterest: str(contact.pinterest)
    },
    uiTexts: {
      searchPlaceholder: str(uiTexts.searchPlaceholder),
      currencySymbol: str(uiTexts.currencySymbol),
      newBadge: str(uiTexts.newBadge),
      saleBadge: str(uiTexts.saleBadge),
      filterText: str(uiTexts.filterText)
    },
    featured: (() => {
      const f = input.featured && typeof input.featured === "object"
        ? (input.featured as Record<string, unknown>)
        : {};
      const toIds = (v: unknown) =>
        Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
      return {
        newProductIds: toIds(f.newProductIds),
        saleProductIds: toIds(f.saleProductIds)
      };
    })(),
    home:
      categoryShowcase.length > 0
        ? { categoryShowcase }
        : homeIn && Object.keys(homeIn).length > 0
          ? { categoryShowcase: [] }
          : undefined,
    banners: banners.length > 0 ? banners : undefined
  };
}
