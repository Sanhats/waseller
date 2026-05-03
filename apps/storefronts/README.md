# Storefronts

Carpeta donde vive **una tienda pública por cliente**. Cada subcarpeta es un proyecto Next.js independiente que consume la API pública del dashboard (`/api/public/*`) vía `@waseller/storefront-sdk`.

```
apps/storefronts/
  _template/        # punto de partida copiable (NO modificar — sirve para clonar)
  cliente1/         # tienda real, totalmente custom
  cliente2/
  ...
```

## Crear una tienda nueva (paso a paso)

### 1. Copiar el template

```bash
cp -r apps/storefronts/_template apps/storefronts/<nombre-cliente>
```

Editá `apps/storefronts/<nombre-cliente>/package.json`:

```json
{
  "name": "@waseller/storefront-<nombre-cliente>",
  ...
}
```

### 2. Instalar deps desde el root

```bash
npm install
```

(npm va a linkear automáticamente `@waseller/storefront-sdk` por workspaces.)

### 3. Configurar env vars

```bash
cp apps/storefronts/<nombre-cliente>/.env.example apps/storefronts/<nombre-cliente>/.env.local
```

Editá `.env.local`:

```
NEXT_PUBLIC_API_BASE=http://localhost:3000/api/public
NEXT_PUBLIC_TENANT_SLUG=el-slug-del-cliente-en-bd
```

### 4. Levantar en dev

En una terminal el dashboard:
```bash
npm run dev --workspace @waseller/dashboard    # corre en :3000
```

En otra terminal el storefront:
```bash
cd apps/storefronts/<nombre-cliente>
npx next dev -p 3001                             # cualquier puerto distinto a 3000
```

Abrí `http://localhost:3001` y deberías ver la home con los productos del tenant.

### 5. Personalizar el diseño

El template viene con HTML semántico mínimo y estilos inline. Adaptá libremente:

- **Layout y navbar**: `src/components/navbar.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- **Home**: `src/app/page.tsx`
- **Catálogo**: `src/app/catalogo/page.tsx`
- **Producto**: `src/app/p/[productId]/page.tsx`
- **Carrito**: `src/app/carrito/page.tsx`
- **Checkout**: `src/app/checkout/page.tsx` y subpaths `exito/`, `fracaso/`, `pendiente/`

Todo el wiring con la API ya está hecho. Si solo querés cambiar diseño, no hace falta tocar `src/lib/`.

Si querés sumar Tailwind, shadcn, framer-motion, lo que sea: instalalo en el `package.json` del cliente (no en el template).

### 6. Deploy en Vercel

1. **New Project** en Vercel → importar el mismo repo del monorepo.
2. **Root Directory**: `apps/storefronts/<nombre-cliente>`
3. **Framework Preset**: Next.js (autodetecta)
4. **Environment Variables**: copiar `NEXT_PUBLIC_API_BASE` y `NEXT_PUBLIC_TENANT_SLUG` a Production. `NEXT_PUBLIC_API_BASE` debe apuntar al dashboard en prod (ej: `https://dashboard.waseller.com/api/public`).
5. Asignar dominio custom del cliente (ej: `cliente1.com`).

### 7. Asociar el dominio al tenant en BD

En **Supabase → SQL Editor**:

```sql
UPDATE tenants
SET storefront_base_url = 'https://cliente1.com'
WHERE public_catalog_slug = '<el-slug-del-cliente>';
```

Esto le dice al backend que las `back_urls` de Mercado Pago deben volver al dominio de la tienda y no al del dashboard.

### 8. Habilitar CORS para el dominio

En **Vercel → Project (dashboard) → Settings → Environment Variables**, editá:

```
PUBLIC_STOREFRONT_ALLOWED_ORIGINS=https://cliente1.com,https://cliente2.com,...
```

Añadí el nuevo origin a la lista (CSV). Hacé **Redeploy** del dashboard para que tome la env.

### 9. Verificar end-to-end

1. Abrir `https://cliente1.com` → catálogo carga
2. Agregar al carrito → ir a checkout
3. Completar form → "Pagar con Mercado Pago"
4. Pagar con tarjeta de prueba MP
5. Volver a `cliente1.com/checkout/exito?order_id=...` → status `paid`
6. En dashboard → **Ventas** → la orden aparece con la información del comprador

## Sobre el SDK

`@waseller/storefront-sdk` (en `packages/storefront-sdk/`) expone:

- Tipos TypeScript del shape del API público
- `createStorefrontClient({ baseUrl, slug })` con métodos: `getStore`, `getCategories`, `getProducts`, `getProduct`, `getFacets`, `checkout`, `getOrderStatus`
- Clase `StorefrontApiError` para distinguir errores de la API (status, body)

Documentación de cada endpoint y shape: ver `docs/public-api.md` en el root del repo.

## Por qué no compartimos componentes en el SDK

A propósito. Cada storefront tiene libertad total de diseño/UI/CSS framework. Lo único compartido es el contrato API (tipos + cliente). Si una sección termina siendo idéntica en N tiendas (ej. carrito), después la extraemos como `@waseller/storefront-ui` — pero hasta que no haya 3+ implementaciones, evitamos abstracciones prematuras.
