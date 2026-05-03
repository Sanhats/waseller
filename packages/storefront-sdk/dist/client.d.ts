import type { Buyer, CartLine, CategoriesResponse, CheckoutResponse, FacetsResponse, OrderStatusResponse, ProductDetailResponse, ProductsFilters, ProductsResponse, StoreResponse } from "./types";
export type StorefrontClientOptions = {
    /** Base de la API pública del dashboard, ej: `https://dashboard.example.com/api/public`. Sin barra final. */
    baseUrl: string;
    /** Slug del tenant: `tenants.public_catalog_slug` en BD. */
    slug: string;
    /** Override opcional de fetch (Node, MSW, tests). Default: globalThis.fetch. */
    fetch?: typeof fetch;
    /** Headers extra agregados a cada request (raro — usalo si el dashboard exige algún token compartido). */
    headers?: Record<string, string>;
};
export declare class StorefrontApiError extends Error {
    /** Status HTTP devuelto por el dashboard. 0 si la request no llegó (network/DNS/CORS). */
    status: number;
    /** Body crudo si lo pudimos parsear. */
    body: unknown;
    constructor(message: string, status: number, body?: unknown);
}
/** Crea un cliente bound a un tenant. La instancia es liviana, podés crearla en cada request server. */
export declare function createStorefrontClient(opts: StorefrontClientOptions): {
    /** Marca, colores, hero, contacto, banners, productos destacados. Pintar la home con esto. */
    getStore(): Promise<StoreResponse>;
    /** Lista plana de categorías activas. Reconstruir árbol con parentId. */
    getCategories(): Promise<CategoriesResponse>;
    /** Catálogo: una fila por variante en stock. Agrupar por productId para tarjetas. */
    getProducts(filters?: ProductsFilters): Promise<ProductsResponse>;
    /** Detalle de un producto: todas las variantes activas + categorías. */
    getProduct(productId: string): Promise<ProductDetailResponse>;
    /** Valores distintos para los filtros. */
    getFacets(opts?: {
        categoryId?: string;
    }): Promise<FacetsResponse>;
    /** Inicia checkout: crea Order, reserva stock, devuelve link de Mercado Pago. */
    checkout(items: CartLine[], buyer: Buyer): Promise<CheckoutResponse>;
    /** Poll del estado de una Order (post-redirect de MP). No expone datos del comprador. */
    getOrderStatus(orderId: string): Promise<OrderStatusResponse>;
};
export type StorefrontClient = ReturnType<typeof createStorefrontClient>;
