import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { prisma } from "../../../../../packages/db/src";

type VariantAttributes = Record<string, string>;

type ProductVariantInput = {
  sku: string;
  attributes: VariantAttributes;
  stock: number;
  price?: number | null;
  isActive?: boolean;
  imageUrls?: string[];
};

type ProductCreateInput = {
  name: string;
  price: number;
  imageUrl?: string;
  imageUrls?: string[];
  tags?: string[];
  variants: ProductVariantInput[];
};

type ProductVariantRow = {
  variantId: string;
  productId: string;
  name: string;
  basePrice: unknown;
  variantPrice: unknown;
  effectivePrice: number;
  sku: string;
  attributes: VariantAttributes;
  stock: number;
  reservedStock: number;
  availableStock: number;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  variantImageUrls?: string[] | null;
  tags: string[];
  isActive: boolean;
};

function readNumericEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeImageUrls(input: unknown, opts: { maxItems: number; maxChars: number }): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (out.length >= opts.maxItems) break;
    const s = String(item ?? "").trim();
    if (!s) continue;
    if (s.length > opts.maxChars) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function resolvePrimaryImageUrl(candidate: { imageUrl?: unknown; imageUrls?: unknown }): string | undefined {
  const explicit = typeof candidate.imageUrl === "string" ? candidate.imageUrl.trim() : "";
  if (explicit) return explicit;
  if (Array.isArray(candidate.imageUrls) && candidate.imageUrls.length > 0) {
    const first = String(candidate.imageUrls[0] ?? "").trim();
    if (first) return first;
  }
  return undefined;
}

const normalizeAttributes = (raw: unknown): VariantAttributes => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  return Object.fromEntries(entries);
};

const normalizeVariant = (input: ProductVariantInput): ProductVariantInput | null => {
  const sku = String(input.sku ?? "").trim();
  if (!sku) return null;
  const maxVariantImages = readNumericEnv("VARIANT_MAX_IMAGE_UPLOADS", 6);
  const maxVariantChars = readNumericEnv("VARIANT_IMAGE_MAX_CHARS", 220_000);
  return {
    sku,
    attributes: normalizeAttributes(input.attributes),
    stock: Math.max(0, Number(input.stock ?? 0)),
    price: input.price === null || input.price === undefined ? null : Math.max(0, Number(input.price)),
    isActive: input.isActive !== false,
    imageUrls: normalizeImageUrls(input.imageUrls, { maxItems: maxVariantImages, maxChars: maxVariantChars })
  };
};

const normalizeCreatePayload = (body: {
  name: string;
  price: number;
  imageUrl?: string;
  imageUrls?: string[];
  tags?: string[];
  variants?: ProductVariantInput[];
}): ProductCreateInput => {
  const maxProductImages = readNumericEnv("PRODUCT_MAX_IMAGE_UPLOADS", 10);
  const maxProductChars = readNumericEnv("PRODUCT_IMAGE_MAX_CHARS", 220_000);
  const variants = Array.isArray(body.variants) ? body.variants.map(normalizeVariant).filter(Boolean) : [];
  const sanitizedVariants = variants as ProductVariantInput[];
  const fallbackSku = `SKU-${Date.now()}`;
  const normalizedImageUrls = normalizeImageUrls(body.imageUrls, { maxItems: maxProductImages, maxChars: maxProductChars });
  const imageUrl = resolvePrimaryImageUrl({ imageUrl: body.imageUrl, imageUrls: normalizedImageUrls }) || undefined;
  return {
    name: String(body.name ?? "").trim(),
    price: Math.max(0, Number(body.price ?? 0)),
    imageUrl,
    imageUrls: normalizedImageUrls,
    tags: Array.isArray(body.tags) ? body.tags.map((item) => String(item ?? "").trim()).filter(Boolean) : [],
    variants:
      sanitizedVariants.length > 0
        ? sanitizedVariants
        : [
            {
              sku: fallbackSku,
              attributes: {},
              stock: 0,
              price: null,
              isActive: true,
              imageUrls: []
            }
          ]
  };
};

@Injectable()
export class ProductsService {
  async listByTenant(tenantId: string): Promise<
    ProductVariantRow[]
  > {
    const rows = (await (prisma as any).$queryRaw`
      select
        v.id as "variantId",
        p.id as "productId",
        p.name as "name",
        p.price as "basePrice",
        v.price as "variantPrice",
        coalesce(v.price, p.price) as "effectivePrice",
        v.sku as "sku",
        v.attributes as "attributes",
        v.stock as "stock",
        v.reserved_stock as "reservedStock",
        greatest(v.stock - v.reserved_stock, 0) as "availableStock",
        p.image_url as "imageUrl",
        p.image_urls as "imageUrls",
        v.image_urls as "variantImageUrls",
        p.tags as "tags",
        v.is_active as "isActive"
      from public.product_variants v
      inner join public.products p on p.id = v.product_id
      where v.tenant_id::text = ${tenantId}
      order by p.updated_at desc, p.name asc, v.sku asc
    `) as Array<{
      variantId: string;
      productId: string;
      name: string;
      basePrice: unknown;
      variantPrice: unknown;
      effectivePrice: unknown;
      sku: string;
      attributes: unknown;
      stock: number;
      reservedStock: number;
      availableStock: number;
      imageUrl?: string | null;
      imageUrls?: string[] | null;
      variantImageUrls?: string[] | null;
      tags?: string[] | null;
      isActive: boolean;
    }>;
    return rows.map((row) => ({
      variantId: row.variantId,
      productId: row.productId,
      name: row.name,
      basePrice: row.basePrice,
      variantPrice: row.variantPrice,
      effectivePrice: Number(row.effectivePrice ?? 0),
      sku: row.sku,
      attributes: normalizeAttributes(row.attributes),
      stock: Number(row.stock ?? 0),
      reservedStock: Number(row.reservedStock ?? 0),
      availableStock: Number(row.availableStock ?? 0),
      imageUrl:
        row.variantImageUrls?.[0] ||
        row.imageUrls?.[0] ||
        row.imageUrl,
      imageUrls: Array.isArray(row.imageUrls) ? row.imageUrls : [],
      variantImageUrls: Array.isArray(row.variantImageUrls) ? row.variantImageUrls : [],
      tags: Array.isArray(row.tags) ? row.tags : [],
      isActive: Boolean(row.isActive)
    }));
  }

  /** Catálogo público: solo variantes activas (sin JWT en el consumidor de la página). */
  async listPublicCatalogByTenant(tenantId: string): Promise<ProductVariantRow[]> {
    const rows = (await (prisma as any).$queryRaw`
      select
        v.id as "variantId",
        p.id as "productId",
        p.name as "name",
        p.price as "basePrice",
        v.price as "variantPrice",
        coalesce(v.price, p.price) as "effectivePrice",
        v.sku as "sku",
        v.attributes as "attributes",
        v.stock as "stock",
        v.reserved_stock as "reservedStock",
        greatest(v.stock - v.reserved_stock, 0) as "availableStock",
        p.image_url as "imageUrl",
        p.image_urls as "imageUrls",
        v.image_urls as "variantImageUrls",
        p.tags as "tags",
        v.is_active as "isActive"
      from public.product_variants v
      inner join public.products p on p.id = v.product_id
      where v.tenant_id::text = ${tenantId}
        and v.is_active = true
      order by p.updated_at desc, p.name asc, v.sku asc
    `) as Array<{
      variantId: string;
      productId: string;
      name: string;
      basePrice: unknown;
      variantPrice: unknown;
      effectivePrice: unknown;
      sku: string;
      attributes: unknown;
      stock: number;
      reservedStock: number;
      availableStock: number;
      imageUrl?: string | null;
      imageUrls?: string[] | null;
      variantImageUrls?: string[] | null;
      tags?: string[] | null;
      isActive: boolean;
    }>;
    return rows.map((row) => ({
      variantId: row.variantId,
      productId: row.productId,
      name: row.name,
      basePrice: row.basePrice,
      variantPrice: row.variantPrice,
      effectivePrice: Number(row.effectivePrice ?? 0),
      sku: row.sku,
      attributes: normalizeAttributes(row.attributes),
      stock: Number(row.stock ?? 0),
      reservedStock: Number(row.reservedStock ?? 0),
      availableStock: Number(row.availableStock ?? 0),
      imageUrl:
        row.variantImageUrls?.[0] ||
        row.imageUrls?.[0] ||
        row.imageUrl,
      imageUrls: Array.isArray(row.imageUrls) ? row.imageUrls : [],
      variantImageUrls: Array.isArray(row.variantImageUrls) ? row.variantImageUrls : [],
      tags: Array.isArray(row.tags) ? row.tags : [],
      isActive: Boolean(row.isActive)
    }));
  }

  /** Detalle público del producto: variantes activas del mismo `productId` (sin JWT). */
  async getPublicProductDetailsByTenant(
    tenantId: string,
    productId: string
  ): Promise<
    Array<{
      productId: string;
      name: string;
      basePrice: number;
      imageUrls: string[];
      tags: string[];
      variantId: string;
      sku: string;
      attributes: Record<string, string>;
      variantPrice: number | null;
      effectivePrice: number;
      availableStock: number;
      isActive: boolean;
      variantImageUrls: string[];
    }>
  > {
    const pid = String(productId ?? "").trim();
    if (!pid) return [];
    const rows = (await (prisma as any).$queryRaw`
      select
        p.id as "productId",
        p.name as "name",
        p.price as "basePrice",
        p.image_urls as "imageUrls",
        p.tags as "tags",
        v.id as "variantId",
        v.sku as "sku",
        v.attributes as "attributes",
        v.price as "variantPrice",
        coalesce(v.price, p.price) as "effectivePrice",
        greatest(v.stock - v.reserved_stock, 0) as "availableStock",
        v.is_active as "isActive",
        v.image_urls as "variantImageUrls"
      from public.product_variants v
      inner join public.products p on p.id = v.product_id
      where v.tenant_id::text = ${tenantId}
        and p.id::text = ${pid}
        and v.is_active = true
      order by v.sku asc
    `) as Array<{
      productId: string;
      name: string;
      basePrice: unknown;
      imageUrls?: string[] | null;
      tags?: string[] | null;
      variantId: string;
      sku: string;
      attributes: unknown;
      variantPrice: unknown;
      effectivePrice: unknown;
      availableStock: number;
      isActive: boolean;
      variantImageUrls?: string[] | null;
    }>;

    return rows.map((r) => ({
      productId: r.productId,
      name: String(r.name ?? ""),
      basePrice: Number(r.basePrice ?? 0),
      imageUrls: Array.isArray(r.imageUrls) ? r.imageUrls : [],
      tags: Array.isArray(r.tags) ? r.tags : [],
      variantId: r.variantId,
      sku: String(r.sku ?? ""),
      attributes: normalizeAttributes(r.attributes),
      variantPrice: r.variantPrice == null ? null : Number(r.variantPrice),
      effectivePrice: Number(r.effectivePrice ?? 0),
      availableStock: Number(r.availableStock ?? 0),
      isActive: Boolean(r.isActive),
      variantImageUrls: Array.isArray(r.variantImageUrls) ? r.variantImageUrls : []
    }));
  }

  async createProduct(
    tenantId: string,
    body: {
      name: string;
      price: number;
      imageUrl?: string;
      imageUrls?: string[];
      tags?: string[];
      variants?: ProductVariantInput[];
    }
  ): Promise<unknown> {
    const payload = normalizeCreatePayload(body);
    return prisma.$transaction(async (tx: any) => {
      const product = await tx.product.create({
        data: {
          tenantId,
          name: payload.name,
          price: payload.price,
          imageUrl: payload.imageUrl,
          imageUrls: payload.imageUrls ?? [],
          tags: payload.tags
        }
      });

      const createdVariants: Array<{ id: string; sku: string; stock: number }> = [];
      for (const variant of payload.variants) {
        const created = await tx.productVariant.create({
          data: {
            tenantId,
            productId: product.id,
            sku: variant.sku,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            attributes: variant.attributes as any,
            price: variant.price === null || variant.price === undefined ? null : variant.price,
            stock: variant.stock,
            reservedStock: 0,
            isActive: variant.isActive !== false,
            imageUrls: variant.imageUrls ?? []
          }
        });
        createdVariants.push({ id: created.id, sku: created.sku, stock: created.stock });
        if (Number(created.stock) > 0) {
          await tx.stockMovement.create({
            data: {
              tenantId,
              productId: product.id,
              variantId: created.id,
              movementType: "manual_adjust",
              deltaStock: Number(created.stock),
              deltaReserved: 0,
              reason: "initial_variant_stock_on_creation",
              source: "api_products_create"
            }
          });
        }
      }

      return {
        ...product,
        variants: createdVariants
      };
    });
  }

  async addVariant(
    tenantId: string,
    productId: string,
    body: {
      sku: string;
      attributes: Record<string, string>;
      stock: number;
      price?: number | null;
      isActive?: boolean;
      imageUrls?: string[];
    }
  ): Promise<unknown> {
    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId }
    });
    if (!product) return null;

    const normalized = normalizeVariant({
      sku: body.sku,
      attributes: body.attributes,
      stock: body.stock,
      price: body.price,
      isActive: body.isActive,
      imageUrls: body.imageUrls
    });
    if (!normalized) {
      throw new BadRequestException("Datos de variante incompletos o SKU vacío");
    }

    const clash = await prisma.productVariant.findFirst({
      where: { tenantId, sku: normalized.sku }
    });
    if (clash) {
      throw new ConflictException("Ese SKU ya lo usa otra variante");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return prisma.$transaction(async (tx: any) => {
      const created = await tx.productVariant.create({
        data: {
          tenantId,
          productId,
          sku: normalized.sku,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          attributes: normalized.attributes as any,
          price: normalized.price === null ? null : normalized.price,
          stock: normalized.stock,
          reservedStock: 0,
          isActive: normalized.isActive !== false,
          imageUrls: normalized.imageUrls ?? []
        }
      });
      if (Number(created.stock) > 0) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId,
            variantId: created.id,
            movementType: "manual_adjust",
            deltaStock: Number(created.stock),
            deltaReserved: 0,
            reason: "initial_variant_stock_on_creation",
            source: "api_products_add_variant"
          }
        });
      }
      return { id: created.id, sku: created.sku, stock: created.stock };
    });
  }

  async updateProduct(
    tenantId: string,
    productId: string,
    body: { name?: string; price?: number; imageUrl?: string | null; imageUrls?: string[] | null; tags?: string[] }
  ): Promise<{ ok: true } | null> {
    const existing = await prisma.product.findFirst({
      where: { id: productId, tenantId }
    });
    if (!existing) return null;

    const hasAny =
      typeof body.name === "string" ||
      typeof body.price === "number" ||
      body.imageUrl !== undefined ||
      body.imageUrls !== undefined ||
      Array.isArray(body.tags);
    if (!hasAny) return { ok: true };

    const nextName = typeof body.name === "string" ? String(body.name).trim() : existing.name;
    if (nextName.length === 0) throw new BadRequestException("El nombre no puede quedar vacío");

    if (nextName !== existing.name) {
      const clash = await prisma.product.findFirst({
        where: { tenantId, name: nextName, NOT: { id: productId } }
      });
      if (clash) {
        throw new ConflictException("Ya existe otro producto con ese nombre en tu catálogo");
      }
    }

    const data: {
      name?: string;
      price?: number;
      imageUrl?: string | null;
      imageUrls?: string[];
      tags?: string[];
    } = {};
    if (typeof body.name === "string") data.name = nextName;
    if (typeof body.price === "number") data.price = Math.max(0, body.price);
    if (body.imageUrl !== undefined) {
      const trimmed = String(body.imageUrl ?? "").trim();
      data.imageUrl = trimmed.length > 0 ? trimmed : null;
    }
    if (body.imageUrls !== undefined) {
      if (body.imageUrls === null) {
        data.imageUrls = [];
        if (data.imageUrl === undefined) data.imageUrl = null;
      } else {
        const maxProductImages = readNumericEnv("PRODUCT_MAX_IMAGE_UPLOADS", 10);
        const maxProductChars = readNumericEnv("PRODUCT_IMAGE_MAX_CHARS", 220_000);
        const normalized = normalizeImageUrls(body.imageUrls, { maxItems: maxProductImages, maxChars: maxProductChars });
        data.imageUrls = normalized;
        if (data.imageUrl === undefined) {
          data.imageUrl = normalized[0] ? normalized[0] : null;
        }
      }
    }
    if (Array.isArray(body.tags)) {
      data.tags = body.tags.map((t) => String(t ?? "").trim()).filter(Boolean);
    }

    if (Object.keys(data).length === 0) return { ok: true };

    await prisma.product.update({
      where: { id: productId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: data as any
    });
    return { ok: true };
  }

  async updateVariant(
    tenantId: string,
    variantId: string,
    body: {
      sku?: string;
      attributes?: Record<string, string>;
      stock?: number;
      price?: number | null;
      isActive?: boolean;
      imageUrls?: string[] | null;
    }
  ): Promise<unknown> {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      select: {
        id: true,
        productId: true,
        sku: true,
        stock: true,
        reservedStock: true,
        attributes: true,
        price: true,
        isActive: true
      }
    });
    if (!variant) return null;

    const newSku = body.sku !== undefined ? String(body.sku ?? "").trim() : variant.sku;
    if (!newSku) throw new BadRequestException("El SKU no puede quedar vacío");
    if (newSku !== variant.sku) {
      const clash = await prisma.productVariant.findFirst({
        where: { tenantId, sku: newSku, NOT: { id: variantId } }
      });
      if (clash) {
        throw new ConflictException("Ese SKU ya lo usa otra variante");
      }
    }

    let nextStock = variant.stock;
    if (typeof body.stock === "number") {
      const reserved = Number(variant.reservedStock ?? 0);
      const floor = Math.max(0, Math.floor(body.stock));
      if (floor < reserved) {
        throw new BadRequestException(
          `El depósito no puede ser menor que el reservado (${reserved} unidades apartadas)`
        );
      }
      nextStock = floor;
    }

    const nextAttributes =
      body.attributes !== undefined ? normalizeAttributes(body.attributes) : normalizeAttributes(variant.attributes);

    let nextPrice: number | null | undefined = undefined;
    if ("price" in body) {
      nextPrice =
        body.price === null || body.price === undefined
          ? null
          : Math.max(0, Number(body.price));
    }

    const nextIsActive = typeof body.isActive === "boolean" ? body.isActive : variant.isActive;

    const nextImageUrls =
      body.imageUrls !== undefined
        ? body.imageUrls === null
          ? []
          : normalizeImageUrls(body.imageUrls, {
              maxItems: readNumericEnv("VARIANT_MAX_IMAGE_UPLOADS", 6),
              maxChars: readNumericEnv("VARIANT_IMAGE_MAX_CHARS", 220_000)
            })
        : undefined;

    const deltaStock = nextStock - Number(variant.stock);

    return prisma.$transaction(async (tx: any) => {
      await tx.productVariant.update({
        where: { id: variantId },
        data: {
          sku: newSku,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          attributes: nextAttributes as any,
          stock: nextStock,
          ...(nextPrice !== undefined ? { price: nextPrice } : {}),
          isActive: nextIsActive,
          ...(nextImageUrls !== undefined ? { imageUrls: nextImageUrls } : {})
        }
      });
      if (deltaStock !== 0) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: variant.productId,
            variantId: variant.id,
            movementType: "manual_adjust",
            deltaStock,
            deltaReserved: 0,
            reason: "dashboard_variant_stock_set",
            source: "api_products_variant_patch"
          }
        });
      }
      const updatedRows = (await tx.$queryRaw`
        select
          v.id as "variantId",
          p.id as "productId",
          p.name as "name",
          p.price as "basePrice",
          v.price as "variantPrice",
          coalesce(v.price, p.price) as "effectivePrice",
          v.sku as "sku",
          v.attributes as "attributes",
          v.stock as "stock",
          v.reserved_stock as "reservedStock",
          greatest(v.stock - v.reserved_stock, 0) as "availableStock",
          p.image_url as "imageUrl",
          p.image_urls as "imageUrls",
          v.image_urls as "variantImageUrls",
          p.tags as "tags",
          v.is_active as "isActive"
        from public.product_variants v
        inner join public.products p on p.id = v.product_id
        where v.id::text = ${variant.id}
        limit 1
      `) as ProductVariantRow[];
      return updatedRows[0] ?? null;
    });
  }

  async adjustStock(
    tenantId: string,
    variantId: string,
    body: { stockDelta?: number; reservedDelta?: number; price?: number; isActive?: boolean }
  ): Promise<unknown> {
    const stockDeltaInput = Number(body.stockDelta ?? 0);
    const reservedDeltaInput = Number(body.reservedDelta ?? 0);
    if (!Number.isFinite(stockDeltaInput) || !Number.isFinite(reservedDeltaInput)) return null;

    const rows = (await (prisma as any).$queryRaw`
      select id, tenant_id as "tenantId", product_id as "productId", stock, reserved_stock as "reservedStock"
      from public.product_variants
      where id::text = ${variantId}
        and tenant_id::text = ${tenantId}
      limit 1
    `) as Array<{ id: string; tenantId: string; productId: string; stock: number; reservedStock: number }>;
    const variant = rows[0];
    if (!variant) return null;

    const nextStock = Math.max(Number(variant.stock) + stockDeltaInput, 0);
    const nextReserved = Math.max(
      Math.min(Number(variant.reservedStock) + reservedDeltaInput, nextStock),
      0
    );

    return prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`
        update public.product_variants
        set
          stock = ${nextStock},
          reserved_stock = ${nextReserved},
          updated_at = now()
        where id::text = ${variant.id}
      `;
      if (typeof body.price === "number") {
        await tx.$executeRaw`
          update public.product_variants
          set price = ${Math.max(0, body.price)}
          where id::text = ${variant.id}
        `;
      }
      if (typeof body.isActive === "boolean") {
        await tx.$executeRaw`
          update public.product_variants
          set is_active = ${body.isActive}
          where id::text = ${variant.id}
        `;
      }
      const deltaStock = nextStock - Number(variant.stock);
      const deltaReserved = nextReserved - Number(variant.reservedStock);
      if (deltaStock !== 0 || deltaReserved !== 0) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: variant.productId,
            variantId: variant.id,
            movementType: "manual_adjust",
            deltaStock,
            deltaReserved,
            reason: "manual_adjust_from_dashboard",
            source: "api_products_adjust"
          }
        });
      }
      const updatedRows = (await tx.$queryRaw`
        select
          v.id as "variantId",
          p.id as "productId",
          p.name as "name",
          p.price as "basePrice",
          v.price as "variantPrice",
          coalesce(v.price, p.price) as "effectivePrice",
          v.sku as "sku",
          v.attributes as "attributes",
          v.stock as "stock",
          v.reserved_stock as "reservedStock",
          greatest(v.stock - v.reserved_stock, 0) as "availableStock",
          p.image_url as "imageUrl",
          p.image_urls as "imageUrls",
          v.image_urls as "variantImageUrls",
          p.tags as "tags",
          v.is_active as "isActive"
        from public.product_variants v
        inner join public.products p on p.id = v.product_id
        where v.id::text = ${variant.id}
        limit 1
      `) as ProductVariantRow[];
      return updatedRows[0] ?? null;
    });
  }

  async listMovements(tenantId: string, limit = 100): Promise<unknown[]> {
    const boundedLimit = Math.max(Math.min(limit, 500), 1);
    const rows = (await (prisma as any).$queryRaw`
      select
        m.id,
        m.tenant_id as "tenantId",
        m.product_id as "productId",
        m.variant_id as "variantId",
        m.movement_type as "movementType",
        m.delta_stock as "deltaStock",
        m.delta_reserved as "deltaReserved",
        m.reason,
        m.source,
        m.lead_id as "leadId",
        m.phone,
        m.created_at as "createdAt",
        p.name as "productName",
        v.sku as "variantSku",
        v.attributes as "variantAttributes"
      from public.stock_movements m
      left join public.products p on p.id = m.product_id
      left join public.product_variants v on v.id = m.variant_id
      where m.tenant_id::text = ${tenantId}
      order by m.created_at desc
      limit ${boundedLimit}
    `) as unknown[];
    return rows;
  }
}
