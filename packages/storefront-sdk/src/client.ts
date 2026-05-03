import type {
  Buyer,
  CartLine,
  CategoriesResponse,
  CheckoutResponse,
  FacetsResponse,
  OrderStatusResponse,
  ProductDetailResponse,
  ProductsFilters,
  ProductsResponse,
  StoreResponse,
} from "./types";

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

export class StorefrontApiError extends Error {
  /** Status HTTP devuelto por el dashboard. 0 si la request no llegó (network/DNS/CORS). */
  status: number;
  /** Body crudo si lo pudimos parsear. */
  body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = "StorefrontApiError";
    this.status = status;
    this.body = body;
  }
}

/** Crea un cliente bound a un tenant. La instancia es liviana, podés crearla en cada request server. */
export function createStorefrontClient(opts: StorefrontClientOptions) {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const slug = opts.slug;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const extraHeaders = opts.headers ?? {};

  async function request<T>(
    path: string,
    init: RequestInit & { searchParams?: Record<string, string | undefined> } = {}
  ): Promise<T> {
    const { searchParams, ...rest } = init;
    /** Siempre adjuntamos slug — todos los endpoints públicos lo exigen. */
    const params = new URLSearchParams({ slug });
    if (searchParams) {
      for (const [k, v] of Object.entries(searchParams)) {
        if (v != null && v !== "") params.set(k, v);
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
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* body no es JSON — lo dejamos null */
      }
      const message =
        (body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : null) ?? `HTTP ${res.status}`;
      throw new StorefrontApiError(message, res.status, body);
    }
    return (await res.json()) as T;
  }

  return {
    /** Marca, colores, hero, contacto, banners, productos destacados. Pintar la home con esto. */
    getStore(): Promise<StoreResponse> {
      return request<StoreResponse>("/store");
    },
    /** Lista plana de categorías activas. Reconstruir árbol con parentId. */
    getCategories(): Promise<CategoriesResponse> {
      return request<CategoriesResponse>("/categories");
    },
    /** Catálogo: una fila por variante en stock. Agrupar por productId para tarjetas. */
    getProducts(filters: ProductsFilters = {}): Promise<ProductsResponse> {
      return request<ProductsResponse>("/products", {
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
    getProduct(productId: string): Promise<ProductDetailResponse> {
      return request<ProductDetailResponse>(`/products/${encodeURIComponent(productId)}`);
    },
    /** Valores distintos para los filtros. */
    getFacets(opts: { categoryId?: string } = {}): Promise<FacetsResponse> {
      return request<FacetsResponse>("/facets", {
        searchParams: { categoryId: opts.categoryId },
      });
    },
    /** Inicia checkout: crea Order, reserva stock, devuelve link de Mercado Pago. */
    checkout(items: CartLine[], buyer: Buyer): Promise<CheckoutResponse> {
      return request<CheckoutResponse>("/checkout", {
        method: "POST",
        body: JSON.stringify({ slug, items, buyer }),
      });
    },
    /** Poll del estado de una Order (post-redirect de MP). No expone datos del comprador. */
    getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
      return request<OrderStatusResponse>(`/orders/${encodeURIComponent(orderId)}/status`);
    },
  };
}

export type StorefrontClient = ReturnType<typeof createStorefrontClient>;
