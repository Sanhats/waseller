/**
 * Crea un tenant demo completo de boutique de ropa AR para uso comercial:
 *  - Tenant + AppUser admin
 *  - TenantStoreConfig (branding tienda pública)
 *  - TenantKnowledge (perfil de negocio)
 *  - Categorías (Mujer / Hombre con sub-categorías)
 *  - Productos con variantes reales (talles, colores, marcas, precios AR)
 *  - Leads en distintos estados con conversaciones y mensajes
 *
 * Idempotente: usa upsert por whatsappNumber del tenant + sku/slug por tenant.
 *
 * Uso (desde apps/backend):
 *   npm run seed:fashion-demo
 *
 * Variables opcionales:
 *   DEMO_TENANT_NAME       (default: "Olivia Boutique")
 *   DEMO_TENANT_WHATSAPP   (default: "5491140000001")
 *   DEMO_ADMIN_EMAIL       (default: "admin@olivia.demo")
 *   DEMO_ADMIN_PASSWORD    (default: "demo1234")
 *   DEMO_TENANT_SLUG       (default: "olivia-boutique")
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { Prisma, type LeadStatus } from "@prisma/client";
import { prisma } from "../../../packages/db/src";
import { replaceAndInsertDemoMessages } from "./demo-chat-thread";

type ProductSpec = {
  name: string;
  basePrice: number;
  brand: string;
  category: string; // slug categoría hoja
  imageSeed: string;
  description?: string;
  variants: Array<{ color: string; talle: string; stock: number; priceOverride?: number }>;
};

const PRODUCTS: ProductSpec[] = [
  {
    name: "Remera Oversize Algodón",
    basePrice: 18900,
    brand: "Olivia Basics",
    category: "mujer-remeras",
    imageSeed: "fashion-tee-oversize",
    description: "Remera oversize 100% algodón peinado. Caída suave, ideal para uso diario.",
    variants: [
      { color: "Negro", talle: "S", stock: 8 },
      { color: "Negro", talle: "M", stock: 12 },
      { color: "Negro", talle: "L", stock: 6 },
      { color: "Blanco", talle: "S", stock: 10 },
      { color: "Blanco", talle: "M", stock: 14 },
      { color: "Blanco", talle: "L", stock: 5 },
      { color: "Beige", talle: "M", stock: 4 },
      { color: "Beige", talle: "L", stock: 3 }
    ]
  },
  {
    name: "Jean Mom Tiro Alto",
    basePrice: 42900,
    brand: "Olivia Denim",
    category: "mujer-pantalones",
    imageSeed: "fashion-mom-jean",
    description: "Jean mom de tiro alto, denim rígido. Calce holgado en pierna y ajustado en cintura.",
    variants: [
      { color: "Azul medio", talle: "36", stock: 5 },
      { color: "Azul medio", talle: "38", stock: 8 },
      { color: "Azul medio", talle: "40", stock: 7 },
      { color: "Azul medio", talle: "42", stock: 4 },
      { color: "Negro", talle: "38", stock: 6 },
      { color: "Negro", talle: "40", stock: 6 },
      { color: "Negro", talle: "42", stock: 3 }
    ]
  },
  {
    name: "Vestido Lino Verano",
    basePrice: 36500,
    brand: "Olivia Studio",
    category: "mujer-vestidos",
    imageSeed: "fashion-linen-dress",
    description: "Vestido midi de lino, breteles regulables, espalda libre. Forrado.",
    variants: [
      { color: "Crudo", talle: "S", stock: 4 },
      { color: "Crudo", talle: "M", stock: 6 },
      { color: "Crudo", talle: "L", stock: 3 },
      { color: "Verde oliva", talle: "S", stock: 2 },
      { color: "Verde oliva", talle: "M", stock: 5 },
      { color: "Verde oliva", talle: "L", stock: 0 }
    ]
  },
  {
    name: "Buzo Frisa Logo Bordado",
    basePrice: 28900,
    brand: "Olivia Basics",
    category: "mujer-buzos",
    imageSeed: "fashion-hoodie-logo",
    description: "Buzo de frisa pesada con capucha forrada y logo bordado al pecho.",
    variants: [
      { color: "Gris melange", talle: "S", stock: 5 },
      { color: "Gris melange", talle: "M", stock: 9 },
      { color: "Gris melange", talle: "L", stock: 6 },
      { color: "Negro", talle: "M", stock: 4 },
      { color: "Negro", talle: "L", stock: 4 }
    ]
  },
  {
    name: "Pollera Plisada Midi",
    basePrice: 24500,
    brand: "Olivia Studio",
    category: "mujer-polleras",
    imageSeed: "fashion-pleated-skirt",
    variants: [
      { color: "Negro", talle: "S", stock: 3 },
      { color: "Negro", talle: "M", stock: 5 },
      { color: "Negro", talle: "L", stock: 2 },
      { color: "Bordó", talle: "M", stock: 4 }
    ]
  },
  {
    name: "Camisa Lino Manga Larga",
    basePrice: 32900,
    brand: "Olivia Studio",
    category: "mujer-camisas",
    imageSeed: "fashion-linen-shirt",
    variants: [
      { color: "Blanco", talle: "S", stock: 4 },
      { color: "Blanco", talle: "M", stock: 6 },
      { color: "Blanco", talle: "L", stock: 3 },
      { color: "Celeste", talle: "M", stock: 4 }
    ]
  },
  {
    name: "Cartera Bandolera Cuero",
    basePrice: 48900,
    brand: "Olivia Leather",
    category: "mujer-accesorios",
    imageSeed: "fashion-crossbody-bag",
    variants: [
      { color: "Negro", talle: "Único", stock: 6 },
      { color: "Suela", talle: "Único", stock: 4 }
    ]
  },
  {
    name: "Remera Básica Algodón Hombre",
    basePrice: 14900,
    brand: "Olivia Basics",
    category: "hombre-remeras",
    imageSeed: "fashion-mens-tee",
    variants: [
      { color: "Blanco", talle: "M", stock: 10 },
      { color: "Blanco", talle: "L", stock: 12 },
      { color: "Blanco", talle: "XL", stock: 6 },
      { color: "Negro", talle: "M", stock: 8 },
      { color: "Negro", talle: "L", stock: 10 },
      { color: "Negro", talle: "XL", stock: 5 }
    ]
  },
  {
    name: "Pantalón Cargo Hombre",
    basePrice: 38900,
    brand: "Olivia Denim",
    category: "hombre-pantalones",
    imageSeed: "fashion-mens-cargo",
    variants: [
      { color: "Verde militar", talle: "40", stock: 4 },
      { color: "Verde militar", talle: "42", stock: 6 },
      { color: "Verde militar", talle: "44", stock: 5 },
      { color: "Beige", talle: "40", stock: 3 },
      { color: "Beige", talle: "42", stock: 4 },
      { color: "Beige", talle: "44", stock: 2 }
    ]
  },
  {
    name: "Campera Puffer Liviana",
    basePrice: 64900,
    brand: "Olivia Outdoor",
    category: "mujer-camperas",
    imageSeed: "fashion-puffer-jacket",
    description: "Campera puffer ultra liviana, plegable. Relleno sintético térmico.",
    variants: [
      { color: "Negro", talle: "S", stock: 3 },
      { color: "Negro", talle: "M", stock: 5 },
      { color: "Negro", talle: "L", stock: 4 },
      { color: "Verde oliva", talle: "M", stock: 3 },
      { color: "Rosa pálido", talle: "M", stock: 2 }
    ]
  }
];

type CategoryNode = {
  slug: string;
  name: string;
  children?: CategoryNode[];
};

const CATEGORY_TREE: CategoryNode[] = [
  {
    slug: "mujer",
    name: "Mujer",
    children: [
      { slug: "mujer-remeras", name: "Remeras" },
      { slug: "mujer-pantalones", name: "Pantalones y jeans" },
      { slug: "mujer-vestidos", name: "Vestidos" },
      { slug: "mujer-buzos", name: "Buzos y sweaters" },
      { slug: "mujer-camisas", name: "Camisas" },
      { slug: "mujer-polleras", name: "Polleras" },
      { slug: "mujer-camperas", name: "Camperas" },
      { slug: "mujer-accesorios", name: "Accesorios" }
    ]
  },
  {
    slug: "hombre",
    name: "Hombre",
    children: [
      { slug: "hombre-remeras", name: "Remeras" },
      { slug: "hombre-pantalones", name: "Pantalones" }
    ]
  }
];

type ScenarioPhone = {
  phone: string;
  customerName: string;
  status: LeadStatus;
  score: number;
  conversationState: "open" | "manual_paused" | "lead_closed";
  conversationStage: string;
  lastMessage: string;
  productPick: string; // nombre de producto para asociar al lead
  variantPick: { color: string; talle: string };
  hasStockReservation: boolean;
  reservationHoursAhead: number | null;
};

const SCENARIOS: ScenarioPhone[] = [
  {
    phone: "5491166600001",
    customerName: "Camila Pérez",
    status: "consulta",
    score: 24,
    conversationState: "open",
    conversationStage: "waiting_variant",
    lastMessage: "Hola! Tienen el jean mom en talle 38?",
    productPick: "Jean Mom Tiro Alto",
    variantPick: { color: "Azul medio", talle: "38" },
    hasStockReservation: false,
    reservationHoursAhead: null
  },
  {
    phone: "5491166600002",
    customerName: "Lucía Romero",
    status: "interesado",
    score: 52,
    conversationState: "open",
    conversationStage: "variant_offered",
    lastMessage: "Me encanta, me llevo el negro M",
    productPick: "Remera Oversize Algodón",
    variantPick: { color: "Negro", talle: "M" },
    hasStockReservation: false,
    reservationHoursAhead: null
  },
  {
    phone: "5491166600003",
    customerName: "Martina Sosa",
    status: "caliente",
    score: 74,
    conversationState: "open",
    conversationStage: "reserved_waiting_payment_method",
    lastMessage: "Reservame el vestido crudo M, te pago por MP",
    productPick: "Vestido Lino Verano",
    variantPick: { color: "Crudo", talle: "M" },
    hasStockReservation: true,
    reservationHoursAhead: 24
  },
  {
    phone: "5491166600004",
    customerName: "Sofía Acuña",
    status: "listo_para_cobrar",
    score: 88,
    conversationState: "open",
    conversationStage: "payment_link_sent",
    lastMessage: "Pasame el link así pago ya",
    productPick: "Campera Puffer Liviana",
    variantPick: { color: "Negro", talle: "M" },
    hasStockReservation: true,
    reservationHoursAhead: 12
  },
  {
    phone: "5491166600005",
    customerName: "Ana Torres",
    status: "vendido",
    score: 100,
    conversationState: "lead_closed",
    conversationStage: "sale_confirmed",
    lastMessage: "Listo! Ya pagué, gracias",
    productPick: "Buzo Frisa Logo Bordado",
    variantPick: { color: "Gris melange", talle: "M" },
    hasStockReservation: false,
    reservationHoursAhead: null
  },
  {
    phone: "5491166600006",
    customerName: "Pedro Iglesias",
    status: "frio",
    score: 8,
    conversationState: "open",
    conversationStage: "waiting_product",
    lastMessage: "Buenas, vi el cargo en una historia",
    productPick: "Pantalón Cargo Hombre",
    variantPick: { color: "Verde militar", talle: "42" },
    hasStockReservation: false,
    reservationHoursAhead: null
  },
  {
    phone: "5491166600007",
    customerName: "Julieta Méndez",
    status: "caliente",
    score: 68,
    conversationState: "manual_paused",
    conversationStage: "waiting_reservation_confirmation",
    lastMessage: "Esperá que le pregunto a mi mamá si la quiere igual",
    productPick: "Cartera Bandolera Cuero",
    variantPick: { color: "Suela", talle: "Único" },
    hasStockReservation: false,
    reservationHoursAhead: null
  },
  {
    phone: "5491166600008",
    customerName: "Diego Romero",
    status: "cerrado",
    score: 5,
    conversationState: "lead_closed",
    conversationStage: "waiting_product",
    lastMessage: "Al final lo conseguí en otro lado, gracias",
    productPick: "Remera Básica Algodón Hombre",
    variantPick: { color: "Negro", talle: "L" },
    hasStockReservation: false,
    reservationHoursAhead: null
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function hashPassword(pepper: string, tenantId: string, password: string): string {
  return createHash("sha256").update(`${password}:${tenantId}:${pepper}`).digest("hex");
}

function imageUrl(seed: string, idx = 0): string {
  return `https://picsum.photos/seed/${encodeURIComponent(`${seed}-${idx}`)}/800/1000`;
}

function skuFor(productName: string, color: string, talle: string): string {
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return `OLI-${slugify(productName)}-${slugify(color)}-${slugify(talle)}`.slice(0, 64);
}

async function ensureTenant(): Promise<{ id: string; created: boolean }> {
  const tenantName = process.env.DEMO_TENANT_NAME?.trim() || "Olivia Boutique";
  const whatsappNumber = (process.env.DEMO_TENANT_WHATSAPP?.trim() || "5491140000001").replace(/\D/g, "");
  const slug = process.env.DEMO_TENANT_SLUG?.trim() || "olivia-boutique";

  const existing = await prisma.tenant.findFirst({
    where: { whatsappNumber },
    select: { id: true }
  });
  if (existing) {
    await prisma.tenant.update({
      where: { id: existing.id },
      data: { name: tenantName, publicCatalogSlug: slug }
    });
    return { id: existing.id, created: false };
  }
  const tenant = await prisma.tenant.create({
    data: { name: tenantName, whatsappNumber, publicCatalogSlug: slug },
    select: { id: true }
  });
  return { id: tenant.id, created: true };
}

async function ensureAdminUser(tenantId: string): Promise<void> {
  const email = (process.env.DEMO_ADMIN_EMAIL?.trim() || "admin@olivia.demo").toLowerCase();
  const password = process.env.DEMO_ADMIN_PASSWORD?.trim() || "demo1234";
  const pepper = process.env.AUTH_PASSWORD_PEPPER ?? "";
  const passwordHash = hashPassword(pepper, tenantId, password);

  const existing = await prisma.appUser.findFirst({ where: { tenantId, email }, select: { id: true } });
  if (existing) {
    await prisma.appUser.update({
      where: { id: existing.id },
      data: { passwordHash, role: "admin", isActive: true }
    });
    return;
  }
  await prisma.appUser.create({
    data: { tenantId, email, passwordHash, role: "admin", isActive: true }
  });
}

async function ensureStoreConfig(tenantId: string): Promise<void> {
  const config = {
    brandName: "Olivia Boutique",
    tagline: "Ropa con onda, calce real",
    primaryColor: "#19485F",
    accentColor: "#E8B4A0",
    logoUrl: imageUrl("olivia-logo", 0),
    bannerUrl: imageUrl("olivia-banner", 0),
    contact: {
      whatsapp: process.env.DEMO_TENANT_WHATSAPP?.trim() || "5491140000001",
      instagram: "@olivia.boutique",
      address: "Av. Cabildo 1234, CABA"
    },
    shippingNotes: "Envíos a todo el país. Retiro en local sin costo (lunes a sábado 11 a 19hs).",
    paymentMethods: ["Mercado Pago", "Efectivo en local", "Transferencia"]
  };
  await prisma.tenantStoreConfig.upsert({
    where: { tenantId },
    create: { tenantId, config },
    update: { config }
  });
}

async function ensureKnowledge(tenantId: string): Promise<void> {
  const profile = {
    businessPublicName: "Olivia Boutique",
    tone: "cercano, amable, sin formalidades pero profesional",
    deliveryInfo:
      "Envíos por Andreani a todo el país (24-72hs). Retiro gratis en local. Envío gratis sobre $40.000.",
    paymentPolicy: { allowExchange: true, allowReturns: true, notes: "Cambios dentro de 15 días con etiqueta" },
    shippingNotes: "Envíos por Andreani 24-72hs"
  };
  await prisma.tenantKnowledge.upsert({
    where: { tenantId },
    create: {
      tenantId,
      businessCategory: "ropa",
      businessLabels: ["mujer", "hombre", "indumentaria"],
      profile
    },
    update: {
      businessCategory: "ropa",
      businessLabels: ["mujer", "hombre", "indumentaria"],
      profile
    }
  });
}

async function ensureCategoryTree(tenantId: string): Promise<Map<string, string>> {
  const slugToId = new Map<string, string>();
  for (const root of CATEGORY_TREE) {
    const rootCat = await prisma.category.upsert({
      where: { tenantId_slug: { tenantId, slug: root.slug } },
      create: { tenantId, slug: root.slug, name: root.name, sortOrder: 0, isActive: true },
      update: { name: root.name, isActive: true }
    });
    slugToId.set(root.slug, rootCat.id);
    let order = 0;
    for (const child of root.children ?? []) {
      const childCat = await prisma.category.upsert({
        where: { tenantId_slug: { tenantId, slug: child.slug } },
        create: {
          tenantId,
          slug: child.slug,
          name: child.name,
          sortOrder: order,
          isActive: true,
          parentId: rootCat.id
        },
        update: { name: child.name, parentId: rootCat.id, isActive: true }
      });
      slugToId.set(child.slug, childCat.id);
      order += 1;
    }
  }
  return slugToId;
}

async function ensureProducts(
  tenantId: string,
  categoryIds: Map<string, string>
): Promise<Map<string, { productId: string; variants: Map<string, string> }>> {
  const result = new Map<string, { productId: string; variants: Map<string, string> }>();
  for (const spec of PRODUCTS) {
    const categoryId = categoryIds.get(spec.category);
    const product = await prisma.product.upsert({
      where: { tenantId_name: { tenantId, name: spec.name } },
      create: {
        tenantId,
        name: spec.name,
        price: new Prisma.Decimal(spec.basePrice),
        imageUrl: imageUrl(spec.imageSeed, 0),
        imageUrls: [imageUrl(spec.imageSeed, 0), imageUrl(spec.imageSeed, 1), imageUrl(spec.imageSeed, 2)],
        tags: ["demo", spec.brand.toLowerCase().replace(/\s+/g, "-")]
      },
      update: {
        price: new Prisma.Decimal(spec.basePrice),
        imageUrl: imageUrl(spec.imageSeed, 0),
        imageUrls: [imageUrl(spec.imageSeed, 0), imageUrl(spec.imageSeed, 1), imageUrl(spec.imageSeed, 2)],
        tags: ["demo", spec.brand.toLowerCase().replace(/\s+/g, "-")]
      }
    });

    if (categoryId) {
      await prisma.productCategory.upsert({
        where: { productId_categoryId: { productId: product.id, categoryId } },
        create: { productId: product.id, categoryId },
        update: {}
      });
    }

    const variantMap = new Map<string, string>();
    for (const v of spec.variants) {
      const sku = skuFor(spec.name, v.color, v.talle);
      const attrs = { color: v.color, talle: v.talle, marca: spec.brand };
      const variant = await prisma.productVariant.upsert({
        where: { tenantId_sku: { tenantId, sku } },
        create: {
          tenantId,
          productId: product.id,
          sku,
          attributes: attrs,
          variantTalle: v.talle,
          variantColor: v.color,
          variantMarca: spec.brand,
          price: v.priceOverride != null ? new Prisma.Decimal(v.priceOverride) : null,
          stock: v.stock,
          reservedStock: 0,
          isActive: true,
          imageUrls: [imageUrl(spec.imageSeed, 0)]
        },
        update: {
          productId: product.id,
          attributes: attrs,
          variantTalle: v.talle,
          variantColor: v.color,
          variantMarca: spec.brand,
          stock: v.stock,
          isActive: true
        }
      });
      if (categoryId) {
        await prisma.variantCategory.upsert({
          where: { variantId_categoryId: { variantId: variant.id, categoryId } },
          create: { variantId: variant.id, categoryId },
          update: {}
        });
      }
      variantMap.set(`${v.color}|${v.talle}`, variant.id);
    }
    result.set(spec.name, { productId: product.id, variants: variantMap });
  }
  return result;
}

async function ensureLeadsAndConversations(
  tenantId: string,
  productMap: Map<string, { productId: string; variants: Map<string, string> }>
): Promise<void> {
  for (const s of SCENARIOS) {
    const productEntry = productMap.get(s.productPick);
    const variantId = productEntry?.variants.get(`${s.variantPick.color}|${s.variantPick.talle}`) ?? null;

    const existing = await prisma.lead.findFirst({
      where: { tenantId, phone: s.phone },
      orderBy: { updatedAt: "desc" },
      select: { id: true }
    });
    const reservationExpiresAt =
      s.hasStockReservation && s.reservationHoursAhead
        ? new Date(Date.now() + s.reservationHoursAhead * 3600 * 1000)
        : null;

    const leadData = {
      customerName: s.customerName,
      product: s.productPick,
      productVariantId: variantId,
      productVariantAttributes: { color: s.variantPick.color, talle: s.variantPick.talle },
      status: s.status,
      score: s.score,
      hasStockReservation: s.hasStockReservation,
      reservationExpiresAt,
      lastMessage: s.lastMessage
    };

    const lead = existing
      ? await prisma.lead.update({ where: { id: existing.id }, data: leadData })
      : await prisma.lead.create({ data: { tenantId, phone: s.phone, ...leadData } });

    let conv = await prisma.conversation.findFirst({ where: { leadId: lead.id } });
    if (conv) {
      conv = await prisma.conversation.update({
        where: { id: conv.id },
        data: { state: s.conversationState, phone: s.phone, lastMessage: s.lastMessage }
      });
    } else {
      conv = await prisma.conversation.create({
        data: {
          tenantId,
          phone: s.phone,
          leadId: lead.id,
          state: s.conversationState,
          lastMessage: s.lastMessage
        }
      });
    }

    await prisma.conversationMemory.upsert({
      where: { leadId: lead.id },
      create: {
        tenantId,
        leadId: lead.id,
        conversationId: conv.id,
        schemaVersion: 1,
        facts: { conversationStage: s.conversationStage },
        source: "fashion_demo_seed"
      },
      update: {
        conversationId: conv.id,
        facts: { conversationStage: s.conversationStage },
        source: "fashion_demo_seed"
      }
    });

    await replaceAndInsertDemoMessages(tenantId, s.phone, {
      lastMessage: s.lastMessage,
      conversationStage: s.conversationStage,
      conversationState: s.conversationState
    });
  }
}

async function main(): Promise<void> {
  const defaultEnvPath = pathResolve(__dirname, "../../../infra/env/.env.local");
  loadEnvFile(process.env.SEED_ENV_FILE ?? defaultEnvPath);

  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL. Configurá infra/env/.env.local o exportá la variable.");
    process.exit(1);
  }

  console.log("→ Creando/actualizando tenant demo de boutique de ropa…");
  const { id: tenantId, created } = await ensureTenant();
  console.log(`  Tenant ${created ? "creado" : "actualizado"}: ${tenantId}`);

  await ensureAdminUser(tenantId);
  console.log("  Admin user listo.");

  await ensureStoreConfig(tenantId);
  await ensureKnowledge(tenantId);
  console.log("  Branding + perfil de negocio cargados.");

  const categoryIds = await ensureCategoryTree(tenantId);
  console.log(`  ${categoryIds.size} categorías creadas/actualizadas.`);

  const productMap = await ensureProducts(tenantId, categoryIds);
  let totalVariants = 0;
  for (const v of productMap.values()) totalVariants += v.variants.size;
  console.log(`  ${productMap.size} productos / ${totalVariants} variantes cargadas.`);

  await ensureLeadsAndConversations(tenantId, productMap);
  console.log(`  ${SCENARIOS.length} leads + conversaciones + mensajes demo creados.`);

  const slug = process.env.DEMO_TENANT_SLUG?.trim() || "olivia-boutique";
  const email = (process.env.DEMO_ADMIN_EMAIL?.trim() || "admin@olivia.demo").toLowerCase();
  const password = process.env.DEMO_ADMIN_PASSWORD?.trim() || "demo1234";

  console.log("\n✅ Demo lista.");
  console.log(`   Login dashboard:`);
  console.log(`     email:    ${email}`);
  console.log(`     password: ${password}`);
  console.log(`     tenantId: ${tenantId}`);
  console.log(`   Tienda pública: /tienda/${slug}`);

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
