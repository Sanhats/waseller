export declare const JOB_SCHEMA_VERSION: 1;
export type JobSchemaVersion = typeof JOB_SCHEMA_VERSION;
export type IncomingMessagePayloadV1 = {
    phone: string;
    name?: string;
    message: string;
    timestamp: string;
    externalMessageId?: string;
    source?: "whatsapp" | "api";
};
export type IncomingMessageJobV1 = {
    schemaVersion: JobSchemaVersion;
    correlationId: string;
    dedupeKey: string;
    tenantId: string;
    payload: IncomingMessagePayloadV1;
    createdAt: string;
};
export type ConversationStageV1 = "waiting_product" | "waiting_variant" | "variant_offered" | "waiting_reservation_confirmation" | "reserved_waiting_payment_method" | "payment_link_sent" | "waiting_payment_confirmation" | "sale_confirmed";
export type ConversationNextActionV1 = "reply_only" | "ask_clarification" | "confirm_variant" | "offer_reservation" | "reserve_stock" | "share_payment_link" | "suggest_alternative" | "handoff_human" | "close_lead" | "manual_review";
export type ConversationReferenceV1 = {
    kind: "active_offer" | "active_variant" | "reserved_variant" | "alternative_variant" | "product_context";
    value?: string | null;
    axis?: string | null;
    index?: number | null;
    confidence?: number;
    metadata?: Record<string, string | number | boolean | null>;
};
export type ActiveOfferV1 = {
    productName?: string | null;
    variantId?: string | null;
    attributes?: Record<string, string>;
    price?: number | null;
    availableStock?: number | null;
    alternativeVariants?: Array<{
        variantId?: string | null;
        attributes: Record<string, string>;
        availableStock?: number | null;
    }>;
    expectedCustomerAction?: string | null;
};
export type ConversationInterpretationV1 = {
    intent: string;
    confidence: number;
    entities: Record<string, string | number | boolean | null | Record<string, string>>;
    references: ConversationReferenceV1[];
    conversationStage?: ConversationStageV1;
    missingFields: string[];
    nextAction: ConversationNextActionV1;
    source: "rules" | "openai";
    notes?: string[];
    /** Resumen de oferta activa (solo payload hacia waseller-crew / shadow-compare). */
    activeOfferDigest?: string;
    /** Qué falta para avanzar el embudo (hints cortos). */
    closingGaps?: string[];
    /** Hechos de memoria serializados (solo contexto crew). */
    memoryFactsDigest?: Record<string, string | number | boolean | null>;
    /** Etapa comercial del baseline Waseller al armar el POST. */
    baselineLeadStage?: "discovery" | "consideration" | "decision" | "handoff";
    /** `recommendedAction` del `LlmDecisionV1` baseline (texto). */
    baselineRecommendedAction?: string;
};
export type LeadProcessingJobV1 = {
    schemaVersion: JobSchemaVersion;
    correlationId: string;
    dedupeKey?: string;
    tenantId: string;
    leadId: string;
    phone: string;
    status: string;
    intent?: string;
    incomingMessage?: string;
    isBusinessRelated?: boolean;
    productName?: string | null;
    variantId?: string | null;
    variantAttributes?: Record<string, string>;
    missingAxes?: string[];
    requestedAttributes?: Record<string, string>;
    unavailableCombination?: boolean;
    stockReserved?: boolean;
    conversationStage?: ConversationStageV1;
    activeOffer?: ActiveOfferV1 | null;
    interpretation?: ConversationInterpretationV1;
    llmDecision?: LlmDecisionV1;
    /** Mensaje entrante persistido (ruta directa lead); trazas waseller-crew / shadow. */
    messageId?: string;
    conversationId?: string | null;
    /** Política LLM del tenant en el momento del encolado (solo ruta directa lead). */
    executionMode?: "shadow" | "active";
    /** Hechos de memoria (ruta lead directa → POST waseller-crew / shadow). */
    memoryFacts?: Record<string, unknown>;
};
export type LlmOrchestrationJobV1 = {
    schemaVersion: JobSchemaVersion;
    correlationId: string;
    dedupeKey: string;
    tenantId: string;
    leadId: string;
    phone: string;
    messageId: string;
    conversationId?: string;
    incomingText: string;
    intentHint?: string;
    timestamp: string;
    executionMode?: "shadow" | "active";
    allowSensitiveActions?: boolean;
    verifierRequired?: boolean;
    minVerifierScore?: number;
    conversationStage?: ConversationStageV1;
    activeOffer?: ActiveOfferV1 | null;
    memoryFacts?: Record<string, unknown>;
    ruleInterpretation?: ConversationInterpretationV1;
};
export type LlmVerificationResultV1 = {
    passed: boolean;
    score: number;
    flags: string[];
    reason: string;
    provider: "llm-verifier" | "rules";
    model?: string;
};
export type OutgoingJobV1 = {
    schemaVersion: JobSchemaVersion;
    correlationId: string;
    dedupeKey?: string;
    tenantId: string;
    phone: string;
    message: string;
    imageUrl?: string;
    priority?: number;
    metadata?: {
        source?: "bot" | "manual";
        nextBestAction?: string;
    };
};
export type LlmDecisionV1 = {
    intent: string;
    leadStage: "discovery" | "consideration" | "decision" | "handoff";
    confidence: number;
    entities: Record<string, string | number | boolean | null>;
    nextAction: ConversationNextActionV1;
    reason: string;
    requiresHuman: boolean;
    policyBand?: "high" | "medium" | "low";
    executionMode?: "shadow" | "active";
    policy?: {
        recommendedAction: string;
        executedAction: string;
        shadowMode: boolean;
        allowSensitiveActions: boolean;
        contextRecovered?: boolean;
        verifierRequired?: boolean;
        minVerifierScore?: number;
    };
    verification?: LlmVerificationResultV1;
    recommendedAction: string;
    draftReply: string;
    handoffRequired: boolean;
    qualityFlags: string[];
    source: "llm" | "fallback";
    provider?: "self-hosted" | "openai" | "rules" | "waseller-crew";
    model?: string;
};
export declare const buildStableDedupeKey: (...parts: Array<string | undefined | null>) => string;
export declare const buildCorrelationId: () => string;
