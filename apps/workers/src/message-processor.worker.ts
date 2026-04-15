import { Job, Worker } from "bullmq";
import {
  ActiveOfferV1,
  ConversationInterpretationV1,
  ConversationReferenceV1,
  ConversationStageV1,
  JOB_SCHEMA_VERSION,
  IncomingMessageJobV1,
  LlmOrchestrationJobV1,
  QueueNames,
  buildStableDedupeKey,
  leadProcessingQueue,
  llmOrchestrationQueue,
  redisConnection,
  stockReservationExpiryQueue
} from "../../../packages/queue/src";
import { prisma } from "../../../packages/db/src";
import { ConversationLockService } from "./services/conversation-lock.service";
import { IntentDetectionService } from "./services/intent-detection.service";
import { LeadClassifierService } from "./services/lead-classifier.service";
import { LlmRolloutService } from "./services/llm-rollout.service";
import { ProductMatcherService } from "./services/product-matcher.service";
import { QueueMetricsService } from "./services/queue-metrics.service";
import { StockReservationService } from "./services/stock-reservation.service";
import { TenantKnowledgeService } from "./services/tenant-knowledge.service";
import {
  buildActiveOfferSnapshot,
  normalizeConversationText,
  resolveExpectedCustomerAction,
  resolveStageFromContext
} from "./services/conversation-policy.service";

const intentDetection = new IntentDetectionService();
const productMatcher = new ProductMatcherService();
const leadClassifier = new LeadClassifierService();
const processorMetrics = new QueueMetricsService(QueueNames.incomingMessages);
const stockReservation = new StockReservationService();
const llmRollout = new LlmRolloutService();
const tenantKnowledgeService = new TenantKnowledgeService();
const lockService = new ConversationLockService(
  redisConnection,
  Math.max(1000, Number(process.env.PROCESSOR_LOCK_TTL_MS ?? 10000)),
  Math.max(200, Number(process.env.PROCESSOR_LOCK_WAIT_MS ?? 6000))
);
const reservationTtlMs = Number(process.env.STOCK_RESERVATION_TTL_MS ?? 30 * 60 * 1000);

type VariantMatch = {
  productName: string;
  variantId?: string | null;
  attributes: Record<string, string>;
  missingAxes: string[];
  requestedAttributes?: Record<string, string>;
  unavailableCombination?: boolean;
};

type ConversationMemorySnapshot = {
  productName: string;
  confidence: number;
  lastAction: string;
  conversationStage?: ConversationStageV1;
  activeOffer?: ActiveOfferV1 | null;
  facts?: Record<string, unknown>;
};

const isTrackablePhone = (value: string): boolean => {
  const normalized = value.trim().replace(/[^\d]/g, "");
  return /^\d{8,18}$/.test(normalized);
};

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const isContextualPurchaseConfirmation = (message: string): boolean => {
  const text = normalizeText(message);
  return (
    /^(si|sí|dale|listo|de una|me sirve|me va|quiero ese|quiero esa|voy con ese|voy con esa|lo quiero|la quiero)[.!? ]*$/.test(
      text
    ) ||
    /\b(reservamelo|reservamela|reservame uno|reservame una|quiero ese|quiero esa|me lo llevo|me la llevo)\b/.test(
      text
    )
  );
};

const isReservationFollowUpMessage = (message: string): boolean => {
  const text = normalizeText(message);
  return (
    text.includes("link de pago") ||
    text.includes("prefiero link") ||
    text.includes("pasame el link") ||
    text.includes("enviame el link") ||
    text.includes("mandame el link") ||
    text.includes("efectivo") ||
    text.includes("transferencia") ||
    text.includes("alias") ||
    text.includes("te pago") ||
    text.includes("te abono")
  );
};

const isAlternativeRequestMessage = (message: string): boolean => {
  const text = normalizeText(message);
  return (
    text.includes("la otra") ||
    text.includes("otra opcion") ||
    text.includes("otra opción") ||
    text.includes("otra variante") ||
    text.includes("alguna otra") ||
    text.includes("que otra") ||
    text.includes("qué otra")
  );
};

const isPostSaleAcknowledgementMessage = (message: string): boolean => {
  const text = normalizeText(message).trim();
  return (
    /^(listo|ok|oka|okey|dale|perfecto|genial|joya|excelente|gracias|graciass|buenisimo|buenisima|ya esta|ya quedo)[.!? ]*$/.test(
      text
    ) ||
    text.includes("ya pague") ||
    text.includes("ya abone") ||
    text.includes("ya transferi")
  );
};

const loadLeadMemory = async (
  tenantId: string,
  leadId?: string
): Promise<ConversationMemorySnapshot> => {
  if (!leadId) return { productName: "", confidence: 0, lastAction: "", activeOffer: null, facts: {} };
  try {
    const memory = await prisma.conversationMemory.findFirst({
      where: { tenantId, leadId },
      select: { facts: true }
    });
    if (!memory || typeof memory.facts !== "object" || memory.facts === null) {
      return { productName: "", confidence: 0, lastAction: "", activeOffer: null, facts: {} };
    }
    const facts = memory.facts as {
      entities?: { productName?: string };
      activeProductName?: string;
      extractionConfidence?: number;
      lastRecommendedAction?: string;
      conversationStage?: ConversationStageV1;
      activeOffer?: ActiveOfferV1 | null;
    };
    return {
      productName: String(facts.entities?.productName ?? facts.activeProductName ?? "").trim(),
      confidence: Number(facts.extractionConfidence ?? 0),
      lastAction: String(facts.lastRecommendedAction ?? "").trim(),
      conversationStage: facts.conversationStage,
      activeOffer: facts.activeOffer ?? null,
      facts: memory.facts as Record<string, unknown>
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("conversation_memory")) throw error;
    return { productName: "", confidence: 0, lastAction: "", activeOffer: null, facts: {} };
  }
};

const buildRuleInterpretation = (input: {
  message: string;
  intent: string;
  previousStage?: ConversationStageV1;
  activeOffer?: ActiveOfferV1 | null;
  matched?: VariantMatch | null;
  hasReservation: boolean;
  shouldPreserveClosedSale: boolean;
}): ConversationInterpretationV1 => {
  const normalizedMessage = normalizeConversationText(input.message);
  const references: ConversationReferenceV1[] = [];
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
  const entities: ConversationInterpretationV1["entities"] = {
    productName: input.matched?.productName ?? input.activeOffer?.productName ?? null,
    variantId: input.matched?.variantId ?? input.activeOffer?.variantId ?? null,
    variantAttributes: input.matched?.attributes ?? input.activeOffer?.attributes ?? {}
  };
  let nextAction: ConversationInterpretationV1["nextAction"] = "ask_clarification";
  if (input.shouldPreserveClosedSale) {
    nextAction = "reply_only";
  } else if (input.intent === "reportar_pago") {
    nextAction = "manual_review";
  } else if (input.intent === "pedir_link_pago") {
    nextAction = "share_payment_link";
  } else if (input.intent === "pedir_alternativa" || input.matched?.unavailableCombination) {
    nextAction = "suggest_alternative";
  } else if ((input.matched?.missingAxes.length ?? 0) > 0) {
    nextAction = "ask_clarification";
  } else if (input.intent === "aceptar_oferta" || input.intent === "confirmar_compra") {
    nextAction = input.hasReservation ? "share_payment_link" : "reserve_stock";
  } else if (input.intent === "elegir_variante" || input.intent === "consultar_talle" || input.intent === "consultar_color") {
    nextAction = input.matched?.variantId ? "offer_reservation" : "confirm_variant";
  } else if (normalizedMessage.includes("link")) {
    nextAction = "share_payment_link";
  } else if (input.matched?.variantId) {
    nextAction = "offer_reservation";
  }
  const conversationStage = resolveStageFromContext({
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
    notes: [resolveExpectedCustomerAction(conversationStage) ?? "unknown_expected_action"]
  };
};

const loadVariantById = async (tenantId: string, variantId?: string | null): Promise<VariantMatch | null> => {
  if (!variantId) return null;
  const rows = (await (prisma as any).$queryRaw`
    select
      p.name as "productName",
      v.id as "variantId",
      v.attributes as "attributes"
    from public.product_variants v
    inner join public.products p on p.id = v.product_id
    where v.tenant_id::text = ${tenantId}
      and v.id::text = ${variantId}
    limit 1
  `) as Array<{ productName: string; variantId: string; attributes: Record<string, string> }>;
  const row = rows[0];
  if (!row) return null;
  return {
    productName: row.productName,
    variantId: row.variantId,
    attributes: row.attributes ?? {},
    missingAxes: []
  };
};

export const messageProcessorWorker = new Worker<IncomingMessageJobV1>(
  QueueNames.incomingMessages,
  async (job: Job<IncomingMessageJobV1>) => {
    const { tenantId, payload } = job.data;
    if (!isTrackablePhone(payload.phone)) return;

    const lock = await lockService.acquire(tenantId, payload.phone);
    try {
      const intent = intentDetection.detect(payload.message);
      const llmPolicy = await llmRollout.getPolicy(tenantId);
      const conversation = await prisma.conversation.findFirst({
        where: { tenantId, phone: payload.phone },
        orderBy: { updatedAt: "desc" },
        select: { id: true, state: true }
      });
      const leadWasClosed = conversation?.state === "lead_closed";

      const existingLead = await prisma.lead.findFirst({
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
      const shouldPreserveClosedSale =
        existingLead?.status === "vendido" && isPostSaleAcknowledgementMessage(payload.message);

      const memory = await loadLeadMemory(tenantId, existingLead?.id);
      const tenantKnowledge = await tenantKnowledgeService.getWithRulePack(tenantId);
      const matched = (await productMatcher.matchByMessage(tenantId, payload.message, {
        previousProductName: existingLead?.product ?? memory.productName ?? memory.activeOffer?.productName,
        previousProductConfidence: memory.confidence,
        lastRecommendedAction: memory.lastAction,
        requiredAxes: tenantKnowledge.rulePack.requiredAxes
      })) as VariantMatch | null;
      const storedVariantMatch = await loadVariantById(tenantId, existingLead?.productVariantId);
      const paymentOrReservationFollowUp =
        isReservationFollowUpMessage(payload.message) ||
        intent === "elegir_medio_pago" ||
        intent === "pedir_link_pago";
      const reservationContextActive =
        Boolean(existingLead?.hasStockReservation) || existingLead?.status === "listo_para_cobrar";
      const alignedWithStoredVariant =
        !matched ||
        (Boolean(matched.variantId) &&
          Boolean(storedVariantMatch?.variantId) &&
          storedVariantMatch !== null &&
          matched.variantId === storedVariantMatch.variantId) ||
        (storedVariantMatch !== null &&
          matched?.productName === storedVariantMatch.productName &&
          (matched?.missingAxes.length ?? 0) > 0);
      const forcePreserveForPaymentFollowUp =
        paymentOrReservationFollowUp && reservationContextActive && Boolean(storedVariantMatch?.variantId);
      const shouldPreserveStoredVariant =
        Boolean(storedVariantMatch?.variantId) &&
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
      const shouldRepairVariantForPayment =
        storedVariantMatch?.variantId &&
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
      if (
        !["confirmar_compra", "aceptar_oferta"].includes(effectiveIntent) &&
        Boolean(effectiveMatched?.variantId) &&
        !(effectiveMatched?.missingAxes.length ?? 0) &&
        !effectiveMatched?.unavailableCombination &&
        isContextualPurchaseConfirmation(payload.message)
      ) {
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
      const isBusinessRelated =
        hasCommercialIntent || intentDetection.isBusinessRelated(payload.message, Boolean(effectiveMatched?.variantId));

      let score = shouldPreserveClosedSale ? existingLead?.score ?? 120 : leadWasClosed ? 0 : existingLead?.score ?? 0;
      let status = shouldPreserveClosedSale ? "vendido" : leadWasClosed ? "frio" : existingLead?.status ?? "frio";
      const hasUnavailableCombination = Boolean(effectiveMatched?.unavailableCombination);
      const needsClarificationForAxes =
        isBusinessRelated &&
        Boolean(effectiveMatched?.productName) &&
        !hasUnavailableCombination &&
        (effectiveMatched?.missingAxes.length ?? 0) > 0;
      const forceLeadWorkerForReservedPaymentFollowUp =
        Boolean(storedVariantMatch?.variantId) &&
        Boolean(existingLead?.hasStockReservation) &&
        (intent === "pedir_link_pago" ||
          intent === "elegir_medio_pago" ||
          isReservationFollowUpMessage(payload.message));
      const shouldHandleInLeadWorker =
        Boolean(effectiveMatched?.variantId) ||
        needsClarificationForAxes ||
        hasUnavailableCombination ||
        forceLeadWorkerForReservedPaymentFollowUp;
      const hadActiveReservation =
        !leadWasClosed &&
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
      const activeOffer = buildActiveOfferSnapshot({
        existing: memory.activeOffer ?? null,
        productName: effectiveMatched?.productName ?? memory.activeOffer?.productName ?? existingLead?.product ?? null,
        variantId: effectiveMatched?.variantId ?? memory.activeOffer?.variantId ?? existingLead?.productVariantId ?? null,
        attributes: effectiveMatched?.attributes ?? memory.activeOffer?.attributes ?? {},
        expectedCustomerAction: resolveExpectedCustomerAction(ruleInterpretation.conversationStage)
      });
      let reserved = hadActiveReservation;
      let reservationExpiresAt =
        hadActiveReservation && existingLead?.reservationExpiresAt
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
        } else if (hasUnavailableCombination) {
          status = "consulta";
          score = Math.max(score, 65);
          reserved = false;
        } else if (
          [
            "confirmar_compra",
            "aceptar_oferta",
            "pedir_link_pago",
            "elegir_medio_pago",
            "reportar_pago"
          ].includes(effectiveIntent) &&
          effectiveMatched?.variantId
        ) {
          if (llmPolicy.enabled && llmPolicy.executionMode === "shadow") {
            reserved = hadActiveReservation;
            status = "listo_para_cobrar";
            score = Math.max(score, 120);
          } else {
            const hasActiveReservation =
              !leadWasClosed &&
              Boolean(existingLead?.hasStockReservation) &&
              existingLead?.productVariantId === effectiveMatched.variantId &&
              (!existingLead?.reservationExpiresAt || new Date(existingLead.reservationExpiresAt).getTime() > Date.now());
            if (hasActiveReservation) {
              reserved = true;
              if (existingLead?.reservationExpiresAt) {
                reservationExpiresAt = new Date(existingLead.reservationExpiresAt);
              }
            } else {
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

      let profilePictureUrl: string | undefined;
      try {
        const waUrl = process.env.WHATSAPP_API_URL ?? "http://whatsapp:3100";
        const picRes = await fetch(`${waUrl}/contacts/${payload.phone}/profile-picture?tenantId=${tenantId}`);
        if (picRes.ok) {
          const picData = (await picRes.json()) as { url: string | null };
          profilePictureUrl = picData.url ?? undefined;
        }
      } catch {}

      const reservationActive = shouldPreserveClosedSale
        ? false
        : reserved || (Boolean(existingLead?.hasStockReservation) && !leadWasClosed);
      const shouldTrackLead = shouldPreserveClosedSale || (Boolean(existingLead?.id) && !leadWasClosed) || isBusinessRelated;
      const leadUpdatePayload = {
        customerName: payload.name?.trim() ? payload.name.trim() : undefined,
        status: isBusinessRelated || shouldPreserveClosedSale ? status : undefined,
        score: isBusinessRelated || shouldPreserveClosedSale ? score : undefined,
        product:
          isBusinessRelated && !shouldPreserveClosedSale
            ? effectiveMatched?.productName
            : shouldPreserveClosedSale
              ? existingLead?.product
              : undefined,
        productVariantId:
          isBusinessRelated && !shouldPreserveClosedSale
            ? effectiveMatched?.variantId
            : shouldPreserveClosedSale
              ? existingLead?.productVariantId
              : undefined,
        productVariantAttributes:
          isBusinessRelated && !shouldPreserveClosedSale ? (effectiveMatched?.attributes ?? undefined) : undefined,
        hasStockReservation: isBusinessRelated || shouldPreserveClosedSale ? reservationActive : undefined,
        reservationExpiresAt:
          isBusinessRelated || shouldPreserveClosedSale ? (reservationActive ? reservationExpiresAt : null) : undefined,
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
          ? await prisma.lead.update({
              where: { id: existingLead.id },
              data: leadUpdatePayload
            })
          : await prisma.lead.create({
              data: leadCreatePayload
            })
        : null;

      if (lead && reserved && effectiveMatched?.variantId) {
        await stockReservationExpiryQueue.add(
          "reservation-expire",
          {
            tenantId,
            leadId: lead.id,
            variantId: effectiveMatched.variantId
          },
          {
            delay: reservationTtlMs,
            jobId: `reservation_${tenantId}_${lead.id}_${effectiveMatched.variantId}`
          }
        );
      }

      let messageRecord: { id: string };
      try {
        messageRecord = await prisma.message.create({
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
      } catch {
        messageRecord = await prisma.message.create({
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
        const updatedConversation = await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessage: payload.message,
            state: shouldPreserveClosedSale ? "lead_closed" : leadWasClosed ? "open" : undefined
          },
          select: { id: true }
        });
        effectiveConversationId = updatedConversation.id;
      } else {
        const createdConversation = await prisma.conversation.create({
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
          const llmJob: LlmOrchestrationJobV1 = {
            schemaVersion: JOB_SCHEMA_VERSION,
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
          await llmOrchestrationQueue.add("llm-orchestration-v1", llmJob, {
            jobId: `llm_${llmJob.dedupeKey}`
          });
        } else {
          const leadDedupe = buildStableDedupeKey("lead", tenantId, payload.phone, messageRecord.id);
          await leadProcessingQueue.add(
            "lead-processed-v1",
            {
              schemaVersion: JOB_SCHEMA_VERSION,
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
            },
            {
              jobId: `lead_${leadDedupe}`
            }
          );
        }
        processorMetrics.onEnqueued();
      }
    } finally {
      await lockService.release(lock.key, lock.token);
    }
  },
  {
    connection: redisConnection,
    concurrency: Number(process.env.PROCESSOR_CONCURRENCY ?? 8)
  }
);

messageProcessorWorker.on("active", () => {
  processorMetrics.onProcessing();
});

messageProcessorWorker.on("completed", () => {
  processorMetrics.onCompleted();
});

messageProcessorWorker.on("failed", (job) => {
  const attempts = job?.opts?.attempts ?? 1;
  const willRetry = (job?.attemptsMade ?? 0) < attempts;
  processorMetrics.onFailed(willRetry);
});
