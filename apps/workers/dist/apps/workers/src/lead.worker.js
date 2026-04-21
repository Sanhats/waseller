"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadWorker = void 0;
const bullmq_1 = require("bullmq");
const src_1 = require("../../../packages/queue/src");
const src_2 = require("../../../packages/db/src");
const src_3 = require("../../../packages/shared/src");
const queue_metrics_service_1 = require("./services/queue-metrics.service");
const bot_template_service_1 = require("./services/bot-template.service");
const mercado_pago_payment_service_1 = require("./services/mercado-pago-payment.service");
const conversation_policy_service_1 = require("./services/conversation-policy.service");
const conversation_recent_messages_service_1 = require("./services/conversation-recent-messages.service");
const shadow_compare_service_1 = require("./services/shadow-compare.service");
const tenant_knowledge_service_1 = require("./services/tenant-knowledge.service");
const leadMetrics = new queue_metrics_service_1.QueueMetricsService(src_1.QueueNames.leadProcessing);
const templateService = new bot_template_service_1.BotTemplateService();
const mercadoPagoPaymentService = new mercado_pago_payment_service_1.MercadoPagoPaymentService();
const tenantKnowledgeService = new tenant_knowledge_service_1.TenantKnowledgeService();
const defaultInterpretationForCrew = (job) => ({
    intent: job.intent ?? "desconocida",
    confidence: 0.72,
    entities: {
        productName: job.productName ?? null,
        variantId: job.variantId ?? null
    },
    references: [],
    missingFields: job.missingAxes ?? [],
    nextAction: "reply_only",
    source: "rules"
});
const buildLeadTemplateBaselineDecision = (job, draftReply, interpretation) => {
    const leadStage = job.status === "listo_para_cobrar" || job.status === "vendido" ? "decision" : "consideration";
    return {
        intent: interpretation.intent ?? job.intent ?? "desconocida",
        leadStage,
        confidence: 0.78,
        entities: {
            productName: job.productName ?? null,
            variantId: job.variantId ?? null
        },
        nextAction: interpretation.nextAction ?? "reply_only",
        reason: "lead_worker_template_baseline",
        requiresHuman: false,
        recommendedAction: interpretation.nextAction ?? "reply_only",
        draftReply,
        handoffRequired: false,
        qualityFlags: ["lead_template_baseline"],
        source: "fallback",
        provider: "rules",
        model: "lead-template"
    };
};
/** Postgres / drivers pueden devolver DECIMAL como string u objeto; evita NaN y salto a derivación sin MP. */
const coerceUnitPrice = (value) => {
    if (value === null || value === undefined)
        return NaN;
    if (typeof value === "number")
        return value;
    if (typeof value === "bigint")
        return Number(value);
    if (typeof value === "string")
        return Number(value.replace(",", "."));
    if (typeof value === "object" && value !== null && "toString" in value) {
        return Number(String(value).replace(",", "."));
    }
    return NaN;
};
const playbookCache = new Map();
const performanceCache = new Map();
const FIRST_CONSULT_IMAGE_WINDOW_MINUTES = Number(process.env.FIRST_CONSULT_IMAGE_WINDOW_MINUTES ?? 30);
const PLAYBOOK_EXPLORATION_RATE = Number(process.env.PLAYBOOK_EXPLORATION_RATE ?? 0.2);
const PLAYBOOK_OVERRIDE_CONFIDENCE_MAX = Number(process.env.PLAYBOOK_OVERRIDE_CONFIDENCE_MAX ?? 0.55);
const PLAYBOOK_REBALANCE_MIN_SENT = Number(process.env.PLAYBOOK_REBALANCE_MIN_SENT ?? 30);
const PLAYBOOK_REBALANCE_INTERVAL_MS = Number(process.env.PLAYBOOK_REBALANCE_INTERVAL_MS ?? 15 * 60 * 1000);
const lastRebalanceByKey = new Map();
const normalizeText = (value) => value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const isLlmShadowDecision = (decision) => {
    if (!decision)
        return false;
    if (decision.executionMode === "shadow")
        return true;
    if (decision.policy?.shadowMode)
        return true;
    return false;
};
const AXIS_LABELS = {
    talle: { singular: "talle", plural: "talles" },
    color: { singular: "color", plural: "colores" },
    tamano: { singular: "tamaño", plural: "tamaños" },
    tamaño: { singular: "tamaño", plural: "tamaños" },
    capacidad: { singular: "capacidad", plural: "capacidades" },
    modelo: { singular: "modelo", plural: "modelos" },
    material: { singular: "material", plural: "materiales" },
    sabor: { singular: "sabor", plural: "sabores" },
    fragancia: { singular: "fragancia", plural: "fragancias" }
};
const humanizeAxisLabel = (axis, mode) => {
    const normalized = normalizeText(String(axis ?? "").trim());
    const mapped = AXIS_LABELS[normalized];
    if (mapped)
        return mapped[mode];
    if (mode === "singular")
        return axis;
    if (axis.endsWith("s"))
        return axis;
    const lastChar = axis.at(-1)?.toLowerCase() ?? "";
    return ["a", "e", "i", "o", "u"].includes(lastChar) ? `${axis}s` : `${axis}es`;
};
const resolvePlaybookIntent = (payload) => {
    if (payload.intent === "reportar_pago" ||
        payload.intent === "pedir_link_pago" ||
        payload.stockReserved ||
        payload.status === "listo_para_cobrar" ||
        payload.status === "vendido") {
        return "cierre";
    }
    if (payload.intent === "consultar_precio")
        return "precio";
    if (payload.intent === "buscar_producto" ||
        payload.intent === "consultar_talle" ||
        payload.intent === "consultar_color" ||
        payload.intent === "elegir_variante" ||
        payload.intent === "sin_stock" ||
        payload.intent === "multi_producto") {
        return "stock";
    }
    return "objecion";
};
const upsertConversationFacts = async (input) => {
    try {
        await src_2.prisma.conversationMemory.upsert({
            where: { leadId: input.leadId },
            update: {
                facts: {
                    intent: input.interpretation?.intent ?? input.decision?.intent ?? null,
                    leadStage: input.decision?.leadStage ?? null,
                    conversationStage: input.conversationStage,
                    recommendedAction: input.decision?.recommendedAction ?? input.interpretation?.nextAction ?? null,
                    entities: input.decision?.entities ?? input.interpretation?.entities ?? {},
                    interpretation: input.interpretation ?? null,
                    activeProductName: input.activeOffer?.productName ??
                        (typeof input.decision?.entities?.productName === "string" ? input.decision.entities.productName : null),
                    activeOffer: input.activeOffer,
                    lastRecommendedAction: input.decision?.nextAction ?? input.interpretation?.nextAction ?? null,
                    extractionConfidence: input.decision?.confidence ?? input.interpretation?.confidence ?? 0,
                    missingFields: input.interpretation?.missingFields ?? []
                },
                source: input.decision?.source ?? input.interpretation?.source ?? "rules",
                schemaVersion: src_1.JOB_SCHEMA_VERSION
            },
            create: {
                tenantId: input.tenantId,
                leadId: input.leadId,
                schemaVersion: src_1.JOB_SCHEMA_VERSION,
                facts: {
                    intent: input.interpretation?.intent ?? input.decision?.intent ?? null,
                    leadStage: input.decision?.leadStage ?? null,
                    conversationStage: input.conversationStage,
                    recommendedAction: input.decision?.recommendedAction ?? input.interpretation?.nextAction ?? null,
                    entities: input.decision?.entities ?? input.interpretation?.entities ?? {},
                    interpretation: input.interpretation ?? null,
                    activeProductName: input.activeOffer?.productName ??
                        (typeof input.decision?.entities?.productName === "string" ? input.decision.entities.productName : null),
                    activeOffer: input.activeOffer,
                    lastRecommendedAction: input.decision?.nextAction ?? input.interpretation?.nextAction ?? null,
                    extractionConfidence: input.decision?.confidence ?? input.interpretation?.confidence ?? 0,
                    missingFields: input.interpretation?.missingFields ?? []
                },
                source: input.decision?.source ?? input.interpretation?.source ?? "rules"
            }
        });
    }
    catch {
        // Si la tabla/migración no está disponible no frenamos el envío.
    }
};
const extractSizesFromVariants = (variants) => {
    const values = new Set();
    for (const item of variants) {
        const talle = item.attributes?.talle;
        if (talle === undefined || talle === null)
            continue;
        const normalized = String(talle).trim();
        if (normalized)
            values.add(normalized);
    }
    return Array.from(values).sort((a, b) => Number(a) - Number(b));
};
const collectAxisOptions = (variants, axes) => {
    const result = {};
    for (const axis of axes) {
        const values = new Set();
        for (const item of variants) {
            const raw = item.attributes?.[axis];
            if (raw === undefined || raw === null)
                continue;
            const normalized = String(raw).trim();
            if (normalized)
                values.add(normalized);
        }
        result[axis] = Array.from(values).sort((a, b) => a.localeCompare(b, "es"));
    }
    return result;
};
const describeMissingAxes = (optionsByAxis, axes) => {
    const labels = axes
        .map((axis) => {
        const values = optionsByAxis[axis] ?? [];
        if (values.length === 0)
            return humanizeAxisLabel(axis, "plural");
        return `${humanizeAxisLabel(axis, "plural")}: ${values.join(", ")}`;
    })
        .filter(Boolean);
    return labels.join("; ");
};
const formatAxisPrompt = (axes) => {
    const labels = axes.map((axis) => humanizeAxisLabel(axis, "singular"));
    if (labels.length <= 1)
        return labels[0] ?? "";
    return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
};
const filterAxesWithOptions = (optionsByAxis, axes) => axes.filter((axis) => (optionsByAxis[axis] ?? []).length > 0);
const formatAttributePhrase = (attributes, axes) => {
    const orderedKeys = [
        ...(axes ?? []),
        ...Object.keys(attributes).filter((key) => !(axes ?? []).includes(key))
    ].filter((key, index, list) => list.indexOf(key) === index);
    const parts = orderedKeys
        .map((axis) => {
        const value = String(attributes[axis] ?? "").trim();
        if (!value)
            return "";
        return `${humanizeAxisLabel(axis, "singular")} ${value}`;
    })
        .filter(Boolean);
    if (parts.length <= 1)
        return parts[0] ?? "";
    return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
};
const describeAvailableCombinations = (variants, preferredAxes) => {
    const combinations = variants
        .filter((item) => Math.max(Number(item.stock) - Number(item.reservedStock), 0) > 0)
        .map((item) => formatAttributePhrase(Object.fromEntries(Object.entries(item.attributes ?? {}).map(([key, value]) => [String(key), String(value ?? "").trim()])), preferredAxes))
        .filter(Boolean);
    return Array.from(new Set(combinations)).join("; ");
};
const weightedRandom = (rows) => {
    if (rows.length === 0)
        return null;
    const total = rows.reduce((acc, row) => acc + Math.max(row.weight, 1), 0);
    let pointer = Math.random() * total;
    for (const row of rows) {
        pointer -= Math.max(row.weight, 1);
        if (pointer <= 0)
            return row;
    }
    return rows[rows.length - 1] ?? null;
};
const deterministicWeightedPick = (rows, seed) => {
    if (rows.length === 0)
        return null;
    const total = rows.reduce((acc, row) => acc + Math.max(row.weight, 1), 0);
    const hash = Array.from(seed).reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0, 5381);
    let pointer = total > 0 ? hash % total : 0;
    for (const row of rows) {
        pointer -= Math.max(row.weight, 1);
        if (pointer < 0)
            return row;
    }
    return rows[rows.length - 1] ?? null;
};
const withWeight = (row, weight) => ({
    intent: row.intent,
    variant: row.variant,
    template: row.template,
    weight
});
const renderTemplate = (template, data) => {
    return template
        .replaceAll("{product_name}", data.productName)
        .replaceAll("{price}", data.price)
        .replaceAll("{available_stock}", String(data.availableStock));
};
const loadPlaybooks = async (tenantId, intent) => {
    const cacheKey = `${tenantId}:${intent}`;
    const cached = playbookCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now)
        return cached.rows;
    try {
        const rows = (await src_2.prisma.$queryRaw `
      select
        intent,
        variant,
        template,
        weight::int as weight
      from public.bot_playbooks
      where tenant_id::text = ${tenantId}
        and intent = ${intent}
        and is_active = true
      order by variant asc
    `);
        playbookCache.set(cacheKey, { rows, expiresAt: now + 60_000 });
        return rows;
    }
    catch {
        return [];
    }
};
const loadVariantPerformance = async (tenantId, intent) => {
    const cacheKey = `${tenantId}:${intent}`;
    const cached = performanceCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now)
        return cached.rows;
    try {
        const rows = (await src_2.prisma.$queryRaw `
      select
        e.variant,
        count(*)::int as "sentCount",
        sum(case when l.has_stock_reservation = true then 1 else 0 end)::int as "reservedCount",
        sum(case when l.status = 'vendido' then 1 else 0 end)::int as "soldCount"
      from public.bot_response_events e
      left join public.leads l
        on l.id = e.lead_id
      where e.tenant_id::text = ${tenantId}
        and e.intent = ${intent}
        and e.created_at >= now() - interval '30 days'
      group by e.variant
    `);
        performanceCache.set(cacheKey, { rows, expiresAt: now + 60_000 });
        return rows;
    }
    catch {
        return [];
    }
};
const chooseAdaptivePlaybook = async (tenantId, intent, playbooks, phone) => {
    if (playbooks.length === 0)
        return null;
    // Keeps exploration to avoid freezing one variant forever.
    if (Math.random() < PLAYBOOK_EXPLORATION_RATE) {
        return weightedRandom(playbooks);
    }
    const performance = await loadVariantPerformance(tenantId, intent);
    if (performance.length === 0) {
        return weightedRandom(playbooks);
    }
    const byVariant = new Map(performance.map((row) => [row.variant, row]));
    const adapted = playbooks.map((row) => {
        const perf = byVariant.get(row.variant);
        if (!perf || perf.sentCount <= 0)
            return row;
        const sent = Math.max(perf.sentCount, 1);
        const closeRate = (perf.soldCount + 1) / (sent + 2);
        const reserveRate = (perf.reservedCount + 1) / (sent + 2);
        const qualityScore = closeRate * 0.7 + reserveRate * 0.3;
        const multiplier = 0.7 + qualityScore * 2.2;
        const nextWeight = Math.max(1, Math.round(row.weight * multiplier));
        return withWeight(row, nextWeight);
    });
    return deterministicWeightedPick(adapted, `${tenantId}:${intent}:${phone}`);
};
const maybeRebalancePlaybooks = async (tenantId, intent, playbooks, performance) => {
    const key = `${tenantId}:${intent}`;
    const now = Date.now();
    const last = lastRebalanceByKey.get(key) ?? 0;
    if (now - last < PLAYBOOK_REBALANCE_INTERVAL_MS)
        return;
    lastRebalanceByKey.set(key, now);
    if (playbooks.length < 2 || performance.length === 0)
        return;
    const perfByVariant = new Map(performance.map((row) => [row.variant, row]));
    const scored = playbooks.map((row) => {
        const perf = perfByVariant.get(row.variant);
        const sent = Math.max(perf?.sentCount ?? 0, 0);
        const sold = Math.max(perf?.soldCount ?? 0, 0);
        const reserved = Math.max(perf?.reservedCount ?? 0, 0);
        const closeRate = sent > 0 ? sold / sent : 0;
        const reserveRate = sent > 0 ? reserved / sent : 0;
        const score = closeRate * 0.7 + reserveRate * 0.3;
        return { variant: row.variant, sent, sold, reserved, score };
    });
    const eligible = scored.filter((item) => item.sent >= PLAYBOOK_REBALANCE_MIN_SENT);
    if (eligible.length === 0)
        return;
    const maxScore = Math.max(...eligible.map((item) => item.score));
    for (const item of eligible) {
        const nextWeight = Math.max(1, Math.round(15 + (item.score / Math.max(maxScore, 0.001)) * 85));
        await src_2.prisma.$executeRaw `
      update public.bot_playbooks
      set weight = ${nextWeight},
          updated_at = now()
      where tenant_id::text = ${tenantId}
        and intent = ${intent}
        and variant = ${item.variant}
    `;
    }
    for (const item of eligible) {
        if (item.sent < PLAYBOOK_REBALANCE_MIN_SENT * 2)
            continue;
        if (item.sold > 0 || item.reserved > 0)
            continue;
        await src_2.prisma.$executeRaw `
      update public.bot_playbooks
      set is_active = false,
          updated_at = now()
      where tenant_id::text = ${tenantId}
        and intent = ${intent}
        and variant = ${item.variant}
        and (select count(*) from public.bot_playbooks bp
             where bp.tenant_id::text = ${tenantId}
               and bp.intent = ${intent}
               and bp.is_active = true) > 1
    `;
    }
};
exports.leadWorker = new bullmq_1.Worker(src_1.QueueNames.leadProcessing, async (job) => {
    const { tenantId, leadId, phone, status } = job.data;
    const businessIntents = new Set([
        "buscar_producto",
        "consultar_precio",
        "consultar_talle",
        "confirmar_compra",
        "reportar_pago",
        "sin_stock",
        "multi_producto"
    ]);
    const fallbackBusinessRelated = Boolean(job.data.productName || job.data.variantId) ||
        (job.data.intent ? businessIntents.has(job.data.intent) : false);
    const isBusinessRelated = job.data.isBusinessRelated ?? fallbackBusinessRelated;
    if (!isBusinessRelated)
        return;
    const lead = await src_2.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead)
        return;
    const effectiveVariantId = job.data.variantId && job.data.variantId.trim().length > 0 ? job.data.variantId : lead.productVariantId;
    const effectiveProductName = String(job.data.productName ?? lead.product ?? "")
        .trim();
    const variantRows = effectiveVariantId && effectiveVariantId.trim().length > 0
        ? (await src_2.prisma.$queryRaw `
            select
              v.id as "variantId",
              v.product_id as "productId",
              v.sku,
              v.attributes,
              v.stock,
              v.reserved_stock as "reservedStock",
              coalesce(v.price, p.price) as "effectivePrice",
              p.name as "productName",
              p.image_url as "imageUrl",
              p.tags
            from public.product_variants v
            inner join public.products p on p.id = v.product_id
            where v.tenant_id::text = ${tenantId}
              and v.id::text = ${effectiveVariantId}
            limit 1
          `)
        : [];
    const variant = variantRows[0] ?? null;
    const productContextRows = !variant && effectiveProductName
        ? (await src_2.prisma.$queryRaw `
            select
              p.id as "productId",
              p.name as "productName",
              p.price as "basePrice",
              p.image_url as "imageUrl",
              p.tags
            from public.products p
            where p.tenant_id::text = ${tenantId}
              and p.name = ${effectiveProductName}
            limit 1
          `)
        : [];
    const productContext = productContextRows[0] ?? null;
    const availableStock = variant ? Math.max(Number(variant.stock) - Number(variant.reservedStock), 0) : 0;
    const siblingVariants = variant || productContext
        ? (await src_2.prisma.$queryRaw `
          select
            v.id as "variantId",
            v.attributes,
            v.stock,
            v.reserved_stock as "reservedStock"
          from public.product_variants v
          where v.tenant_id::text = ${tenantId}
            and v.product_id::text = ${(variant?.productId ?? productContext?.productId) ?? ""}
            and v.is_active = true
        `)
        : [];
    const availableSiblingVariants = siblingVariants.filter((item) => Math.max(Number(item.stock) - Number(item.reservedStock), 0) > 0);
    const availableSizes = extractSizesFromVariants(availableSiblingVariants);
    const missingAxes = Array.isArray(job.data.missingAxes)
        ? job.data.missingAxes.map((item) => String(item).trim()).filter(Boolean)
        : [];
    const requestedAttributes = Object.fromEntries(Object.entries(job.data.requestedAttributes ?? {}).map(([key, value]) => [String(key), String(value)]));
    const unavailableCombination = Boolean(job.data.unavailableCombination);
    const variantAttributeMap = variant
        ? Object.fromEntries(Object.entries(variant.attributes ?? {}).map(([key, value]) => [String(key), String(value ?? "").trim()]))
        : {};
    const variantSummary = formatAttributePhrase(variantAttributeMap, Object.keys(requestedAttributes).length > 0 ? Object.keys(requestedAttributes) : Object.keys(variantAttributeMap));
    const axisOptions = collectAxisOptions(availableSiblingVariants, missingAxes);
    const visibleAxes = filterAxesWithOptions(axisOptions, missingAxes);
    const incomingText = normalizeText(job.data.incomingMessage ?? "");
    const shadowLlm = isLlmShadowDecision(job.data.llmDecision);
    const wantsPaymentLink = incomingText.includes("link de pago") ||
        incomingText.includes("un link") ||
        incomingText.includes("pasame el link") ||
        incomingText.includes("enviame el link") ||
        incomingText.includes("mandame el link") ||
        /\bmercado\s*pago\b/.test(incomingText) ||
        incomingText.includes("pago online") ||
        incomingText.includes("pago con tarjeta") ||
        incomingText.includes("quiero pagar con") ||
        (incomingText.includes("prefiero") &&
            (incomingText.includes("link") || incomingText.includes("mercado") || incomingText.includes("pago online")));
    const wantsCashPayment = incomingText.includes("efectivo") ||
        incomingText.includes("contado") ||
        incomingText.includes("cash");
    const formattedPrice = variant && variant.effectivePrice !== null && variant.effectivePrice !== undefined
        ? Number(variant.effectivePrice).toLocaleString("es-AR")
        : productContext?.basePrice !== null && productContext?.basePrice !== undefined
            ? Number(productContext.basePrice).toLocaleString("es-AR")
            : null;
    const exactVariantPriceText = formattedPrice ? ` Sale $${formattedPrice}.` : "";
    const hasActiveReservation = Boolean(lead.hasStockReservation) &&
        (!lead.reservationExpiresAt || new Date(lead.reservationExpiresAt).getTime() > Date.now());
    const shouldUseReservationContext = status === "listo_para_cobrar" ||
        job.data.intent === "confirmar_compra" ||
        job.data.intent === "aceptar_oferta" ||
        job.data.intent === "pedir_link_pago" ||
        job.data.intent === "elegir_medio_pago" ||
        job.data.intent === "reportar_pago";
    const reservationInThisFlow = Boolean(job.data.stockReserved) ||
        ((hasActiveReservation || lead.status === "listo_para_cobrar") && shouldUseReservationContext);
    const resolvedUnitPrice = variant
        ? coerceUnitPrice(variant.effectivePrice)
        : productContext
            ? coerceUnitPrice(productContext.basePrice)
            : NaN;
    const hasSellablePrice = Number.isFinite(resolvedUnitPrice) && resolvedUnitPrice > 0;
    const llmNextActionForPayment = shadowLlm ? undefined : job.data.llmDecision?.nextAction;
    const shouldGeneratePaymentLink = reservationInThisFlow &&
        Boolean(variant?.variantId) &&
        hasSellablePrice &&
        !unavailableCombination &&
        (wantsPaymentLink ||
            job.data.intent === "pedir_link_pago" ||
            job.data.interpretation?.nextAction === "share_payment_link" ||
            llmNextActionForPayment === "share_payment_link");
    const initialLlmDraft = !shadowLlm && job.data.llmDecision?.draftReply ? job.data.llmDecision.draftReply : undefined;
    let message = initialLlmDraft ??
        "Gracias por tu consulta. Te ayudo con disponibilidad y precio ahora.";
    let selectedVariant = "fallback";
    const playbookIntent = resolvePlaybookIntent(job.data);
    if (initialLlmDraft && job.data.llmDecision) {
        message = initialLlmDraft;
        selectedVariant = `llm-${job.data.llmDecision.source}`;
    }
    else if (!variant && !productContext) {
        message = await templateService.getTemplate(tenantId, "lead_no_product");
    }
    else if (unavailableCombination) {
        const productName = variant?.productName ?? productContext?.productName ?? effectiveProductName;
        const requestedSummary = formatAttributePhrase(requestedAttributes, Object.keys(requestedAttributes));
        const availableCombinations = describeAvailableCombinations(availableSiblingVariants, Object.keys(requestedAttributes));
        message = availableCombinations
            ? `No tengo ${productName} en ${requestedSummary}. Hoy sí me quedan: ${availableCombinations}.`
            : `No tengo ${productName} en ${requestedSummary} en este momento. Si querés, te aviso apenas entre esa variante.`;
        selectedVariant = "unavailable-combination";
    }
    else if (job.data.intent === "reportar_pago" && variant) {
        message = await templateService.render(tenantId, "manual_payment_validation", {
            product_name: variant.productName
        });
        selectedVariant = "manual-payment-validation";
    }
    else if (shouldGeneratePaymentLink && variant) {
        try {
            await mercadoPagoPaymentService.createPaymentLink({
                tenantId,
                leadId,
                phone,
                productVariantId: variant.variantId,
                title: `${variant.productName}${variantSummary ? ` - ${variantSummary}` : ""}`,
                amount: resolvedUnitPrice,
                metadata: {
                    productName: variant.productName,
                    variantAttributes: variantAttributeMap
                }
            });
            await src_2.prisma.lead.update({
                where: { id: leadId },
                data: {
                    status: "listo_para_cobrar",
                    score: Math.max(120, lead.score ?? 0)
                }
            });
            message = await templateService.render(tenantId, "payment_link_ready_for_review", {
                product_name: variant.productName
            });
            selectedVariant = "payment-link-ready-review";
        }
        catch (error) {
            const fallbackKey = error instanceof Error && error.message.includes("No hay una cuenta de Mercado Pago conectada")
                ? "payment_link_unavailable"
                : "reservation_payment_link_handoff";
            message = await templateService.render(tenantId, fallbackKey, {
                product_name: variant.productName
            });
            selectedVariant = fallbackKey;
        }
    }
    else if (missingAxes.length > 0) {
        const axisSummary = describeMissingAxes(axisOptions, visibleAxes);
        const axisPrompt = formatAxisPrompt(visibleAxes);
        message = axisSummary
            ? `Sí, tenemos ${variant?.productName ?? productContext?.productName ?? effectiveProductName}. Para avanzar decime ${axisPrompt}. Hoy tenemos ${axisSummary}.`
            : `Sí, tenemos ${variant?.productName ?? productContext?.productName ?? effectiveProductName}. Contame qué variante buscás y te confirmo al instante.`;
        selectedVariant = "missing-axes-options";
    }
    else if (reservationInThisFlow) {
        if (wantsCashPayment && !wantsPaymentLink) {
            message = await templateService.render(tenantId, "payment_cash_available", {
                product_name: variant.productName
            });
        }
        else if (wantsPaymentLink) {
            message = await templateService.render(tenantId, "reservation_payment_link_handoff", {
                product_name: variant.productName
            });
        }
        else {
            message =
                availableStock > 0
                    ? await templateService.render(tenantId, "reservation_active_recap", {
                        product_name: variant.productName,
                        price: formattedPrice
                    })
                    : await templateService.render(tenantId, "reservation_no_stock_recap", {
                        product_name: variant.productName
                    });
        }
    }
    else if (variant &&
        [
            "buscar_producto",
            "consultar_precio",
            // consultar_talle / consultar_color: ramas dedicadas más abajo (listan opciones, no el cierre genérico).
            "elegir_variante",
            "aceptar_oferta",
            "desconocida"
        ].includes(job.data.intent ?? "")) {
        if (availableStock <= 0) {
            message = `Tengo ubicado ${variant.productName}${variantSummary ? ` en ${variantSummary}` : ""}, pero ahora mismo no me queda stock disponible. Si querés, te aviso apenas ingrese.`;
        }
        else {
            message = `Sí, tengo ${variant.productName}${variantSummary ? ` en ${variantSummary}` : ""}.${exactVariantPriceText} Tengo ${availableStock} unidad(es) disponible(s). ¿Querés que te reserve una?`;
        }
        selectedVariant = "exact-variant-close";
    }
    else if (job.data.intent === "consultar_color") {
        if (availableStock <= 0) {
            message = await templateService.render(tenantId, "size_no_stock", {
                product_name: variant.productName
            });
            selectedVariant = "color-no-stock";
        }
        else {
            const colorMap = collectAxisOptions(availableSiblingVariants, ["color", "Color"]);
            const colors = [...new Set([...(colorMap.color ?? []), ...(colorMap.Color ?? [])])].filter(Boolean);
            if (colors.length > 1) {
                message = `Para ${variant.productName} hoy tengo estos colores con stock: ${colors.join(", ")}. ¿Con cuál te quedás?${exactVariantPriceText}`;
                selectedVariant = "color-options";
            }
            else if (colors.length === 1) {
                message = `Ahora mismo solo tengo ${variant.productName} en color ${colors[0]}.${exactVariantPriceText} Tengo ${availableStock} unidad(es). ¿Te sirve o querés que te avise si entran más opciones?`;
                selectedVariant = "color-single";
            }
            else {
                const comboAxes = Object.keys(variantAttributeMap).length > 0 ? Object.keys(variantAttributeMap) : ["talle", "color", "modelo"];
                const combos = describeAvailableCombinations(availableSiblingVariants, comboAxes);
                message = combos
                    ? `Estas son las variantes con stock de ${variant.productName}: ${combos}. ¿Cuál te interesa?`
                    : await templateService.render(tenantId, "size_need_input", {
                        product_name: variant.productName,
                        price: formattedPrice
                    });
                selectedVariant = combos ? "color-combos-fallback" : "color-need-input";
            }
        }
    }
    else if (job.data.intent === "consultar_talle") {
        if (availableStock <= 0) {
            message = await templateService.render(tenantId, "size_no_stock", {
                product_name: variant.productName
            });
        }
        else if (availableSizes.length > 0) {
            message = await templateService.render(tenantId, "size_with_options", {
                product_name: variant.productName,
                sizes: availableSizes.join(", "),
                price: formattedPrice,
                available_stock: availableStock
            });
        }
        else {
            message = await templateService.render(tenantId, "size_need_input", {
                product_name: variant.productName,
                price: formattedPrice
            });
        }
    }
    else if (job.data.intent === "consultar_precio") {
        message =
            availableStock > 0
                ? await templateService.render(tenantId, "price_response", {
                    product_name: variant.productName,
                    price: formattedPrice,
                    available_stock: availableStock
                })
                : await templateService.render(tenantId, "price_no_stock", {
                    product_name: variant.productName,
                    price: formattedPrice
                });
    }
    else if (job.data.intent === "buscar_producto") {
        message =
            availableStock > 0
                ? await templateService.render(tenantId, "product_available", {
                    product_name: variant.productName,
                    price: formattedPrice,
                    available_stock: availableStock
                })
                : await templateService.render(tenantId, "product_unavailable", {
                    product_name: variant.productName
                });
    }
    else {
        message =
            availableStock > 0
                ? await templateService.render(tenantId, "generic_product_response", {
                    product_name: variant.productName,
                    price: formattedPrice,
                    available_stock: availableStock
                })
                : await templateService.render(tenantId, "generic_product_no_stock", {
                    product_name: variant.productName,
                    price: formattedPrice
                });
    }
    const llmConfidence = Number(job.data.llmDecision?.confidence ?? 0);
    const shouldKeepLlmReply = !shadowLlm &&
        Boolean(job.data.llmDecision?.draftReply) &&
        llmConfidence >= PLAYBOOK_OVERRIDE_CONFIDENCE_MAX;
    const shouldKeepDeterministicReply = selectedVariant === "exact-variant-close";
    if (variant &&
        missingAxes.length === 0 &&
        !unavailableCombination &&
        !shouldKeepLlmReply &&
        !shouldKeepDeterministicReply) {
        const playbooks = await loadPlaybooks(tenantId, playbookIntent);
        const performance = await loadVariantPerformance(tenantId, playbookIntent);
        await maybeRebalancePlaybooks(tenantId, playbookIntent, playbooks, performance).catch(() => undefined);
        const selectedPlaybook = await chooseAdaptivePlaybook(tenantId, playbookIntent, playbooks, phone);
        if (selectedPlaybook) {
            message = renderTemplate(selectedPlaybook.template, {
                productName: variant.productName,
                price: formattedPrice ?? "0",
                availableStock
            });
            selectedVariant = selectedPlaybook.variant;
        }
    }
    // Siempre que aplique (active/shadow, con o sin llmDecision en sombra): evita repetir el mismo cierre ante “otro color”, etc.
    const asksVariantFollowUp = variant &&
        /\b(otro|otra|tambien|tambi[eé]n|en otro|m[aá]s|otro\s+color|otra\s+vari|otra\s+opc|ten[eé]s?\s+en\s+otro|hay\s+en\s+otro|pero\s|y\s+en|hay\s+en)\b/i.test(job.data.incomingMessage ?? "");
    if (asksVariantFollowUp) {
        const lastBotMsg = await src_2.prisma.message.findFirst({
            where: { tenantId, phone, direction: "outgoing" },
            orderBy: { createdAt: "desc" },
            select: { message: true }
        });
        const prevText = lastBotMsg?.message?.trim() ?? "";
        const replyTooSimilar = prevText.length > 12 && (0, conversation_recent_messages_service_1.replySimilarity)(message, prevText) >= 0.68;
        if (replyTooSimilar) {
            const currentColorRaw = variantAttributeMap.color ?? variantAttributeMap["color"] ?? "";
            const currentColor = String(currentColorRaw).trim();
            const colorOpts = (axisOptions.color ?? []).filter((c) => normalizeText(String(c)) !== normalizeText(currentColor));
            if (colorOpts.length > 0) {
                message = `Vi tu consulta. Para ${variant.productName}, en stock aparecen estos colores además del que miramos: ${colorOpts.join(", ")}. ¿Cuál te interesa?`;
                selectedVariant = "follow-up-colors";
            }
            else {
                message = `Vi tu consulta por otra variante. En el catálogo que registro solo figura lo que ya te pasé (${variantSummary || "esta variante"}) para ${variant.productName}.${exactVariantPriceText} Si buscás otra combinación, hoy no la tengo cargada; te aviso apenas ingrese.`;
                selectedVariant = "follow-up-single-variant";
            }
        }
    }
    const priorityTier = (0, src_3.leadStatusToPriorityTier)(status);
    const numericPriority = src_3.OUTGOING_PRIORITY[priorityTier];
    const isFirstConsultIntent = job.data.intent === "buscar_producto" || job.data.intent === "consultar_precio";
    const lastOutgoing = await src_2.prisma.message.findFirst({
        where: {
            tenantId,
            phone,
            direction: "outgoing"
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true }
    });
    const withinRecentWindow = lastOutgoing?.createdAt &&
        Date.now() - new Date(lastOutgoing.createdAt).getTime() <
            FIRST_CONSULT_IMAGE_WINDOW_MINUTES * 60 * 1000;
    const shouldAttachImage = Boolean(variant?.imageUrl ?? productContext?.imageUrl) && isFirstConsultIntent && !withinRecentWindow;
    const alternativeOfferVariants = availableSiblingVariants
        .filter((item) => String(item.variantId ?? "") !== String(variant?.variantId ?? ""))
        .slice(0, 3)
        .map((item) => ({
        variantId: String(item.variantId ?? ""),
        attributes: Object.fromEntries(Object.entries(item.attributes ?? {}).map(([key, value]) => [String(key), String(value ?? "").trim()])),
        availableStock: Math.max(Number(item.stock) - Number(item.reservedStock), 0)
    }));
    const resolvedConversationStage = (0, conversation_policy_service_1.resolveStageFromContext)({
        previousStage: job.data.conversationStage,
        intent: job.data.intent,
        hasVariant: Boolean(variant?.variantId),
        missingAxes,
        unavailableCombination,
        hasReservation: reservationInThisFlow,
        paymentLinkSent: selectedVariant === "payment-link-generated",
        paymentApproved: status === "vendido" || selectedVariant === "payment-approved-auto"
    });
    const expectedCustomerAction = (0, conversation_policy_service_1.resolveExpectedCustomerAction)(resolvedConversationStage);
    const activeOffer = (0, conversation_policy_service_1.buildActiveOfferSnapshot)({
        existing: job.data.activeOffer ?? null,
        productName: variant?.productName ?? productContext?.productName ?? effectiveProductName,
        variantId: variant?.variantId ?? null,
        attributes: variantAttributeMap,
        price: formattedPrice ? Number(String(formattedPrice).replace(/[^\d]/g, "")) : null,
        availableStock,
        alternativeVariants: alternativeOfferVariants,
        expectedCustomerAction
    });
    /** Ruta directa (message-processor → lead): sin `llmDecision` del orquestador; aquí aplicamos waseller-crew como en el orquestador. */
    if (!job.data.llmDecision) {
        const incomingRaw = String(job.data.incomingMessage ?? "").trim();
        if (incomingRaw.length > 0) {
            const interpretation = job.data.interpretation ?? defaultInterpretationForCrew(job.data);
            const messageId = String(job.data.messageId ?? "").trim() || `lead:${leadId}:${job.data.correlationId}`;
            const crewDedupe = String(job.data.dedupeKey ?? "").trim() ||
                (0, src_1.buildStableDedupeKey)("lead-crew", tenantId, leadId, messageId);
            let recentCrew = (await src_2.prisma.message.findMany({
                where: { tenantId, phone },
                orderBy: { createdAt: "desc" },
                take: 8,
                select: { direction: true, message: true }
            }));
            recentCrew = await (0, conversation_recent_messages_service_1.enrichRecentMessagesWithLastBotReply)(tenantId, phone, recentCrew);
            const recentChronologicalForCrew = recentCrew
                .slice()
                .reverse()
                .map((item) => ({ direction: item.direction, message: item.message }));
            const tenantRow = await src_2.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { llmConfidenceThreshold: true }
            });
            const confidenceThreshold = Number(tenantRow?.llmConfidenceThreshold ?? 0.72);
            const guardrailFallbackMessage = (await templateService.getTemplate(tenantId, "orchestrator_guardrail_handoff")) ||
                "Quiero asegurarme de darte la mejor respuesta. Te paso con un asesor para confirmar los detalles y ayudarte a cerrar la compra.";
            const tenantKnowledge = await tenantKnowledgeService.getWithRulePack(tenantId);
            const baselineDecision = buildLeadTemplateBaselineDecision(job.data, message, interpretation);
            let stockTableProductId = null;
            const vidForCrew = effectiveVariantId?.trim();
            if (vidForCrew) {
                try {
                    stockTableProductId = await (0, shadow_compare_service_1.resolveProductIdForTenantVariant)(tenantId, vidForCrew);
                }
                catch {
                    stockTableProductId = null;
                }
            }
            else if (productContext?.productId) {
                stockTableProductId = String(productContext.productId).trim() || null;
            }
            const shadowMode = job.data.executionMode === "shadow";
            let crewPrimaryApplied = false;
            const crewPrimary = await (0, shadow_compare_service_1.tryWasellerCrewPrimaryReplacement)({
                tenantId,
                leadId,
                conversationId: job.data.conversationId ?? undefined,
                messageId,
                correlationId: job.data.correlationId,
                dedupeKey: crewDedupe,
                phone,
                incomingText: incomingRaw,
                interpretation,
                baselineDecision,
                recentMessages: recentChronologicalForCrew,
                tenantBusinessCategory: tenantKnowledge.profile.businessCategory,
                stockTableProductId
            }).catch(() => null);
            if (crewPrimary) {
                const gr = (0, conversation_policy_service_1.applyReplyGuardrails)(crewPrimary.decision.draftReply, message, incomingRaw, crewPrimary.decision.confidence, confidenceThreshold);
                if (!gr.blocked) {
                    message = gr.message;
                    crewPrimaryApplied = true;
                }
            }
            if (shadowMode && !crewPrimaryApplied) {
                const templateGuarded = (0, conversation_policy_service_1.applyReplyGuardrails)(message, guardrailFallbackMessage, incomingRaw, baselineDecision.confidence, confidenceThreshold);
                const shadowBaseline = {
                    ...baselineDecision,
                    draftReply: templateGuarded.message,
                    handoffRequired: templateGuarded.blocked,
                    qualityFlags: Array.from(new Set([...(baselineDecision.qualityFlags ?? []), ...templateGuarded.flags]))
                };
                void (0, shadow_compare_service_1.logShadowExternalCompareIfConfigured)({
                    tenantId,
                    leadId,
                    conversationId: job.data.conversationId ?? undefined,
                    messageId,
                    correlationId: job.data.correlationId,
                    dedupeKey: crewDedupe,
                    phone,
                    incomingText: incomingRaw,
                    interpretation,
                    baselineDecision: shadowBaseline,
                    recentMessages: recentChronologicalForCrew,
                    tenantBusinessCategory: tenantKnowledge.profile.businessCategory,
                    stockTableProductId
                }).catch(() => undefined);
            }
        }
    }
    const dedupeKey = (0, src_1.buildStableDedupeKey)("outgoing", tenantId, phone, leadId, job.data.correlationId, message);
    await src_1.outgoingQueue.add("send-message-v1", {
        schemaVersion: src_1.JOB_SCHEMA_VERSION,
        correlationId: job.data.correlationId,
        dedupeKey,
        tenantId,
        phone,
        message,
        imageUrl: shouldAttachImage ? (variant?.imageUrl ?? productContext?.imageUrl ?? undefined) : undefined,
        priority: numericPriority,
        metadata: {
            source: "bot",
            nextBestAction: job.data.llmDecision?.recommendedAction
        }
    }, {
        priority: numericPriority,
        attempts: src_3.OUTGOING_ATTEMPTS,
        backoff: { type: "smart" },
        jobId: `outgoing_${dedupeKey}`
    });
    await upsertConversationFacts({
        tenantId,
        leadId,
        conversationStage: resolvedConversationStage,
        activeOffer,
        interpretation: job.data.interpretation,
        decision: job.data.llmDecision
    });
    try {
        const createdEvent = await src_2.prisma.botResponseEvent.create({
            data: {
                tenantId,
                leadId,
                phone,
                intent: playbookIntent,
                variant: selectedVariant,
                message
            },
            select: { id: true }
        });
        const botResponseEventId = createdEvent.id;
        if (botResponseEventId && job.data.correlationId) {
            const trace = await src_2.prisma.llmTrace.findFirst({
                where: {
                    tenantId,
                    leadId,
                    correlationId: job.data.correlationId,
                    botResponseEventId: null
                },
                orderBy: { createdAt: "desc" },
                select: { id: true }
            });
            if (trace) {
                await src_2.prisma.llmTrace.update({
                    where: { id: trace.id },
                    data: { botResponseEventId }
                });
            }
        }
    }
    catch {
        // Si la tabla todavía no existe no frenamos el envío.
    }
    leadMetrics.onEnqueued();
}, { connection: src_1.redisConnection });
exports.leadWorker.on("active", () => {
    leadMetrics.onProcessing();
});
exports.leadWorker.on("completed", () => {
    leadMetrics.onCompleted();
});
exports.leadWorker.on("failed", (job) => {
    const attempts = job?.opts?.attempts ?? 1;
    const willRetry = (job?.attemptsMade ?? 0) < attempts;
    leadMetrics.onFailed(willRetry);
});
