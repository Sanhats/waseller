# Public Storefront API

API pública (sin JWT) para que un storefront externo consuma el catálogo, configuración de marca y checkout de un tenant.

Base URL: `https://<dashboard-domain>/api/public`

Todos los endpoints reciben `?slug=<publicCatalogSlug>` para resolver el tenant. Si el slug no existe, devuelven 404.

## CORS

CORS solo se aplica si el origin del request matchea con `PUBLIC_STOREFRONT_ALLOWED_ORIGINS` (CSV en env). Sin esa env var, las llamadas desde otros dominios fallan con CORS error en el browser.

```
PUBLIC_STOREFRONT_ALLOWED_ORIGINS=https://cliente1.com,https://cliente2.com
```

## Rate limit

Todos los endpoints públicos tienen rate limit por IP (Redis fixed-window):

| Endpoint | Limite |
|---|---|
| `GET /public/*` | **120 req/min por IP** |
| `POST /public/checkout` | **10 req/min por IP** |

Cuando se excede, responde `429` con headers `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`. El bucket de checkout es independiente del de lectura — un scraper no puede consumir el budget del checkout y viceversa.

Si Redis no está disponible, el rate limit hace **fail-open** (deja pasar) para no romper el endpoint. Conviene monitorear el log `[rate-limit] Redis no disponible` en Vercel.

## Multi-dominio (un storefront por cliente)

Para soportar `cliente1.com`, `cliente2.com`, etc. cada uno con su propio storefront:

1. Setear `tenants.storefront_base_url` en BD para cada tenant (ej: `https://cliente1.com`).
2. `PUBLIC_STOREFRONT_BASE_URL` en env queda como **fallback global** para tenants sin override.
3. El backend prioriza el campo del tenant al armar las `back_urls` de Mercado Pago.

El campo se expone en `GET /public/store` para que el storefront sepa su propio origen (útil para self-links / canonical URLs).

## Endpoints

### `GET /public/store?slug=<slug>`

Datos del tenant + storeConfig normalizado (marca, colores, hero, contacto, etc.).

**Response 200**:
```json
{
  "tenantId": "uuid",
  "name": "Tienda X",
  "slug": "tienda-x",
  "storefrontBaseUrl": "https://tienda-x.com",
  "config": {
    "version": 1,
    "brand": { "storeName": "...", "logoUrl": "..." },
    "hero": { "title": "...", "backgroundImageUrl": "..." },
    "colors": { "primary": "#...", "secondary": "#..." },
    "typography": { "headingFont": "...", "bodyFont": "..." },
    "contact": { "email": "...", "phone": "...", "instagram": "..." },
    "uiTexts": { "newBadge": "Nuevo", "saleBadge": "Oferta", "..." },
    "featured": { "newProductIds": [], "saleProductIds": [] },
    "home": { "categoryShowcase": [{ "categoryId": "uuid", "imageUrl": "..." }] },
    "banners": [{ "title": "...", "backgroundImageUrl": "...", "ctaLink": "..." }]
  },
  "configUpdatedAt": "ISO8601"
}
```

Shape completo del `config` está en `packages/shared/src/store-config.ts` (tipo `StoreConfig`).

### `GET /public/categories?slug=<slug>`

Lista plana de categorías activas (con `parentId` para reconstruir el árbol del lado del cliente).

**Response 200**:
```json
{
  "categories": [
    { "id": "uuid", "parentId": null, "name": "Mujer", "slug": "mujer", "sortOrder": 0 },
    { "id": "uuid", "parentId": "uuid", "name": "Vestidos", "slug": "vestidos", "sortOrder": 0 }
  ]
}
```

### `GET /public/products?slug=<slug>&[categoryId]&[q]&[talle]&[color]&[marca]`

Catálogo filtrado. Devuelve **una fila por variante en stock**, no agrupado. El cliente agrupa por `productId` para mostrar tarjetas.

**Query params (todos opcionales)**:
- `categoryId`: UUID, incluye descendientes
- `q`: búsqueda full-text por nombre/sku
- `talle`, `color`, `marca`: facetas exactas

**Response 200**:
```json
{
  "variants": [
    {
      "productId": "uuid",
      "name": "Vestido Lyon",
      "effectivePrice": 18000,
      "availableStock": 3,
      "imageUrl": "https://...",
      "variantId": "uuid",
      "sku": "VL-M-NEG",
      "variantTalle": "M",
      "variantColor": "Negro",
      "variantMarca": null,
      "attributes": {}
    }
  ]
}
```

### `GET /public/products/:productId?slug=<slug>`

Detalle de un producto: todas sus variantes activas + categorías asociadas.

**Response 200**:
```json
{
  "variants": [
    {
      "productId": "uuid",
      "name": "Vestido Lyon",
      "basePrice": 18000,
      "imageUrls": ["..."],
      "tags": ["..."],
      "variantId": "uuid",
      "sku": "VL-M-NEG",
      "attributes": {},
      "variantTalle": "M",
      "variantColor": "Negro",
      "variantMarca": null,
      "variantPrice": null,
      "effectivePrice": 18000,
      "availableStock": 3,
      "isActive": true,
      "variantImageUrls": ["..."],
      "categoryIds": ["uuid"],
      "categoryNames": ["Vestidos"],
      "variantCategoryNames": []
    }
  ],
  "categories": [
    { "id": "uuid", "name": "Vestidos", "slug": "vestidos" }
  ]
}
```

**Response 404**: producto no existe o no tiene variantes activas.

### `GET /public/facets?slug=<slug>&[categoryId]`

Valores distintos de `talle`, `color`, `marca` para armar selects de filtros. Solo incluye variantes con stock disponible.

**Response 200**:
```json
{
  "talles": ["S", "M", "L"],
  "colors": ["Negro", "Blanco"],
  "marcas": ["Nike"]
}
```

### `POST /public/checkout`

Crea una Order pendiente, reserva stock y devuelve un link de Mercado Pago.

**Body**:
```json
{
  "slug": "tienda-x",
  "items": [
    { "variantId": "uuid", "quantity": 2 }
  ],
  "buyer": {
    "name": "Juana Pérez",
    "email": "juana@mail.com",
    "phone": "+5491123456789",
    "notes": "Departamento 4B, timbre roto"
  }
}
```

**Response 200**:
```json
{
  "orderId": "uuid",
  "externalReference": "ws-order-...",
  "checkoutUrl": "https://www.mercadopago.com/...",
  "totalAmount": 36000,
  "currency": "ARS"
}
```

El cliente redirige al `checkoutUrl`. Las `back_urls` que MP usará al volver están definidas server-side via `PUBLIC_STOREFRONT_BASE_URL` y apuntan a `/tienda/<slug>/checkout/exito|fracaso|pendiente?order_id=<orderId>`.

**⚠️ IMPORTANTE**: si el storefront vive en un dominio distinto al dashboard, hay que adaptar `PUBLIC_STOREFRONT_BASE_URL` al dominio del storefront, **no** al del dashboard. Si no, MP redirige a una URL que no existe en el storefront del cliente.

**Errores**:
- 400: items vacíos, buyer inválido, sin stock, MP no configurado para el tenant
- 404: slug no existe
- 503: Redis no disponible (no se pudo encolar TTL → se cancela y se libera stock)

### `GET /public/orders/:orderId/status?slug=<slug>`

Poll del estado de una Order (lo usan las páginas success/failure/pending después del retorno de MP).

**Response 200**:
```json
{
  "orderId": "uuid",
  "status": "pending_payment | paid | failed | cancelled | expired | fulfilled | refunded",
  "totalAmount": 36000,
  "currency": "ARS",
  "paidAt": "ISO8601 | null",
  "expiresAt": "ISO8601 | null",
  "itemCount": 2
}
```

**No expone** datos del comprador para evitar enumeración.

## Notas para integradores

- **Stock**: `availableStock` puede cambiar entre el momento que listás productos y el checkout. El POST `/public/checkout` valida stock atómicamente y devuelve 400 si una línea no alcanza.
- **Imágenes**: los `imageUrl` son públicos (Supabase Storage). Pueden ser `null` o vacíos.
- **Precios**: `effectivePrice` ya tiene aplicado el override de variante sobre el precio base del producto. Vienen como `Number` en ARS sin decimales.
- **TTL del carrito**: 15 minutos por default. Si el comprador no completa el pago, la Order pasa a `expired` y el stock se libera.
