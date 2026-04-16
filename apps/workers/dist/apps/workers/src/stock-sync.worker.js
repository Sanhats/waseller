"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockSyncWorker = void 0;
const bullmq_1 = require("bullmq");
const src_1 = require("../../../packages/queue/src");
const src_2 = require("../../../packages/db/src");
exports.stockSyncWorker = new bullmq_1.Worker(src_1.QueueNames.stockSync, async (job) => {
    const { tenantId, products } = job.data;
    for (const p of products) {
        const product = await src_2.prisma.product.upsert({
            where: {
                tenantId_name: {
                    tenantId,
                    name: p.name
                }
            },
            update: {
                price: p.price,
                updatedAt: new Date()
            },
            create: {
                tenantId,
                name: p.name,
                price: p.price ?? 0,
                tags: []
            }
        });
        const sku = String(p.sku ?? `${p.name}`.replace(/\s+/g, "-").toUpperCase()).trim();
        const attrs = p.attributes ?? {};
        const currentRows = (await src_2.prisma.$queryRaw `
        select id, stock, reserved_stock as "reservedStock"
        from public.product_variants
        where tenant_id::text = ${tenantId}
          and sku = ${sku}
        limit 1
      `);
        const current = currentRows[0];
        const nextReserved = Math.min(current?.reservedStock ?? 0, Math.max(p.stock, 0));
        if (!current) {
            const inserted = (await src_2.prisma.$queryRaw `
          insert into public.product_variants (
            tenant_id,
            product_id,
            sku,
            attributes,
            price,
            stock,
            reserved_stock,
            is_active
          )
          values (
            cast(${tenantId} as uuid),
            cast(${product.id} as uuid),
            ${sku},
            ${JSON.stringify(attrs)}::jsonb,
            ${p.price ?? null},
            ${Math.max(p.stock, 0)},
            0,
            true
          )
          returning id, stock
        `);
            const created = inserted[0];
            if (created && Number(created.stock) > 0) {
                await src_2.prisma.stockMovement.create({
                    data: {
                        tenantId,
                        productId: product.id,
                        variantId: created.id,
                        movementType: "sync",
                        deltaStock: Number(created.stock),
                        deltaReserved: 0,
                        reason: "stock_sync_import",
                        source: job.data.source
                    }
                });
            }
            continue;
        }
        await src_2.prisma.$executeRaw `
        update public.product_variants
        set
          stock = ${Math.max(p.stock, 0)},
          reserved_stock = ${nextReserved},
          price = ${p.price ?? null},
          attributes = ${JSON.stringify(attrs)}::jsonb,
          updated_at = now()
        where id::text = ${current.id}
      `;
        const previousStock = current?.stock ?? 0;
        const previousReserved = current?.reservedStock ?? 0;
        const deltaStock = Math.max(p.stock, 0) - previousStock;
        const deltaReserved = nextReserved - previousReserved;
        if (deltaStock !== 0 || deltaReserved !== 0) {
            await src_2.prisma.stockMovement.create({
                data: {
                    tenantId,
                    productId: product.id,
                    variantId: current.id,
                    movementType: "sync",
                    deltaStock,
                    deltaReserved,
                    reason: "stock_sync_import",
                    source: job.data.source
                }
            });
        }
    }
}, { connection: src_1.redisConnection });
