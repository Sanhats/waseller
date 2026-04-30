"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_STORE_CONFIG = void 0;
exports.normalizeStoreConfig = normalizeStoreConfig;
exports.DEFAULT_STORE_CONFIG = {
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
function normalizeStoreConfig(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    const brand = (input.brand && typeof input.brand === "object" ? input.brand : {});
    const hero = (input.hero && typeof input.hero === "object" ? input.hero : {});
    const colors = (input.colors && typeof input.colors === "object" ? input.colors : {});
    const typography = (input.typography && typeof input.typography === "object" ? input.typography : {});
    const contact = (input.contact && typeof input.contact === "object" ? input.contact : {});
    const uiTexts = (input.uiTexts && typeof input.uiTexts === "object" ? input.uiTexts : {});
    const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const storeTypeRaw = String(brand.storeType ?? "").toLowerCase();
    const storeType = (["women", "men", "unisex", "general"].includes(storeTypeRaw) ? storeTypeRaw : undefined);
    const rawBanners = Array.isArray(input.banners) ? input.banners : [];
    const banners = rawBanners
        .filter((b) => b !== null && typeof b === "object")
        .map((b) => ({
        title: str(b.title),
        subtitle: str(b.subtitle),
        backgroundImageUrl: str(b.backgroundImageUrl),
        ctaText: str(b.ctaText),
        ctaLink: str(b.ctaLink)
    }));
    const homeIn = input.home && typeof input.home === "object" ? input.home : {};
    const rawShowcase = Array.isArray(homeIn.categoryShowcase) ? homeIn.categoryShowcase : [];
    const categoryShowcase = rawShowcase
        .slice(0, 6)
        .filter((x) => x !== null && typeof x === "object")
        .map((row) => {
        const cid = str(row.categoryId);
        const iu = str(row.imageUrl);
        const o = {};
        if (cid)
            o.categoryId = cid;
        if (iu)
            o.imageUrl = iu;
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
                ? input.featured
                : {};
            const toIds = (v) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
            return {
                newProductIds: toIds(f.newProductIds),
                saleProductIds: toIds(f.saleProductIds)
            };
        })(),
        home: categoryShowcase.length > 0
            ? { categoryShowcase }
            : homeIn && Object.keys(homeIn).length > 0
                ? { categoryShowcase: [] }
                : undefined,
        banners: banners.length > 0 ? banners : undefined
    };
}
