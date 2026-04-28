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
        /** Hasta 3 entradas en orden; vacío = la tienda usa categorías raíz por defecto. */
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
export declare const DEFAULT_STORE_CONFIG: StoreConfig;
export declare function normalizeStoreConfig(raw: unknown): StoreConfig;
