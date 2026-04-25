"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const src_1 = require("../../../../../packages/db/src");
function readNumericEnv(key, fallback) {
    const n = Number(process.env[key]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
function normalizeImageUrls(input, opts) {
    if (!Array.isArray(input))
        return [];
    const out = [];
    const seen = new Set();
    for (const item of input) {
        if (out.length >= opts.maxItems)
            break;
        const s = String(item ?? "").trim();
        if (!s)
            continue;
        if (s.length > opts.maxChars)
            continue;
        if (seen.has(s))
            continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}
function resolvePrimaryImageUrl(candidate) {
    const explicit = typeof candidate.imageUrl === "string" ? candidate.imageUrl.trim() : "";
    if (explicit)
        return explicit;
    if (Array.isArray(candidate.imageUrls) && candidate.imageUrls.length > 0) {
        const first = String(candidate.imageUrls[0] ?? "").trim();
        if (first)
            return first;
    }
    return undefined;
}
const normalizeAttributes = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return {};
    const entries = Object.entries(raw)
        .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
        .filter(([key, value]) => key.length > 0 && value.length > 0);
    return Object.fromEntries(entries);
};
const normalizeVariant = (input) => {
    const sku = String(input.sku ?? "").trim();
    if (!sku)
        return null;
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
const normalizeCreatePayload = (body) => {
    const maxProductImages = readNumericEnv("PRODUCT_MAX_IMAGE_UPLOADS", 10);
    const maxProductChars = readNumericEnv("PRODUCT_IMAGE_MAX_CHARS", 220_000);
    const variants = Array.isArray(body.variants) ? body.variants.map(normalizeVariant).filter(Boolean) : [];
    const sanitizedVariants = variants;
    const fallbackSku = `SKU-${Date.now()}`;
    const normalizedImageUrls = normalizeImageUrls(body.imageUrls, { maxItems: maxProductImages, maxChars: maxProductChars });
    const imageUrl = resolvePrimaryImageUrl({ imageUrl: body.imageUrl, imageUrls: normalizedImageUrls }) || undefined;
    return {
        name: String(body.name ?? "").trim(),
        price: Math.max(0, Number(body.price ?? 0)),
        imageUrl,
        imageUrls: normalizedImageUrls,
        tags: Array.isArray(body.tags) ? body.tags.map((item) => String(item ?? "").trim()).filter(Boolean) : [],
        variants: sanitizedVariants.length > 0
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
let ProductsService = class ProductsService {
    async listByTenant(tenantId) {
        const rows = (await src_1.prisma.$queryRaw `
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
    `);
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
            imageUrl: row.variantImageUrls?.[0] ||
                row.imageUrls?.[0] ||
                row.imageUrl,
            imageUrls: Array.isArray(row.imageUrls) ? row.imageUrls : [],
            variantImageUrls: Array.isArray(row.variantImageUrls) ? row.variantImageUrls : [],
            tags: Array.isArray(row.tags) ? row.tags : [],
            isActive: Boolean(row.isActive)
        }));
    }
    /** Catálogo público: solo variantes activas (sin JWT en el consumidor de la página). */
    async listPublicCatalogByTenant(tenantId) {
        const rows = (await src_1.prisma.$queryRaw `
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
    `);
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
            imageUrl: row.variantImageUrls?.[0] ||
                row.imageUrls?.[0] ||
                row.imageUrl,
            imageUrls: Array.isArray(row.imageUrls) ? row.imageUrls : [],
            variantImageUrls: Array.isArray(row.variantImageUrls) ? row.variantImageUrls : [],
            tags: Array.isArray(row.tags) ? row.tags : [],
            isActive: Boolean(row.isActive)
        }));
    }
    async createProduct(tenantId, body) {
        const payload = normalizeCreatePayload(body);
        return src_1.prisma.$transaction(async (tx) => {
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
            const createdVariants = [];
            for (const variant of payload.variants) {
                const created = await tx.productVariant.create({
                    data: {
                        tenantId,
                        productId: product.id,
                        sku: variant.sku,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        attributes: variant.attributes,
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
    async addVariant(tenantId, productId, body) {
        const product = await src_1.prisma.product.findFirst({
            where: { id: productId, tenantId }
        });
        if (!product)
            return null;
        const normalized = normalizeVariant({
            sku: body.sku,
            attributes: body.attributes,
            stock: body.stock,
            price: body.price,
            isActive: body.isActive,
            imageUrls: body.imageUrls
        });
        if (!normalized) {
            throw new common_1.BadRequestException("Datos de variante incompletos o SKU vacío");
        }
        const clash = await src_1.prisma.productVariant.findFirst({
            where: { tenantId, sku: normalized.sku }
        });
        if (clash) {
            throw new common_1.ConflictException("Ese SKU ya lo usa otra variante");
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return src_1.prisma.$transaction(async (tx) => {
            const created = await tx.productVariant.create({
                data: {
                    tenantId,
                    productId,
                    sku: normalized.sku,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    attributes: normalized.attributes,
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
    async updateProduct(tenantId, productId, body) {
        const existing = await src_1.prisma.product.findFirst({
            where: { id: productId, tenantId }
        });
        if (!existing)
            return null;
        const hasAny = typeof body.name === "string" ||
            typeof body.price === "number" ||
            body.imageUrl !== undefined ||
            body.imageUrls !== undefined ||
            Array.isArray(body.tags);
        if (!hasAny)
            return { ok: true };
        const nextName = typeof body.name === "string" ? String(body.name).trim() : existing.name;
        if (nextName.length === 0)
            throw new common_1.BadRequestException("El nombre no puede quedar vacío");
        if (nextName !== existing.name) {
            const clash = await src_1.prisma.product.findFirst({
                where: { tenantId, name: nextName, NOT: { id: productId } }
            });
            if (clash) {
                throw new common_1.ConflictException("Ya existe otro producto con ese nombre en tu catálogo");
            }
        }
        const data = {};
        if (typeof body.name === "string")
            data.name = nextName;
        if (typeof body.price === "number")
            data.price = Math.max(0, body.price);
        if (body.imageUrl !== undefined) {
            const trimmed = String(body.imageUrl ?? "").trim();
            data.imageUrl = trimmed.length > 0 ? trimmed : null;
        }
        if (body.imageUrls !== undefined) {
            if (body.imageUrls === null) {
                data.imageUrls = [];
                if (data.imageUrl === undefined)
                    data.imageUrl = null;
            }
            else {
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
        if (Object.keys(data).length === 0)
            return { ok: true };
        await src_1.prisma.product.update({
            where: { id: productId },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: data
        });
        return { ok: true };
    }
    async updateVariant(tenantId, variantId, body) {
        const variant = await src_1.prisma.productVariant.findFirst({
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
        if (!variant)
            return null;
        const newSku = body.sku !== undefined ? String(body.sku ?? "").trim() : variant.sku;
        if (!newSku)
            throw new common_1.BadRequestException("El SKU no puede quedar vacío");
        if (newSku !== variant.sku) {
            const clash = await src_1.prisma.productVariant.findFirst({
                where: { tenantId, sku: newSku, NOT: { id: variantId } }
            });
            if (clash) {
                throw new common_1.ConflictException("Ese SKU ya lo usa otra variante");
            }
        }
        let nextStock = variant.stock;
        if (typeof body.stock === "number") {
            const reserved = Number(variant.reservedStock ?? 0);
            const floor = Math.max(0, Math.floor(body.stock));
            if (floor < reserved) {
                throw new common_1.BadRequestException(`El depósito no puede ser menor que el reservado (${reserved} unidades apartadas)`);
            }
            nextStock = floor;
        }
        const nextAttributes = body.attributes !== undefined ? normalizeAttributes(body.attributes) : normalizeAttributes(variant.attributes);
        let nextPrice = undefined;
        if ("price" in body) {
            nextPrice =
                body.price === null || body.price === undefined
                    ? null
                    : Math.max(0, Number(body.price));
        }
        const nextIsActive = typeof body.isActive === "boolean" ? body.isActive : variant.isActive;
        const nextImageUrls = body.imageUrls !== undefined
            ? body.imageUrls === null
                ? []
                : normalizeImageUrls(body.imageUrls, {
                    maxItems: readNumericEnv("VARIANT_MAX_IMAGE_UPLOADS", 6),
                    maxChars: readNumericEnv("VARIANT_IMAGE_MAX_CHARS", 220_000)
                })
            : undefined;
        const deltaStock = nextStock - Number(variant.stock);
        return src_1.prisma.$transaction(async (tx) => {
            await tx.productVariant.update({
                where: { id: variantId },
                data: {
                    sku: newSku,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    attributes: nextAttributes,
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
            const updatedRows = (await tx.$queryRaw `
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
      `);
            return updatedRows[0] ?? null;
        });
    }
    async adjustStock(tenantId, variantId, body) {
        const stockDeltaInput = Number(body.stockDelta ?? 0);
        const reservedDeltaInput = Number(body.reservedDelta ?? 0);
        if (!Number.isFinite(stockDeltaInput) || !Number.isFinite(reservedDeltaInput))
            return null;
        const rows = (await src_1.prisma.$queryRaw `
      select id, tenant_id as "tenantId", product_id as "productId", stock, reserved_stock as "reservedStock"
      from public.product_variants
      where id::text = ${variantId}
        and tenant_id::text = ${tenantId}
      limit 1
    `);
        const variant = rows[0];
        if (!variant)
            return null;
        const nextStock = Math.max(Number(variant.stock) + stockDeltaInput, 0);
        const nextReserved = Math.max(Math.min(Number(variant.reservedStock) + reservedDeltaInput, nextStock), 0);
        return src_1.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `
        update public.product_variants
        set
          stock = ${nextStock},
          reserved_stock = ${nextReserved},
          updated_at = now()
        where id::text = ${variant.id}
      `;
            if (typeof body.price === "number") {
                await tx.$executeRaw `
          update public.product_variants
          set price = ${Math.max(0, body.price)}
          where id::text = ${variant.id}
        `;
            }
            if (typeof body.isActive === "boolean") {
                await tx.$executeRaw `
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
            const updatedRows = (await tx.$queryRaw `
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
      `);
            return updatedRows[0] ?? null;
        });
    }
    async listMovements(tenantId, limit = 100) {
        const boundedLimit = Math.max(Math.min(limit, 500), 1);
        const rows = (await src_1.prisma.$queryRaw `
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
    `);
        return rows;
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)()
], ProductsService);
