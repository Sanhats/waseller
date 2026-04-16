"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageProcessorWorker = void 0;
const bullmq_1 = require("bullmq");
const src_1 = require("../../../packages/queue/src");
const src_2 = require("../../../packages/db/src");
const conversation_lock_service_1 = require("./services/conversation-lock.service");
const intent_detection_service_1 = require("./services/intent-detection.service");
const lead_classifier_service_1 = require("./services/lead-classifier.service");
const llm_rollout_service_1 = require("./services/llm-rollout.service");
const product_matcher_service_1 = require("./services/product-matcher.service");
const queue_metrics_service_1 = require("./services/queue-metrics.service");
const stock_reservation_service_1 = require("./services/stock-reservation.service");
const tenant_knowledge_service_1 = require("./services/tenant-knowledge.service");
const conversation_policy_service_1 = require("./services/conversation-policy.service");
const src_3 = require("../../../packages/shared/src");
const intentDetection = new intent_detection_service_1.IntentDetectionService();
const productMatcher = new product_matcher_service_1.ProductMatcherService();
const leadClassifier = new lead_classifier_service_1.LeadClassifierService();
const processorMetrics = new queue_metrics_service_1.QueueMetricsService(src_1.QueueNames.incomingMessages);
const stockReservation = new stock_reservation_service_1.StockReservationService();
const llmRollout = new llm_rollout_service_1.LlmRolloutService();
const tenantKnowledgeService = new tenant_knowledge_service_1.TenantKnowledgeService();
const lockService = new conversation_lock_service_1.ConversationLockService(src_1.redisConnection, Math.max(1000, Number(process.env.PROCESSOR_LOCK_TTL_MS ?? 10000)), Math.max(200, Number(process.env.PROCESSOR_LOCK_WAIT_MS ?? 6000)));
const reservationTtlMs = Number(process.env.STOCK_RESERVATION_TTL_MS ?? 30 * 60 * 1000);
const isTrackablePhone = (value) => {
    const normalized = value.trim().replace(/[^\d]/g, "");
    return /^\d{8,18}$/.test(normalized);
};
const normalizeText = (value) => value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const isContextualPurchaseConfirmation = (message) => {
    const text = normalizeText(message);
    return (/^(si|sí|dale|listo|de una|me sirve|me va|quiero ese|quiero esa|voy con ese|voy con esa|lo quiero|la quiero)[.!? ]*$/.test(text) ||
        /\b(reservamelo|reservamela|reservame uno|reservame una|quiero ese|quiero esa|me lo llevo|me la llevo)\b/.test(text));
};
const isReservationFollowUpMessage = (message) => {
    const text = normalizeText(message);
    return (text.includes("link de pago") ||
        text.includes("prefiero link") ||
        text.includes("pasame el link") ||
        text.includes("enviame el link") ||
        text.includes("mandame el link") ||
        text.includes("efectivo") ||
        text.includes("transferencia") ||
        text.includes("alias") ||
        text.includes("te pago") ||
        text.includes("te abono"));
};
const isAlternativeRequestMessage = (message) => {
    const text = normalizeText(message);
    return (text.includes("la otra") ||
        text.includes("otra opcion") ||
        text.includes("otra opción") ||
        text.includes("otra variante") ||
        text.includes("alguna otra") ||
        text.includes("que otra") ||
        text.includes("qué otra"));
};
const isPostSaleAcknowledgementMessage = (message) => {
    const text = normalizeText(message).trim();
    return (/^(listo|ok|oka|okey|dale|perfecto|genial|joya|excelente|gracias|graciass|buenisimo|buenisima|ya esta|ya quedo)[.!? ]*$/.test(text) ||
        text.includes("ya pague") ||
        text.includes("ya abone") ||
        text.includes("ya transferi"));
};
const loadLeadMemory = async (tenantId, leadId) => {
    if (!leadId)
        return { productName: "", confidence: 0, lastAction: "", activeOffer: null, facts: {} };
    try {
        const memory = await src_2.prisma.conversationMemory.findFirst({
            where: { tenantId, leadId },
            select: { facts: true }
        });
        if (!memory || typeof memory.facts !== "object" || memory.facts === null) {
            return { productName: "", confidence: 0, lastAction: "", activeOffer: null, facts: {} };
        }
        const facts = memory.facts;
        return {
            productName: String(facts.entities?.productName ?? facts.activeProductName ?? "").trim(),
            confidence: Number(facts.extractionConfidence ?? 0),
            lastAction: String(facts.lastRecommendedAction ?? "").trim(),
            conversationStage: facts.conversationStage,
            activeOffer: facts.activeOffer ?? null,
            facts: memory.facts
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("conversation_memory"))
            throw error;
        return { productName: "", confidence: 0, lastAction: "", activeOffer: null, facts: {} };
    }
};
const buildRuleInterpretation = (input) => {
    const normalizedMessage = (0, conversation_policy_service_1.normalizeConversationText)(input.message);
    const references = [];
    if (input.activeOffer?.variantId && isContextualPurchaseConfirmation(input.message)) {
        references.push({
            kind: "active_offer",
            value: input.activeOffer.variantId,
            confidence: 0.9
        });
    }
    if (input.activeOffer?.variantId && isAlternativeRequestMessage(input.message)) {
        references.push({
            kind: "alternative_variant",
            value: input.activeOffer.variantId,
            confidence: 0.75
        });
    }
    const entities = {
        productName: input.matched?.productName ?? input.activeOffer?.productName ?? null,
        variantId: input.matched?.variantId ?? input.activeOffer?.variantId ?? null,
        variantAttributes: input.matched?.attributes ?? input.activeOffer?.attributes ?? {}
    };
    let nextAction = "ask_clarification";
    if (input.shouldPreserveClosedSale) {
        nextAction = "reply_only";
    }
    else if (input.intent === "reportar_pago") {
        nextAction = "manual_review";
    }
    else if (input.intent === "pedir_link_pago") {
        nextAction = "share_payment_link";
    }
    else if (input.intent === "pedir_alternativa" || input.matched?.unavailableCombination) {
        nextAction = "suggest_alternative";
    }
    else if ((input.matched?.missingAxes.length ?? 0) > 0) {
        nextAction = "ask_clarification";
    }
    else if (input.intent === "aceptar_oferta" || input.intent === "confirmar_compra") {
        nextAction = input.hasReservation ? "share_payment_link" : "reserve_stock";
    }
    else if (input.intent === "elegir_variante" || input.intent === "consultar_talle" || input.intent === "consultar_color") {
        nextAction = input.matched?.variantId ? "offer_reservation" : "confirm_variant";
    }
    else if (normalizedMessage.includes("link")) {
        nextAction = "share_payment_link";
    }
    else if (input.matched?.variantId) {
        nextAction = "offer_reservation";
    }
    const conversationStage = (0, conversation_policy_service_1.resolveStageFromContext)({
        previousStage: input.previousStage,
        intent: input.intent,
        hasVariant: Boolean(input.matched?.variantId),
        missingAxes: input.matched?.missingAxes ?? [],
        unavailableCombination: Boolean(input.matched?.unavailableCombination),
        hasReservation: input.hasReservation,
        paymentLinkSent: input.previousStage === "payment_link_sent",
        paymentApproved: input.shouldPreserveClosedSale
    });
    return {
        intent: input.intent,
        confidence: input.matched?.variantId || input.activeOffer?.variantId ? 0.82 : 0.68,
        entities,
        references,
        conversationStage,
        missingFields: input.matched?.missingAxes ?? [],
        nextAction,
        source: "rules",
        notes: [(0, conversation_policy_service_1.resolveExpectedCustomerAction)(conversationStage) ?? "unknown_expected_action"]
    };
};
const loadVariantById = async (tenantId, variantId) => {
    if (!variantId)
        return null;
    const rows = (await src_2.prisma.$queryRaw `
    select
      p.name as "productName",
      v.id as "variantId",
      v.attributes as "attributes"
    from public.product_variants v
    inner join public.products p on p.id = v.product_id
    where v.tenant_id::text = ${tenantId}
      and v.id::text = ${variantId}
    limit 1
  `);
    const row = rows[0];
    if (!row)
        return null;
    return {
        productName: row.productName,
        variantId: row.variantId,
        attributes: row.attributes ?? {},
        missingAxes: []
    };
};
exports.messageProcessorWorker = new bullmq_1.Worker(src_1.QueueNames.incomingMessages, async (job) => {
    const { tenantId, payload } = job.data;
    if (!isTrackablePhone(payload.phone))
        return;
    const lock = await lockService.acquire(tenantId, payload.phone);
    try {
        const intent = intentDetection.detect(payload.message);
        const llmPolicy = await llmRollout.getPolicy(tenantId);
        const conversation = await src_2.prisma.conversation.findFirst({
            where: { tenantId, phone: payload.phone },
            orderBy: { updatedAt: "desc" },
            select: { id: true, state: true }
        });
        const leadWasClosed = conversation?.state === "lead_closed";
        const existingLead = await src_2.prisma.lead.findFirst({
            where: { tenantId, phone: payload.phone },
            orderBy: { updatedAt: "desc" },
            select: {
                id: true,
                score: true,
                status: true,
                product: true,
                productVariantId: true,
                hasStockReservation: true,
                reservationExpiresAt: true
            }
        });
        const shouldPreserveClosedSale = existingLead?.status === "vendido" && isPostSaleAcknowledgementMessage(payload.message);
        const memory = await loadLeadMemory(tenantId, existingLead?.id);
        const tenantKnowledge = await tenantKnowledgeService.getWithRulePack(tenantId);
        const matched = (await productMatcher.matchByMessage(tenantId, payload.message, {
            previousProductName: existingLead?.product ?? memory.productName ?? memory.activeOffer?.productName,
            previousProductConfidence: memory.confidence,
            lastRecommendedAction: memory.lastAction,
            requiredAxes: tenantKnowledge.rulePack.requiredAxes
        }));
        const storedVariantMatch = await loadVariantById(tenantId, existingLead?.productVariantId);
        const paymentOrReservationFollowUp = isReservationFollowUpMessage(payload.message) ||
            intent === "elegir_medio_pago" ||
            intent === "pedir_link_pago";
        const reservationContextActive = Boolean(existingLead?.hasStockReservation) || existingLead?.status === "listo_para_cobrar";
        const alignedWithStoredVariant = !matched ||
            (Boolean(matched.variantId) &&
                Boolean(storedVariantMatch?.variantId) &&
                storedVariantMatch !== null &&
                matched.variantId === storedVariantMatch.variantId) ||
            (storedVariantMatch !== null &&
                matched?.productName === storedVariantMatch.productName &&
                (matched?.missingAxes.length ?? 0) > 0);
        const forcePreserveForPaymentFollowUp = paymentOrReservationFollowUp && reservationContextActive && Boolean(storedVariantMatch?.variantId);
        const shouldPreserveStoredVariant = Boolean(storedVariantMatch?.variantId) &&
            (isContextualPurchaseConfirmation(payload.message) ||
                paymentOrReservationFollowUp ||
                reservationContextActive) &&
            (alignedWithStoredVariant || forcePreserveForPaymentFollowUp);
        let effectiveMatched = shouldPreserveStoredVariant
            ? storedVariantMatch
                ? {
                    productName: storedVariantMatch.productName,
                    variantId: storedVariantMatch.variantId ?? null,
                    attributes: storedVariantMatch.attributes ?? {},
                    missingAxes: [],
                    requestedAttributes: matched?.requestedAttributes ?? storedVariantMatch.attributes ?? {},
                    unavailableCombination: false
                }
                : matched
            : matched ?? storedVariantMatch;
        // Con reserva activa, el matcher a veces devuelve filas sin variantId; sin variant el pipeline va al LLM y no se genera payment_attempt.
        const shouldRepairVariantForPayment = storedVariantMatch?.variantId &&
            !effectiveMatched?.variantId &&
            (existingLead?.status === "listo_para_cobrar" ||
                (Boolean(existingLead?.hasStockReservation) &&
                    (intent === "pedir_link_pago" ||
                        intent === "elegir_medio_pago" ||
                        isReservationFollowUpMessage(payload.message))));
        if (shouldRepairVariantForPayment) {
            effectiveMatched = {
                productName: storedVariantMatch.productName,
                variantId: storedVariantMatch.variantId,
                attributes: storedVariantMatch.attributes ?? {},
                missingAxes: [],
                requestedAttributes: storedVariantMatch.attributes ?? {},
                unavailableCombination: false
            };
        }
        let effectiveIntent = intent;
        if (!["confirmar_compra", "aceptar_oferta"].includes(effectiveIntent) &&
            Boolean(effectiveMatched?.variantId) &&
            !(effectiveMatched?.missingAxes.length ?? 0) &&
            !effectiveMatched?.unavailableCombination &&
            isContextualPurchaseConfirmation(payload.message)) {
            effectiveIntent = "aceptar_oferta";
        }
        const hasCommercialIntent = [
            "buscar_producto",
            "consultar_precio",
            "consultar_talle",
            "consultar_color",
            "confirmar_compra",
            "aceptar_oferta",
            "rechazar_oferta",
            "elegir_variante",
            "pedir_alternativa",
            "pedir_link_pago",
            "elegir_medio_pago",
            "preguntar_envio",
            "preguntar_retiro",
            "pedir_asesor",
            "reportar_pago",
            "sin_stock",
            "multi_producto"
        ].includes(effectiveIntent);
        const isBusinessRelated = hasCommercialIntent || intentDetection.isBusinessRelated(payload.message, Boolean(effectiveMatched?.variantId));
        let score = shouldPreserveClosedSale ? existingLead?.score ?? 120 : leadWasClosed ? 0 : existingLead?.score ?? 0;
        let status = shouldPreserveClosedSale ? "vendido" : leadWasClosed ? "frio" : existingLead?.status ?? "frio";
        const hasUnavailableCombination = Boolean(effectiveMatched?.unavailableCombination);
        const needsClarificationForAxes = isBusinessRelated &&
            Boolean(effectiveMatched?.productName) &&
            !hasUnavailableCombination &&
            (effectiveMatched?.missingAxes.length ?? 0) > 0;
        const forceLeadWorkerForReservedPaymentFollowUp = Boolean(storedVariantMatch?.variantId) &&
            Boolean(existingLead?.hasStockReservation) &&
            (intent === "pedir_link_pago" ||
                intent === "elegir_medio_pago" ||
                isReservationFollowUpMessage(payload.message));
        const shouldHandleInLeadWorker = Boolean(effectiveMatched?.variantId) ||
            needsClarificationForAxes ||
            hasUnavailableCombination ||
            forceLeadWorkerForReservedPaymentFollowUp;
        const hadActiveReservation = !leadWasClosed &&
            Boolean(existingLead?.hasStockReservation) &&
            (!existingLead?.reservationExpiresAt || new Date(existingLead.reservationExpiresAt).getTime() > Date.now());
        const ruleInterpretation = buildRuleInterpretation({
            message: payload.message,
            intent: effectiveIntent,
            previousStage: memory.conversationStage,
            activeOffer: memory.activeOffer,
            matched: effectiveMatched,
            hasReservation: hadActiveReservation,
            shouldPreserveClosedSale
        });
        const activeOffer = (0, conversation_policy_service_1.buildActiveOfferSnapshot)({
            existing: memory.activeOffer ?? null,
            productName: effectiveMatched?.productName ?? memory.activeOffer?.productName ?? existingLead?.product ?? null,
            variantId: effectiveMatched?.variantId ?? memory.activeOffer?.variantId ?? existingLead?.productVariantId ?? null,
            attributes: effectiveMatched?.attributes ?? memory.activeOffer?.attributes ?? {},
            expectedCustomerAction: (0, conversation_policy_service_1.resolveExpectedCustomerAction)(ruleInterpretation.conversationStage)
        });
        let reserved = hadActiveReservation;
        let reservationExpiresAt = hadActiveReservation && existingLead?.reservationExpiresAt
            ? new Date(existingLead.reservationExpiresAt)
            : new Date(Date.now() + reservationTtlMs);
        if (isBusinessRelated && !shouldPreserveClosedSale) {
            const classified = leadClassifier.classify(effectiveIntent, payload.message);
            score = classified.score;
            status = classified.status;
            if (needsClarificationForAxes) {
                status = "consulta";
                score = Math.max(score, 60);
                reserved = false;
            }
            else if (hasUnavailableCombination) {
                status = "consulta";
                score = Math.max(score, 65);
                reserved = false;
            }
            else if ([
                "confirmar_compra",
                "aceptar_oferta",
                "pedir_link_pago",
                "elegir_medio_pago",
                "reportar_pago"
            ].includes(effectiveIntent) &&
                effectiveMatched?.variantId) {
                if (llmPolicy.enabled && llmPolicy.executionMode === "shadow") {
                    reserved = hadActiveReservation;
                    status = "listo_para_cobrar";
                    score = Math.max(score, 120);
                }
                else {
                    const hasActiveReservation = !leadWasClosed &&
                        Boolean(existingLead?.hasStockReservation) &&
                        existingLead?.productVariantId === effectiveMatched.variantId &&
                        (!existingLead?.reservationExpiresAt || new Date(existingLead.reservationExpiresAt).getTime() > Date.now());
                    if (hasActiveReservation) {
                        reserved = true;
                        if (existingLead?.reservationExpiresAt) {
                            reservationExpiresAt = new Date(existingLead.reservationExpiresAt);
                        }
                    }
                    else {
                        reserved = await stockReservation.reserveOne(tenantId, effectiveMatched.variantId, {
                            reason: `intent_${effectiveIntent}`,
                            source: "message_processor",
                            phone: payload.phone
                        });
                    }
                    if (reserved) {
                        status = "listo_para_cobrar";
                        score = Math.max(score, 120);
                    }
                }
            }
        }
        let profilePictureUrl;
        try {
            const waUrl = (0, src_3.getWhatsappServiceBaseUrl)();
            if (waUrl) {
                const picRes = await fetch(`${waUrl}/contacts/${payload.phone}/profile-picture?tenantId=${tenantId}`);
                if (picRes.ok) {
                    const picData = (await picRes.json());
                    profilePictureUrl = picData.url ?? undefined;
                }
            }
        }
        catch { }
        const reservationActive = shouldPreserveClosedSale
            ? false
            : reserved || (Boolean(existingLead?.hasStockReservation) && !leadWasClosed);
        const shouldTrackLead = shouldPreserveClosedSale || (Boolean(existingLead?.id) && !leadWasClosed) || isBusinessRelated;
        const leadUpdatePayload = {
            customerName: payload.name?.trim() ? payload.name.trim() : undefined,
            status: isBusinessRelated || shouldPreserveClosedSale ? status : undefined,
            score: isBusinessRelated || shouldPreserveClosedSale ? score : undefined,
            product: isBusinessRelated && !shouldPreserveClosedSale
                ? effectiveMatched?.productName
                : shouldPreserveClosedSale
                    ? existingLead?.product
                    : undefined,
            productVariantId: isBusinessRelated && !shouldPreserveClosedSale
                ? effectiveMatched?.variantId
                : shouldPreserveClosedSale
                    ? existingLead?.productVariantId
                    : undefined,
            productVariantAttributes: isBusinessRelated && !shouldPreserveClosedSale ? (effectiveMatched?.attributes ?? undefined) : undefined,
            hasStockReservation: isBusinessRelated || shouldPreserveClosedSale ? reservationActive : undefined,
            reservationExpiresAt: isBusinessRelated || shouldPreserveClosedSale ? (reservationActive ? reservationExpiresAt : null) : undefined,
            profilePictureUrl: profilePictureUrl !== undefined ? profilePictureUrl : undefined,
            lastMessage: payload.message
        };
        const leadCreatePayload = {
            tenantId,
            phone: payload.phone,
            customerName: payload.name?.trim() ? payload.name.trim() : undefined,
            product: effectiveMatched?.productName,
            productVariantId: effectiveMatched?.variantId,
            productVariantAttributes: effectiveMatched?.attributes ?? undefined,
            status,
            score,
            hasStockReservation: reservationActive,
            reservationExpiresAt: reservationActive ? reservationExpiresAt : null,
            profilePictureUrl,
            lastMessage: payload.message
        };
        const lead = shouldTrackLead
            ? existingLead
                ? await src_2.prisma.lead.update({
                    where: { id: existingLead.id },
                    data: leadUpdatePayload
                })
                : await src_2.prisma.lead.create({
                    data: leadCreatePayload
                })
            : null;
        if (lead && reserved && effectiveMatched?.variantId) {
            await src_1.stockReservationExpiryQueue.add("reservation-expire", {
                tenantId,
                leadId: lead.id,
                variantId: effectiveMatched.variantId
            }, {
                delay: reservationTtlMs,
                jobId: `reservation_${tenantId}_${lead.id}_${effectiveMatched.variantId}`
            });
        }
        let messageRecord;
        try {
            messageRecord = await src_2.prisma.message.create({
                data: {
                    tenantId,
                    phone: payload.phone,
                    message: payload.message,
                    direction: "incoming",
                    externalMessageId: payload.externalMessageId,
                    correlationId: job.data.correlationId,
                    dedupeKey: job.data.dedupeKey
                },
                select: { id: true }
            });
        }
        catch {
            messageRecord = await src_2.prisma.message.create({
                data: {
                    tenantId,
                    phone: payload.phone,
                    message: payload.message,
                    direction: "incoming"
                },
                select: { id: true }
            });
        }
        let effectiveConversationId = conversation?.id;
        if (conversation) {
            const updatedConversation = await src_2.prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    lastMessage: payload.message,
                    state: shouldPreserveClosedSale ? "lead_closed" : leadWasClosed ? "open" : undefined
                },
                select: { id: true }
            });
            effectiveConversationId = updatedConversation.id;
        }
        else {
            const createdConversation = await src_2.prisma.conversation.create({
                data: {
                    tenantId,
                    phone: payload.phone,
                    state: shouldPreserveClosedSale ? "lead_closed" : "open",
                    lastMessage: payload.message
                },
                select: { id: true }
            });
            effectiveConversationId = createdConversation.id;
        }
        const conversationState = shouldPreserveClosedSale ? "lead_closed" : leadWasClosed ? "open" : conversation?.state ?? "open";
        const botPaused = conversationState === "manual_paused";
        if (!botPaused && isBusinessRelated && lead) {
            if (llmPolicy.enabled && !shouldHandleInLeadWorker) {
                const llmJob = {
                    schemaVersion: src_1.JOB_SCHEMA_VERSION,
                    correlationId: job.data.correlationId,
                    dedupeKey: job.data.dedupeKey,
                    tenantId,
                    leadId: lead.id,
                    phone: payload.phone,
                    messageId: messageRecord.id,
                    conversationId: effectiveConversationId,
                    incomingText: payload.message,
                    intentHint: effectiveIntent,
                    timestamp: payload.timestamp,
                    executionMode: llmPolicy.executionMode,
                    allowSensitiveActions: llmPolicy.allowSensitiveActions,
                    verifierRequired: llmPolicy.verifierRequired,
                    minVerifierScore: llmPolicy.minVerifierScore,
                    conversationStage: ruleInterpretation.conversationStage,
                    activeOffer,
                    memoryFacts: memory.facts ?? {},
                    ruleInterpretation
                };
                await src_1.llmOrchestrationQueue.add("llm-orchestration-v1", llmJob, {
                    jobId: `llm_${llmJob.dedupeKey}`
                });
            }
            else {
                const leadDedupe = (0, src_1.buildStableDedupeKey)("lead", tenantId, payload.phone, messageRecord.id);
                await src_1.leadProcessingQueue.add("lead-processed-v1", {
                    schemaVersion: src_1.JOB_SCHEMA_VERSION,
                    correlationId: job.data.correlationId,
                    dedupeKey: leadDedupe,
                    tenantId,
                    leadId: lead.id,
                    phone: payload.phone,
                    intent: needsClarificationForAxes ? "consultar_talle" : effectiveIntent,
                    incomingMessage: payload.message,
                    status,
                    isBusinessRelated,
                    productName: effectiveMatched?.productName ?? null,
                    variantId: effectiveMatched?.variantId ?? null,
                    variantAttributes: effectiveMatched?.attributes ?? {},
                    missingAxes: effectiveMatched?.missingAxes ?? [],
                    requestedAttributes: effectiveMatched?.requestedAttributes ?? {},
                    unavailableCombination: effectiveMatched?.unavailableCombination ?? false,
                    stockReserved: reserved,
                    conversationStage: ruleInterpretation.conversationStage,
                    activeOffer,
                    interpretation: ruleInterpretation
                }, {
                    jobId: `lead_${leadDedupe}`
                });
            }
            processorMetrics.onEnqueued();
        }
    }
    finally {
        await lockService.release(lock.key, lock.token);
    }
}, {
    connection: src_1.redisConnection,
    concurrency: Number(process.env.PROCESSOR_CONCURRENCY ?? 8)
});
exports.messageProcessorWorker.on("active", () => {
    processorMetrics.onProcessing();
});
exports.messageProcessorWorker.on("completed", () => {
    processorMetrics.onCompleted();
});
exports.messageProcessorWorker.on("failed", (job) => {
    const attempts = job?.opts?.attempts ?? 1;
    const willRetry = (job?.attemptsMade ?? 0) < attempts;
    processorMetrics.onFailed(willRetry);
});
