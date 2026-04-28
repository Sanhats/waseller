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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function syncProductCategories(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
tx, tenantId, productId, categoryIds) {
    const unique = [...new Set(categoryIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
    if (unique.some((id) => !UUID_RE.test(id))) {
        throw new common_1.BadRequestException("Algún categoryId no es un UUID válido");
    }
    if (unique.length > 0) {
        const found = await tx.category.findMany({
            where: { tenantId, id: { in: unique }, isActive: true },
            select: { id: true }
        });
        const ok = new Set(found.map((c) => c.id));
        const missing = unique.filter((id) => !ok.has(id));
        if (missing.length) {
            throw new common_1.BadRequestException("Categorías inexistentes, de otro tenant o inactivas");
        }
    }
    await tx.productCategory.deleteMany({ where: { productId } });
    if (unique.length > 0) {
        await tx.productCategory.createMany({
            data: unique.map((categoryId) => ({ productId, categoryId }))
        });
    }
}
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
/** Copias indexadas desde `attributes` (talle/talla, color, marca/modelo). */
function extractVariantFacets(attrs) {
    const a = normalizeAttributes(attrs);
    const lower = (k) => k.toLowerCase().trim();
    const byKey = new Map();
    for (const [k, v] of Object.entries(a)) {
        byKey.set(lower(k), v.trim());
    }
    const t = byKey.get("talle") || byKey.get("talla") || "";
    const c = byKey.get("color") || "";
    const m = byKey.get("marca") || byKey.get("modelo") || "";
    const cap = (s, n) => (s.length > n ? s.slice(0, n) : s);
    return {
        variantTalle: t ? cap(t, 160) : null,
        variantColor: c ? cap(c, 160) : null,
        variantMarca: m ? cap(m, 200) : null
    };
}
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
    async expandCategorySubtreeIds(tenantId, rootId, requireActiveCategories = false) {
        if (!UUID_RE.test(rootId))
            return [];
        const root = await src_1.prisma.category.findFirst({
            where: { id: rootId, tenantId, ...(requireActiveCategories ? { isActive: true } : {}) },
            select: { id: true }
        });
        if (!root)
            return [];
        const all = await src_1.prisma.category.findMany({
            where: { tenantId, ...(requireActiveCategories ? { isActive: true } : {}) },
            select: { id: true, parentId: true }
        });
        const byParent = new Map();
        for (const c of all) {
            const k = c.parentId;
            if (!byParent.has(k))
                byParent.set(k, []);
            byParent.get(k).push(c.id);
        }
        const out = [];
        const stack = [root.id];
        while (stack.length) {
            const id = stack.pop();
            out.push(id);
            for (const ch of byParent.get(id) ?? [])
                stack.push(ch);
        }
        return out;
    }
    /**
     * Listado de variantes con filtros opcionales.
     * Usamos $queryRawUnsafe + placeholders $n porque componer `Sql` con `join()` desde
     * `@prisma/client/runtime/library` puede romperse en el bundle de Next (instancias distintas de `Sql`).
     */
    async queryProductVariantRows(tenantId, opts, activeVariantsOnly = false, requireActiveCategories = false) {
        if (!UUID_RE.test(tenantId)) {
            return [];
        }
        const params = [tenantId];
        let next = 2;
        let extra = "";
        if (activeVariantsOnly) {
            extra += " and v.is_active = true ";
        }
        const cid = opts?.categoryId?.trim();
        if (cid) {
            const ids = await this.expandCategorySubtreeIds(tenantId, cid, requireActiveCategories);
            if (ids.length === 0 || !ids.every((id) => UUID_RE.test(id))) {
                extra += " and false ";
            }
            else {
                extra += ` and exists (
          select 1 from public.product_categories pc
          where pc.product_id = p.id and pc.category_id = any($${next}::uuid[])
        ) `;
                params.push(ids);
                next += 1;
            }
        }
        const q = opts?.q?.trim();
        if (q) {
            const qv = q.toLowerCase();
            extra += ` and (
        position($${next} in lower(p.name)) > 0
        or exists (
          select 1 from unnest(coalesce(p.tags, array[]::text[])) t
          where position($${next} in lower(t)) > 0
        )
        or position($${next} in lower(concat_ws(' ',
          coalesce(v.variant_talle,''),
          coalesce(v.variant_color,''),
          coalesce(v.variant_marca,''),
          coalesce(v.sku,'')
        ))) > 0
      ) `;
            params.push(qv);
            next += 1;
        }
        const talleF = opts?.talle?.trim();
        if (talleF) {
            extra += ` and lower(trim(coalesce(v.variant_talle,''))) = lower(trim($${next})) `;
            params.push(talleF);
            next += 1;
        }
        const colorF = opts?.color?.trim();
        if (colorF) {
            extra += ` and lower(trim(coalesce(v.variant_color,''))) = lower(trim($${next})) `;
            params.push(colorF);
            next += 1;
        }
        const marcaF = opts?.marca?.trim();
        if (marcaF) {
            extra += ` and lower(trim(coalesce(v.variant_marca,''))) = lower(trim($${next})) `;
            params.push(marcaF);
            next += 1;
        }
        const sql = `
      select
        v.id as "variantId",
        p.id as "productId",
        p.name as "name",
        p.price as "basePrice",
        v.price as "variantPrice",
        coalesce(v.price, p.price) as "effectivePrice",
        v.sku as "sku",
        v.attributes as "attributes",
        v.variant_talle as "variantTalle",
        v.variant_color as "variantColor",
        v.variant_marca as "variantMarca",
        v.stock as "stock",
        v.reserved_stock as "reservedStock",
        greatest(v.stock - v.reserved_stock, 0) as "availableStock",
        p.image_url as "imageUrl",
        p.image_urls as "imageUrls",
        v.image_urls as "variantImageUrls",
        p.tags as "tags",
        v.is_active as "isActive",
        coalesce(
          (select array_agg(c.id::text order by c.sort_order, c.name)
           from public.product_categories pc
           join public.categories c on c.id = pc.category_id
           where pc.product_id = p.id),
          '{}'::text[]
        ) as "categoryIds",
        coalesce(
          (select array_agg(c.name order by c.sort_order, c.name)
           from public.product_categories pc
           join public.categories c on c.id = pc.category_id
           where pc.product_id = p.id),
          '{}'::text[]
        ) as "categoryNames"
      from public.product_variants v
      inner join public.products p on p.id = v.product_id
      where v.tenant_id::text = $1
      ${extra}
      order by p.updated_at desc, p.name asc, v.sku asc
    `;
        return (await src_1.prisma.$queryRawUnsafe(sql, ...params));
    }
    mapVariantRow(row) {
        const attrs = normalizeAttributes(row.attributes);
        const fb = extractVariantFacets(attrs);
        return {
            variantId: row.variantId,
            productId: row.productId,
            name: row.name,
            basePrice: row.basePrice,
            variantPrice: row.variantPrice,
            effectivePrice: Number(row.effectivePrice ?? 0),
            sku: row.sku,
            attributes: attrs,
            variantTalle: (row.variantTalle != null && String(row.variantTalle).trim()) ? String(row.variantTalle).trim() : fb.variantTalle,
            variantColor: (row.variantColor != null && String(row.variantColor).trim()) ? String(row.variantColor).trim() : fb.variantColor,
            variantMarca: (row.variantMarca != null && String(row.variantMarca).trim()) ? String(row.variantMarca).trim() : fb.variantMarca,
            stock: Number(row.stock ?? 0),
            reservedStock: Number(row.reservedStock ?? 0),
            availableStock: Number(row.availableStock ?? 0),
            imageUrl: row.variantImageUrls?.[0] ||
                row.imageUrls?.[0] ||
                row.imageUrl,
            imageUrls: Array.isArray(row.imageUrls) ? row.imageUrls : [],
            variantImageUrls: Array.isArray(row.variantImageUrls) ? row.variantImageUrls : [],
            tags: Array.isArray(row.tags) ? row.tags : [],
            isActive: Boolean(row.isActive),
            categoryIds: Array.isArray(row.categoryIds) ? row.categoryIds : [],
            categoryNames: Array.isArray(row.categoryNames) ? row.categoryNames : []
        };
    }
    async listByTenant(tenantId, opts) {
        const rows = await this.queryProductVariantRows(tenantId, opts, false, false);
        return rows.map((row) => this.mapVariantRow(row));
    }
    /** Valores distintos de facetas para armar filtros (dashboard / tienda). */
    async listVariantFacetDistinctValues(tenantId, opts) {
        if (!UUID_RE.test(tenantId)) {
            return { talles: [], colors: [], marcas: [] };
        }
        const params = [tenantId];
        let next = 2;
        let extra = "";
        if (opts?.publicCatalog) {
            extra += " and v.is_active = true and greatest(v.stock - v.reserved_stock, 0) > 0 ";
        }
        const cid = opts?.categoryId?.trim();
        if (cid) {
            const ids = await this.expandCategorySubtreeIds(tenantId, cid, Boolean(opts?.publicCatalog));
            if (ids.length === 0 || !ids.every((id) => UUID_RE.test(id))) {
                return { talles: [], colors: [], marcas: [] };
            }
            extra += ` and exists (
        select 1 from public.product_categories pc
        where pc.product_id = p.id and pc.category_id = any($${next}::uuid[])
      ) `;
            params.push(ids);
            next += 1;
        }
        const baseFrom = `
      from public.product_variants v
      inner join public.products p on p.id = v.product_id
      where v.tenant_id::text = $1
      ${extra}
    `;
        const run = async (col) => {
            const sql = `select distinct trim(v.${col}) as val ${baseFrom}
        and v.${col} is not null and trim(v.${col}) <> ''
        order by 1 asc`;
            const rows = (await src_1.prisma.$queryRawUnsafe(sql, ...params));
            return rows.map((r) => String(r.val ?? "").trim()).filter(Boolean);
        };
        const [talles, colors, marcas] = await Promise.all([
            run("variant_talle"),
            run("variant_color"),
            run("variant_marca")
        ]);
        return { talles, colors, marcas };
    }
    /** Catálogo público: solo variantes activas (sin JWT en el consumidor de la página). */
    async listPublicCatalogByTenant(tenantId, opts) {
        const rows = await this.queryProductVariantRows(tenantId, opts, true, true);
        return rows.map((row) => this.mapVariantRow(row));
    }
    /** Detalle público del producto: variantes activas del mismo `productId` (sin JWT). */
    async getPublicProductDetailsByTenant(tenantId, productId) {
        const pid = String(productId ?? "").trim();
        if (!pid)
            return { categories: [], variants: [] };
        const cats = (await src_1.prisma.$queryRaw `
      select c.id::text as id, c.name, c.slug
      from public.product_categories pc
      inner join public.categories c on c.id = pc.category_id
      where pc.product_id::text = ${pid}
        and c.tenant_id::text = ${tenantId}
        and c.is_active = true
      order by c.sort_order asc, c.name asc
    `);
        const rows = (await src_1.prisma.$queryRaw `
      select
        p.id as "productId",
        p.name as "name",
        p.price as "basePrice",
        p.image_urls as "imageUrls",
        p.tags as "tags",
        v.id as "variantId",
        v.sku as "sku",
        v.attributes as "attributes",
        v.variant_talle as "variantTalle",
        v.variant_color as "variantColor",
        v.variant_marca as "variantMarca",
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
    `);
        return {
            categories: cats,
            variants: rows.map((r) => {
                const attrs = normalizeAttributes(r.attributes);
                const fb = extractVariantFacets(attrs);
                return {
                    productId: r.productId,
                    name: String(r.name ?? ""),
                    basePrice: Number(r.basePrice ?? 0),
                    imageUrls: Array.isArray(r.imageUrls) ? r.imageUrls : [],
                    tags: Array.isArray(r.tags) ? r.tags : [],
                    variantId: r.variantId,
                    sku: String(r.sku ?? ""),
                    attributes: attrs,
                    variantTalle: (r.variantTalle != null && String(r.variantTalle).trim()) ? String(r.variantTalle).trim() : fb.variantTalle,
                    variantColor: (r.variantColor != null && String(r.variantColor).trim()) ? String(r.variantColor).trim() : fb.variantColor,
                    variantMarca: (r.variantMarca != null && String(r.variantMarca).trim()) ? String(r.variantMarca).trim() : fb.variantMarca,
                    variantPrice: r.variantPrice == null ? null : Number(r.variantPrice),
                    effectivePrice: Number(r.effectivePrice ?? 0),
                    availableStock: Number(r.availableStock ?? 0),
                    isActive: Boolean(r.isActive),
                    variantImageUrls: Array.isArray(r.variantImageUrls) ? r.variantImageUrls : []
                };
            })
        };
    }
    async createProduct(tenantId, body) {
        const payload = normalizeCreatePayload(body);
        const categoryIds = Array.isArray(body.categoryIds) ? body.categoryIds : [];
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
                const facets = extractVariantFacets(variant.attributes);
                const created = await tx.productVariant.create({
                    data: {
                        tenantId,
                        productId: product.id,
                        sku: variant.sku,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        attributes: variant.attributes,
                        variantTalle: facets.variantTalle,
                        variantColor: facets.variantColor,
                        variantMarca: facets.variantMarca,
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
            await syncProductCategories(tx, tenantId, product.id, categoryIds);
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
        const facets = extractVariantFacets(normalized.attributes);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return src_1.prisma.$transaction(async (tx) => {
            const created = await tx.productVariant.create({
                data: {
                    tenantId,
                    productId,
                    sku: normalized.sku,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    attributes: normalized.attributes,
                    variantTalle: facets.variantTalle,
                    variantColor: facets.variantColor,
                    variantMarca: facets.variantMarca,
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
            Array.isArray(body.tags) ||
            Array.isArray(body.categoryIds);
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
        const shouldSyncCategories = Array.isArray(body.categoryIds);
        if (Object.keys(data).length === 0 && !shouldSyncCategories)
            return { ok: true };
        await src_1.prisma.$transaction(async (tx) => {
            if (Object.keys(data).length > 0) {
                await tx.product.update({
                    where: { id: productId },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data: data
                });
            }
            if (shouldSyncCategories) {
                await syncProductCategories(tx, tenantId, productId, body.categoryIds ?? []);
            }
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
        const facetCols = extractVariantFacets(nextAttributes);
        return src_1.prisma.$transaction(async (tx) => {
            await tx.productVariant.update({
                where: { id: variantId },
                data: {
                    sku: newSku,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    attributes: nextAttributes,
                    variantTalle: facetCols.variantTalle,
                    variantColor: facetCols.variantColor,
                    variantMarca: facetCols.variantMarca,
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
          v.variant_talle as "variantTalle",
          v.variant_color as "variantColor",
          v.variant_marca as "variantMarca",
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
          v.variant_talle as "variantTalle",
          v.variant_color as "variantColor",
          v.variant_marca as "variantMarca",
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
