"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorefrontApiError = void 0;
exports.createStorefrontClient = createStorefrontClient;
class StorefrontApiError extends Error {
    /** Status HTTP devuelto por el dashboard. 0 si la request no llegó (network/DNS/CORS). */
    status;
    /** Body crudo si lo pudimos parsear. */
    body;
    constructor(message, status, body = null) {
        super(message);
        this.name = "StorefrontApiError";
        this.status = status;
        this.body = body;
    }
}
exports.StorefrontApiError = StorefrontApiError;
/** Crea un cliente bound a un tenant. La instancia es liviana, podés crearla en cada request server. */
function createStorefrontClient(opts) {
    const baseUrl = opts.baseUrl.replace(/\/$/, "");
    const slug = opts.slug;
    const doFetch = opts.fetch ?? globalThis.fetch;
    const extraHeaders = opts.headers ?? {};
    async function request(path, init = {}) {
        const { searchParams, ...rest } = init;
        /** Siempre adjuntamos slug — todos los endpoints públicos lo exigen. */
        const params = new URLSearchParams({ slug });
        if (searchParams) {
            for (const [k, v] of Object.entries(searchParams)) {
                if (v != null && v !== "")
                    params.set(k, v);
            }
        }
        const url = `${baseUrl}${path}?${params.toString()}`;
        const res = await doFetch(url, {
            ...rest,
            headers: {
                ...(rest.body ? { "Content-Type": "application/json" } : {}),
                ...extraHeaders,
                ...(rest.headers ?? {}),
            },
        });
        if (!res.ok) {
            let body = null;
            try {
                body = await res.json();
            }
            catch {
                /* body no es JSON — lo dejamos null */
            }
            const message = (body && typeof body === "object" && "message" in body
                ? String(body.message)
                : null) ?? `HTTP ${res.status}`;
            throw new StorefrontApiError(message, res.status, body);
        }
        return (await res.json());
    }
    return {
        /** Marca, colores, hero, contacto, banners, productos destacados. Pintar la home con esto. */
        getStore() {
            return request("/store");
        },
        /** Lista plana de categorías activas. Reconstruir árbol con parentId. */
        getCategories() {
            return request("/categories");
        },
        /** Catálogo: una fila por variante en stock. Agrupar por productId para tarjetas. */
        getProducts(filters = {}) {
            return request("/products", {
                searchParams: {
                    categoryId: filters.categoryId,
                    q: filters.q,
                    talle: filters.talle,
                    color: filters.color,
                    marca: filters.marca,
                },
            });
        },
        /** Detalle de un producto: todas las variantes activas + categorías. */
        getProduct(productId) {
            return request(`/products/${encodeURIComponent(productId)}`);
        },
        /** Valores distintos para los filtros. */
        getFacets(opts = {}) {
            return request("/facets", {
                searchParams: { categoryId: opts.categoryId },
            });
        },
        /** Inicia checkout: crea Order, reserva stock, devuelve link de Mercado Pago. */
        checkout(items, buyer) {
            return request("/checkout", {
                method: "POST",
                body: JSON.stringify({ slug, items, buyer }),
            });
        },
        /** Poll del estado de una Order (post-redirect de MP). No expone datos del comprador. */
        getOrderStatus(orderId) {
            return request(`/orders/${encodeURIComponent(orderId)}/status`);
        },
    };
}
