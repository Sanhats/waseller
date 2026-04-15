/**
 * Crea leads + conversaciones + memoria de embudo para cubrir estados de lead,
 * estados de chat (conversations.state) y etapas (conversation_memory.facts.conversationStage).
 *
 * Uso (desde apps/backend): TENANT_ID=<uuid> npm run seed:demo-scenarios
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import type { LeadStatus } from "@prisma/client";
import { prisma } from "../../../packages/db/src";
import { replaceAndInsertDemoMessages } from "./demo-chat-thread";

const PRODUCT_NAME = "Waseller Seed Remera";
const VARIANT_SKU = "SEED-WASLREM-001";

type Scenario = {
  phone: string;
  customerName: string;
  status: LeadStatus;
  score: number;
  conversationState: "open" | "manual_paused" | "lead_closed";
  conversationStage: string;
  lastMessage: string;
  hasStockReservation: boolean;
  reservationExpiresAt: Date | null;
};

const SCENARIOS: Scenario[] = [
  {
    phone: "549110000001",
    customerName: "Demo — nuevo",
    status: "frio",
    score: 12,
    conversationState: "open",
    conversationStage: "waiting_product",
    lastMessage: "Hola, buen día",
    hasStockReservation: false,
    reservationExpiresAt: null
  },
  {
    phone: "549110000002",
    customerName: "Demo — consulta precio",
    status: "consulta",
    score: 28,
    conversationState: "open",
    conversationStage: "waiting_variant",
    lastMessage: "¿Cuánto sale la remera negra talle M?",
    hasStockReservation: false,
    reservationExpiresAt: null
  },
  {
    phone: "549110000003",
    customerName: "Demo — interesado",
    status: "interesado",
    score: 48,
    conversationState: "open",
    conversationStage: "variant_offered",
    lastMessage: "Dale, me interesa esa variante",
    hasStockReservation: false,
    reservationExpiresAt: null
  },
  {
    phone: "549110000004",
    customerName: "Demo — pausa manual",
    status: "caliente",
    score: 62,
    conversationState: "manual_paused",
    conversationStage: "waiting_reservation_confirmation",
    lastMessage: "Esperá, le pregunto a mi pareja si reservamos",
    hasStockReservation: false,
    reservationExpiresAt: null
  },
  {
    phone: "5491199998888",
    customerName: "Demo — link / cobro",
    status: "listo_para_cobrar",
    score: 88,
    conversationState: "open",
    conversationStage: "payment_link_sent",
    lastMessage: "Pasame el link de pago por favor",
    hasStockReservation: true,
    reservationExpiresAt: new Date(Date.now() + 48 * 3600 * 1000)
  },
  {
    phone: "549110000005",
    customerName: "Demo — elige medio de pago",
    status: "caliente",
    score: 72,
    conversationState: "open",
    conversationStage: "reserved_waiting_payment_method",
    lastMessage: "Reservame una; ¿te pago por MP o en efectivo?",
    hasStockReservation: true,
    reservationExpiresAt: new Date(Date.now() + 24 * 3600 * 1000)
  },
  {
    phone: "549110000008",
    customerName: "Demo — confirma pago",
    status: "caliente",
    score: 76,
    conversationState: "open",
    conversationStage: "waiting_payment_confirmation",
    lastMessage: "Ya pagué, avisame si entró",
    hasStockReservation: true,
    reservationExpiresAt: new Date(Date.now() + 12 * 3600 * 1000)
  },
  {
    phone: "549110000006",
    customerName: "Demo — vendido",
    status: "vendido",
    score: 100,
    conversationState: "lead_closed",
    conversationStage: "sale_confirmed",
    lastMessage: "Listo, ya pagué por el link",
    hasStockReservation: false,
    reservationExpiresAt: null
  },
  {
    phone: "549110000007",
    customerName: "Demo — descartado",
    status: "cerrado",
    score: 5,
    conversationState: "lead_closed",
    conversationStage: "waiting_product",
    lastMessage: "No me interesa más, gracias",
    hasStockReservation: false,
    reservationExpiresAt: null
  }
];

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

async function ensureProductAndVariant(tenantId: string) {
  const product = await prisma.product.upsert({
    where: { tenantId_name: { tenantId, name: PRODUCT_NAME } },
    create: {
      tenantId,
      name: PRODUCT_NAME,
      price: 15900,
      tags: ["seed", "test", "demo"]
    },
    update: { price: 15900, tags: ["seed", "test", "demo"] }
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
  return { product, variant };
}

async function attachConversationAndMemory(
  tenantId: string,
  leadId: string,
  phone: string,
  conversationState: string,
  lastMessage: string,
  conversationStage: string
): Promise<void> {
  let conv = await prisma.conversation.findFirst({ where: { leadId } });
  if (conv) {
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { state: conversationState, phone, lastMessage }
    });
  } else {
    conv = await prisma.conversation.create({
      data: {
        tenantId,
        phone,
        leadId,
        state: conversationState,
        lastMessage
      }
    });
  }
  await prisma.conversationMemory.upsert({
    where: { leadId },
    create: {
      tenantId,
      leadId,
      conversationId: conv.id,
      schemaVersion: 1,
      facts: { conversationStage },
      source: "demo_seed"
    },
    update: {
      conversationId: conv.id,
      facts: { conversationStage },
      source: "demo_seed"
    }
  });
}

async function main(): Promise<void> {
  const defaultEnvPath = pathResolve(__dirname, "../../../infra/env/.env.local");
  loadEnvFile(process.env.SEED_ENV_FILE ?? defaultEnvPath);

  const tenantId = process.env.TENANT_ID?.trim();
  if (!tenantId) {
    console.error("Falta TENANT_ID.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true }
  });
  if (!tenant) {
    console.error(`No existe tenant ${tenantId}`);
    process.exit(1);
  }

  const { product, variant } = await ensureProductAndVariant(tenantId);

  for (const s of SCENARIOS) {
    const existing = await prisma.lead.findFirst({
      where: { tenantId, phone: s.phone },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });
    const lead = existing
      ? await prisma.lead.update({
          where: { id: existing.id },
          data: {
            customerName: s.customerName,
            product: PRODUCT_NAME,
            productVariantId: variant.id,
            productVariantAttributes: { color: "Negro", talle: "M" },
            status: s.status,
            score: s.score,
            hasStockReservation: s.hasStockReservation,
            reservationExpiresAt: s.reservationExpiresAt,
            lastMessage: s.lastMessage
          }
        })
      : await prisma.lead.create({
          data: {
            tenantId,
            phone: s.phone,
            customerName: s.customerName,
            product: PRODUCT_NAME,
            productVariantId: variant.id,
            productVariantAttributes: { color: "Negro", talle: "M" },
            status: s.status,
            score: s.score,
            hasStockReservation: s.hasStockReservation,
            reservationExpiresAt: s.reservationExpiresAt,
            lastMessage: s.lastMessage
          }
        });

    await attachConversationAndMemory(
      tenantId,
      lead.id,
      s.phone,
      s.conversationState,
      s.lastMessage,
      s.conversationStage
    );

    await replaceAndInsertDemoMessages(tenantId, s.phone, {
      lastMessage: s.lastMessage,
      conversationStage: s.conversationStage,
      conversationState: s.conversationState
    });
  }

  console.log(`Demo listo para tenant ${tenant.name} (${tenantId}).`);
  console.log(`Producto ${PRODUCT_NAME} (${product.id}), variante ${VARIANT_SKU} (${variant.id}).`);
  console.log(
    `Filas: ${SCENARIOS.length} leads con mensajes en el chat (tabla messages), embudo y filtros Chat/Embudo.`
  );
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
