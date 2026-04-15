import { prisma } from "../../../../packages/db/src";

export class StockReservationService {
  async reserveOne(
    tenantId: string,
    variantId: string,
    meta?: { reason?: string; source?: string; leadId?: string; phone?: string }
  ): Promise<boolean> {
    return prisma.$transaction(async (tx: any) => {
      const rows = (await tx.$queryRaw`
        select id, product_id as "productId", stock, reserved_stock as "reservedStock"
        from public.product_variants
        where id::text = ${variantId}
          and tenant_id::text = ${tenantId}
        limit 1
      `) as Array<{ id: string; productId: string; stock: number; reservedStock: number }>;
      const variant = rows[0];
      if (!variant) return false;
      if (Number(variant.stock) - Number(variant.reservedStock) <= 0) return false;
      const updated = await tx.$executeRaw`
        update public.product_variants
        set reserved_stock = reserved_stock + 1, updated_at = now()
        where id::text = ${variant.id}
          and tenant_id::text = ${tenantId}
          and reserved_stock = ${Number(variant.reservedStock)}
      `;
      if (Number(updated) > 0) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: variant.productId,
            variantId: variant.id,
            movementType: "reserve",
            deltaStock: 0,
            deltaReserved: 1,
            reason: meta?.reason,
            source: meta?.source ?? "worker",
            leadId: meta?.leadId,
            phone: meta?.phone
          }
        });
      }
      return Number(updated) > 0;
    });
  }

  async commitOne(
    tenantId: string,
    variantId: string,
    meta?: { reason?: string; source?: string; leadId?: string; phone?: string }
  ): Promise<boolean> {
    return prisma.$transaction(async (tx: any) => {
      const rows = (await tx.$queryRaw`
        select id, product_id as "productId", stock, reserved_stock as "reservedStock"
        from public.product_variants
        where id::text = ${variantId}
          and tenant_id::text = ${tenantId}
        limit 1
      `) as Array<{ id: string; productId: string; stock: number; reservedStock: number }>;
      const variant = rows[0];
      if (!variant) return false;
      if (Number(variant.stock) < 1 || Number(variant.reservedStock) < 1) return false;
      const updated = await tx.$executeRaw`
        update public.product_variants
        set
          stock = stock - 1,
          reserved_stock = reserved_stock - 1,
          updated_at = now()
        where id::text = ${variant.id}
          and tenant_id::text = ${tenantId}
          and stock = ${Number(variant.stock)}
          and reserved_stock = ${Number(variant.reservedStock)}
      `;
      if (Number(updated) > 0) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: variant.productId,
            variantId: variant.id,
            movementType: "commit",
            deltaStock: -1,
            deltaReserved: -1,
            reason: meta?.reason,
            source: meta?.source ?? "worker",
            leadId: meta?.leadId,
            phone: meta?.phone
          }
        });
      }
      return Number(updated) > 0;
    });
  }

  async releaseOne(
    tenantId: string,
    variantId: string,
    meta?: { reason?: string; source?: string; leadId?: string; phone?: string }
  ): Promise<boolean> {
    return prisma.$transaction(async (tx: any) => {
      const rows = (await tx.$queryRaw`
        select id, product_id as "productId", reserved_stock as "reservedStock"
        from public.product_variants
        where id::text = ${variantId}
          and tenant_id::text = ${tenantId}
        limit 1
      `) as Array<{ id: string; productId: string; reservedStock: number }>;
      const variant = rows[0];
      if (!variant) return false;
      if (Number(variant.reservedStock) < 1) return false;
      const updated = await tx.$executeRaw`
        update public.product_variants
        set reserved_stock = reserved_stock - 1, updated_at = now()
        where id::text = ${variant.id}
          and tenant_id::text = ${tenantId}
          and reserved_stock = ${Number(variant.reservedStock)}
      `;
      if (Number(updated) > 0) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: variant.productId,
            variantId: variant.id,
            movementType: "release",
            deltaStock: 0,
            deltaReserved: -1,
            reason: meta?.reason,
            source: meta?.source ?? "worker",
            leadId: meta?.leadId,
            phone: meta?.phone
          }
        });
      }
      return Number(updated) > 0;
    });
  }
}
