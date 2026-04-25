import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { prisma } from "../../../../../packages/db/src";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function slugify(name: string): string {
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

@Injectable()
export class CategoriesService {
  async listForTenant(tenantId: string) {
    return prisma.category.findMany({
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

  private async uniqueSlug(tenantId: string, base: string, excludeId?: string): Promise<string> {
    let slug = base;
    let n = 0;
    for (;;) {
      const clash = await prisma.category.findFirst({
        where: {
          tenantId,
          slug,
          ...(excludeId ? { NOT: { id: excludeId } } : {})
        }
      });
      if (!clash) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }

  private async assertParent(tenantId: string, parentId: string | null | undefined, excludeId?: string) {
    if (parentId == null || parentId === "") return null;
    if (!UUID_RE.test(parentId)) {
      throw new BadRequestException("parentId no es un UUID válido");
    }
    const parent = await prisma.category.findFirst({
      where: { id: parentId, tenantId }
    });
    if (!parent) throw new BadRequestException("La categoría padre no existe");
    if (excludeId && parent.id === excludeId) {
      throw new BadRequestException("Una categoría no puede ser padre de sí misma");
    }
    return parent.id;
  }

  private async descendantIds(tenantId: string, rootId: string): Promise<Set<string>> {
    const all = await prisma.category.findMany({
      where: { tenantId },
      select: { id: true, parentId: true }
    });
    const byParent = new Map<string | null, string[]>();
    for (const c of all) {
      const k = c.parentId;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(c.id);
    }
    const out = new Set<string>();
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      const ch = byParent.get(id) ?? [];
      for (const x of ch) stack.push(x);
    }
    return out;
  }

  async create(
    tenantId: string,
    body: {
      name: string;
      parentId?: string | null;
      slug?: string;
      sortOrder?: number;
      isActive?: boolean;
    }
  ) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new BadRequestException("El nombre es obligatorio");
    const parentId = await this.assertParent(tenantId, body.parentId);
    const baseSlug = slugify(String(body.slug ?? "").trim() || name);
    const slug = await this.uniqueSlug(tenantId, baseSlug);
    const sortOrder =
      typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)
        ? Math.floor(body.sortOrder)
        : 0;
    return prisma.category.create({
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

  async update(
    tenantId: string,
    id: string,
    body: {
      name?: string;
      parentId?: string | null;
      slug?: string;
      sortOrder?: number;
      isActive?: boolean;
    }
  ) {
    if (!UUID_RE.test(id)) throw new BadRequestException("id inválido");
    const existing = await prisma.category.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException("Categoría no encontrada");

    if (body.parentId !== undefined) {
      const nextParent =
        body.parentId === null || body.parentId === ""
          ? null
          : await this.assertParent(tenantId, body.parentId, id);
      if (nextParent) {
        const desc = await this.descendantIds(tenantId, id);
        if (desc.has(nextParent)) {
          throw new BadRequestException("No podés mover una categoría bajo uno de sus descendientes");
        }
      }
    }

    if (typeof body.slug === "string" && body.slug.trim()) {
      const want = slugify(body.slug.trim());
      const clash = await prisma.category.findFirst({
        where: { tenantId, slug: want, NOT: { id } }
      });
      if (clash) throw new ConflictException("Ya existe otra categoría con ese slug");
    }

    const data: {
      name?: string;
      parentId?: string | null;
      slug?: string;
      sortOrder?: number;
      isActive?: boolean;
    } = {};
    if (typeof body.name === "string") {
      const n = body.name.trim();
      if (!n) throw new BadRequestException("El nombre no puede quedar vacío");
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
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;

    if (Object.keys(data).length === 0) return existing;

    return prisma.category.update({
      where: { id },
      data
    });
  }

  async remove(tenantId: string, id: string) {
    if (!UUID_RE.test(id)) throw new BadRequestException("id inválido");
    const existing = await prisma.category.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException("Categoría no encontrada");
    const child = await prisma.category.findFirst({ where: { tenantId, parentId: id } });
    if (child) {
      throw new BadRequestException("Eliminá o reasigná primero las subcategorías");
    }
    await prisma.productCategory.deleteMany({ where: { categoryId: id } });
    await prisma.category.delete({ where: { id } });
    return { ok: true as const };
  }
}
