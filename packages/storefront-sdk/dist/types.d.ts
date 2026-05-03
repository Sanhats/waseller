/**
 * Tipos del shape que devuelve la API pública del dashboard.
 * Espejados de los handlers en `apps/dashboard/src/lib/api-gateway.ts`.
 *
 * IMPORTANTE: si cambia el shape del backend, actualizar acá. No usamos `import` desde
 * el dashboard a propósito — el storefront es independiente y debería poder consumir un
 * dashboard versionado distinto. Si rompemos contrato, bumpear major.
 */
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
    home?: {
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
export type StoreResponse = {
    tenantId: string;
    name: string;
    slug: string;
    storefrontBaseUrl: string | null;
    config: StoreConfig;
    configUpdatedAt: string | null;
};
export type Category = {
    id: string;
    parentId: string | null;
    name: string;
    slug: string;
    sortOrder: number;
};
export type CategoriesResponse = {
    categories: Category[];
};
/** Una variante en stock dentro del catálogo. El cliente agrupa por `productId` para tarjetas. */
export type CatalogVariantRow = {
    productId: string;
    name: string;
    effectivePrice: number;
    availableStock: number;
    imageUrl?: string | null;
    variantId: string;
    sku: string;
    variantTalle?: string | null;
    variantColor?: string | null;
    variantMarca?: string | null;
    attributes: Record<string, unknown>;
};
export type ProductsResponse = {
    variants: CatalogVariantRow[];
};
export type ProductDetailVariant = CatalogVariantRow & {
    basePrice: number;
    imageUrls: string[];
    tags: string[];
    variantPrice: number | null;
    isActive: boolean;
    variantImageUrls: string[];
    categoryIds: string[];
    categoryNames: string[];
    variantCategoryNames: string[];
};
export type ProductDetailResponse = {
    variants: ProductDetailVariant[];
    categories: Array<{
        id: string;
        name: string;
        slug: string;
    }>;
};
export type FacetsResponse = {
    talles: string[];
    colors: string[];
    marcas: string[];
};
export type ProductsFilters = {
    categoryId?: string;
    q?: string;
    talle?: string;
    color?: string;
    marca?: string;
};
export type CartLine = {
    variantId: string;
    quantity: number;
};
export type Buyer = {
    name: string;
    email: string;
    phone: string;
    notes?: string;
};
export type CheckoutResponse = {
    orderId: string;
    externalReference: string;
    checkoutUrl: string;
    totalAmount: number;
    currency: string;
};
export type OrderStatus = "pending_payment" | "paid" | "failed" | "cancelled" | "expired" | "fulfilled" | "refunded";
export type OrderStatusResponse = {
    orderId: string;
    status: OrderStatus;
    totalAmount: number;
    currency: string;
    paidAt: string | null;
    expiresAt: string | null;
    itemCount: number;
};
