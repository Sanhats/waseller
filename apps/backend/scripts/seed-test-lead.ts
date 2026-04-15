/**
 * Datos de prueba para leads + flujo de enlace de pago (lead worker).
 *
 * Requisitos: DATABASE_URL (y Redis accesible si no usás --db-only).
 * Opcional: SEED_ENV_FILE o por defecto ../../../infra/env/.env.local (desde esta carpeta).
 *
 * Uso (desde apps/backend):
 *   TENANT_ID=<uuid> npm run seed:test-lead
 *   TENANT_ID=<uuid> npm run seed:test-lead -- --db-only
 *   TENANT_ID=<uuid> SEED_PHONE=+5491112345678 npm run seed:test-lead
 */

import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve as pathResolve } from "node:path";
import { prisma } from "../../../packages/db/src";
import { replaceAndInsertDemoMessages } from "./demo-chat-thread";

const PRODUCT_NAME = "Waseller Seed Remera";
const VARIANT_SKU = "SEED-WASLREM-001";

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function parseArgs(): { dbOnly: boolean } {
  const dbOnly = process.argv.includes("--db-only");
  return { dbOnly };
}

async function enqueueLeadProcessingJob(params: {
  tenantId: string;
  leadId: string;
  phone: string;
  variantId: string;
}): Promise<void> {
  const { JOB_SCHEMA_VERSION, buildStableDedupeKey, leadProcessingQueue, redisConnection } = await import(
    "../../../packages/queue/src"
  );
  if (!process.env.REDIS_URL) {
    console.warn("REDIS_URL no definida; se usa redis://localhost:6379 (default del paquete queue).");
  }
  const correlationId = randomUUID();
  const dedupeKey = buildStableDedupeKey(
    "seed-test-lead",
    params.tenantId,
    params.leadId,
    correlationId
  );
  const jobPayload = {
    schemaVersion: JOB_SCHEMA_VERSION,
    correlationId,
    dedupeKey,
    tenantId: params.tenantId,
    leadId: params.leadId,
    phone: params.phone,
    status: "listo_para_cobrar",
    intent: "pedir_link_pago" as const,
    incomingMessage: "Pasame el link de pago por favor",
    isBusinessRelated: true,
    productName: PRODUCT_NAME,
    variantId: params.variantId,
    variantAttributes: { color: "Negro", talle: "M" },
    stockReserved: true
  };
  await leadProcessingQueue.add("lead-processed-v1", jobPayload, {
    jobId: `lead_${dedupeKey}`.slice(0, 128)
  });
  await leadProcessingQueue.close();
  await redisConnection.quit();
  console.log("Job lead_processing encolado (pedir_link_pago + stockReserved). Revisá outgoing y payment_attempts.");
}

async function main(): Promise<void> {
  const defaultEnvPath = pathResolve(__dirname, "../../../infra/env/.env.local");
  loadEnvFile(process.env.SEED_ENV_FILE ?? defaultEnvPath);

  const tenantId = process.env.TENANT_ID?.trim();
  if (!tenantId) {
    console.error("Falta TENANT_ID (UUID del tenant en tu .env o variable de entorno).");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  const { dbOnly } = parseArgs();
  const phone = (process.env.SEED_PHONE ?? "5491199998888").trim();
  const reservationUntil = new Date(Date.now() + 48 * 3600 * 1000);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true }
  });
  if (!tenant) {
    console.error(`No existe tenant con id ${tenantId}`);
    process.exit(1);
  }

  const product = await prisma.product.upsert({
    where: { tenantId_name: { tenantId, name: PRODUCT_NAME } },
    create: {
      tenantId,
      name: PRODUCT_NAME,
      price: 15900,
      tags: ["seed", "test"]
    },
    update: { price: 15900, tags: ["seed", "test"] }
  });

  const variant = await prisma.productVariant.upsert({
    where: { tenantId_sku: { tenantId, sku: VARIANT_SKU } },
    create: {
      tenantId,
      productId: product.id,
      sku: VARIANT_SKU,
      attributes: { color: "Negro", talle: "M" },
      price: null,
      stock: 25,
      reservedStock: 0,
      isActive: true
    },
    update: {
      productId: product.id,
      attributes: { color: "Negro", talle: "M" },
      stock: 25,
      isActive: true
    }
  });

  const existingLead = await prisma.lead.findFirst({
    where: { tenantId, phone },
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });
  const lead = existingLead
    ? await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          customerName: "Cliente prueba Waseller",
          product: PRODUCT_NAME,
          productVariantId: variant.id,
          productVariantAttributes: { color: "Negro", talle: "M" },
          status: "listo_para_cobrar",
          score: 85,
          hasStockReservation: true,
          reservationExpiresAt: reservationUntil,
          lastMessage: "Pasame el link de pago por favor"
        }
      })
    : await prisma.lead.create({
        data: {
          tenantId,
          phone,
          customerName: "Cliente prueba Waseller",
          product: PRODUCT_NAME,
          productVariantId: variant.id,
          productVariantAttributes: { color: "Negro", talle: "M" },
          status: "listo_para_cobrar",
          score: 85,
          hasStockReservation: true,
          reservationExpiresAt: reservationUntil,
          lastMessage: "Pasame el link de pago por favor"
        }
      });

  let conversation = await prisma.conversation.findFirst({
    where: { leadId: lead.id }
  });
  if (!conversation) {
    conversation = await prisma.conversation.findFirst({
      where: { tenantId, phone },
      orderBy: { updatedAt: "desc" }
    });
  }
  if (conversation) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        leadId: lead.id,
        phone,
        lastMessage: lead.lastMessage,
        state: "open"
      }
    });
  } else {
    await prisma.conversation.create({
      data: {
        tenantId,
        phone,
        leadId: lead.id,
        lastMessage: lead.lastMessage,
        state: "open"
      }
    });
  }

  await replaceAndInsertDemoMessages(tenantId, phone, {
    lastMessage: lead.lastMessage ?? "Pasame el link de pago por favor",
    conversationStage: "payment_link_sent",
    conversationState: "open"
  });

  console.log("Seed listo:");
  console.log(`  Tenant: ${tenant.name} (${tenantId})`);
  console.log(`  Producto: ${PRODUCT_NAME} (${product.id})`);
  console.log(`  Variante SKU ${VARIANT_SKU} (${variant.id})`);
  console.log(`  Lead: ${lead.id} — tel ${phone} — estado listo_para_cobrar + reserva hasta ${reservationUntil.toISOString()}`);
  console.log(
    "  Mercado Pago: conectá la cuenta en el dashboard; sin token válido el worker usa plantilla de link no disponible."
  );

  if (dbOnly) {
    console.log("Modo --db-only: no se encoló job. Ejecutá sin --db-only con workers y Redis arriba.");
  } else {
    await enqueueLeadProcessingJob({
      tenantId,
      leadId: lead.id,
      phone,
      variantId: variant.id
    });
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
