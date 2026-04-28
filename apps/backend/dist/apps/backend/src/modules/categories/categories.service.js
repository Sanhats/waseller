"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CategoriesService = void 0;
const common_1 = require("@nestjs/common");
const src_1 = require("../../../../../packages/db/src");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function slugify(name) {
    const base = name
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return base.length > 0 ? base : "categoria";
}
let CategoriesService = class CategoriesService {
    async listForTenant(tenantId) {
        return src_1.prisma.category.findMany({
            where: { tenantId },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: {
                id: true,
                parentId: true,
                name: true,
                slug: true,
                sortOrder: true,
                isActive: true,
                createdAt: true,
                updatedAt: true
            }
        });
    }
    async uniqueSlug(tenantId, base, excludeId) {
        let slug = base;
        let n = 0;
        for (;;) {
            const clash = await src_1.prisma.category.findFirst({
                where: {
                    tenantId,
                    slug,
                    ...(excludeId ? { NOT: { id: excludeId } } : {})
                }
            });
            if (!clash)
                return slug;
            n += 1;
            slug = `${base}-${n}`;
        }
    }
    async assertParent(tenantId, parentId, excludeId) {
        if (parentId == null || parentId === "")
            return null;
        if (!UUID_RE.test(parentId)) {
            throw new common_1.BadRequestException("parentId no es un UUID válido");
        }
        const parent = await src_1.prisma.category.findFirst({
            where: { id: parentId, tenantId }
        });
        if (!parent)
            throw new common_1.BadRequestException("La categoría padre no existe");
        if (excludeId && parent.id === excludeId) {
            throw new common_1.BadRequestException("Una categoría no puede ser padre de sí misma");
        }
        return parent.id;
    }
    async descendantIds(tenantId, rootId) {
        const all = await src_1.prisma.category.findMany({
            where: { tenantId },
            select: { id: true, parentId: true }
        });
        const byParent = new Map();
        for (const c of all) {
            const k = c.parentId;
            if (!byParent.has(k))
                byParent.set(k, []);
            byParent.get(k).push(c.id);
        }
        const out = new Set();
        const stack = [rootId];
        while (stack.length) {
            const id = stack.pop();
            if (out.has(id))
                continue;
            out.add(id);
            const ch = byParent.get(id) ?? [];
            for (const x of ch)
                stack.push(x);
        }
        return out;
    }
    async create(tenantId, body) {
        const name = String(body.name ?? "").trim();
        if (!name)
            throw new common_1.BadRequestException("El nombre es obligatorio");
        const parentId = await this.assertParent(tenantId, body.parentId);
        const baseSlug = slugify(String(body.slug ?? "").trim() || name);
        const slug = await this.uniqueSlug(tenantId, baseSlug);
        const sortOrder = typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
            ? Math.floor(body.sortOrder)
            : 0;
        return src_1.prisma.category.create({
            data: {
                tenantId,
                parentId,
                name,
                slug,
                sortOrder,
                isActive: body.isActive !== false
            }
        });
    }
    async update(tenantId, id, body) {
        if (!UUID_RE.test(id))
            throw new common_1.BadRequestException("id inválido");
        const existing = await src_1.prisma.category.findFirst({ where: { id, tenantId } });
        if (!existing)
            throw new common_1.NotFoundException("Categoría no encontrada");
        if (body.parentId !== undefined) {
            const nextParent = body.parentId === null || body.parentId === ""
                ? null
                : await this.assertParent(tenantId, body.parentId, id);
            if (nextParent) {
                const desc = await this.descendantIds(tenantId, id);
                if (desc.has(nextParent)) {
                    throw new common_1.BadRequestException("No podés mover una categoría bajo uno de sus descendientes");
                }
            }
        }
        if (typeof body.slug === "string" && body.slug.trim()) {
            const want = slugify(body.slug.trim());
            const clash = await src_1.prisma.category.findFirst({
                where: { tenantId, slug: want, NOT: { id } }
            });
            if (clash)
                throw new common_1.ConflictException("Ya existe otra categoría con ese slug");
        }
        const data = {};
        if (typeof body.name === "string") {
            const n = body.name.trim();
            if (!n)
                throw new common_1.BadRequestException("El nombre no puede quedar vacío");
            data.name = n;
        }
        if (body.parentId !== undefined) {
            data.parentId =
                body.parentId === null || body.parentId === ""
                    ? null
                    : await this.assertParent(tenantId, body.parentId, id);
        }
        if (typeof body.slug === "string" && body.slug.trim()) {
            data.slug = slugify(body.slug.trim());
        }
        if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
            data.sortOrder = Math.floor(body.sortOrder);
        }
        if (typeof body.isActive === "boolean")
            data.isActive = body.isActive;
        if (Object.keys(data).length === 0)
            return existing;
        return src_1.prisma.category.update({
            where: { id },
            data
        });
    }
    async remove(tenantId, id) {
        if (!UUID_RE.test(id))
            throw new common_1.BadRequestException("id inválido");
        const existing = await src_1.prisma.category.findFirst({ where: { id, tenantId } });
        if (!existing)
            throw new common_1.NotFoundException("Categoría no encontrada");
        const child = await src_1.prisma.category.findFirst({ where: { tenantId, parentId: id } });
        if (child) {
            throw new common_1.BadRequestException("Eliminá o reasigná primero las subcategorías");
        }
        await src_1.prisma.productCategory.deleteMany({ where: { categoryId: id } });
        await src_1.prisma.category.delete({ where: { id } });
        return { ok: true };
    }
};
exports.CategoriesService = CategoriesService;
exports.CategoriesService = CategoriesService = __decorate([
    (0, common_1.Injectable)()
], CategoriesService);
