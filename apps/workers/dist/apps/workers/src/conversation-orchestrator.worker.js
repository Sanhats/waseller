"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.conversationOrchestratorWorker = void 0;
const bullmq_1 = require("bullmq");
const src_1 = require("../../../packages/db/src");
const src_2 = require("../../../packages/queue/src");
const queue_metrics_service_1 = require("./services/queue-metrics.service");
const self_hosted_llm_service_1 = require("./services/self-hosted-llm.service");
const conversation_lock_service_1 = require("./services/conversation-lock.service");
const src_3 = require("../../../packages/shared/src");
const bot_template_service_1 = require("./services/bot-template.service");
const llm_verifier_service_1 = require("./services/llm-verifier.service");
const tenant_knowledge_service_1 = require("./services/tenant-knowledge.service");
const openai_interpreter_service_1 = require("./services/openai-interpreter.service");
const conversation_policy_service_1 = require("./services/conversation-policy.service");
const shadow_compare_service_1 = require("./services/shadow-compare.service");
const orchestratorMetrics = new queue_metrics_service_1.QueueMetricsService(src_2.QueueNames.llmOrchestration);
const llmService = new self_hosted_llm_service_1.SelfHostedLlmService();
const interpreterService = new openai_interpreter_service_1.OpenAiInterpreterService();
const templateService = new bot_template_service_1.BotTemplateService();
const verifierService = new llm_verifier_service_1.LlmVerifierService();
const tenantKnowledgeService = new tenant_knowledge_service_1.TenantKnowledgeService();
const lockService = new conversation_lock_service_1.ConversationLockService(src_2.redisConnection, Math.max(1000, Number(process.env.ORCHESTRATOR_LOCK_TTL_MS ?? 12000)), Math.max(200, Number(process.env.ORCHESTRATOR_LOCK_WAIT_MS ?? 8000)));
const HIGH_CONFIDENCE_THRESHOLD = Number(process.env.LLM_POLICY_HIGH_CONFIDENCE ?? 0.8);
const MEDIUM_CONFIDENCE_THRESHOLD = Number(process.env.LLM_POLICY_MEDIUM_CONFIDENCE ?? 0.6);
const normalizeForPolicy = (value) => value.trim().replace(/\s+/g, " ");
const applyGuardrails = (rawReply, guardrailFallbackMessage, incomingText, confidence, threshold) => {
    const flags = [];
    const cleaned = normalizeForPolicy(rawReply);
    const normalizedIncoming = normalizeForPolicy(incomingText).toLowerCase();
    const normalizedReply = cleaned.toLowerCase();
    if (cleaned.length < 5)
        flags.push("empty_reply");
    if (/garantizado|100% seguro|promesa total/i.test(cleaned))
        flags.push("overpromise");
    if (normalizedReply && normalizedReply === normalizedIncoming)
        flags.push("echo_reply");
    const roleConfusionPattern = /^(si+|sii+|dale|ok|perfecto)?\s*[,.-]?\s*(enviame|enviame|mandame|pasame|quiero)\b/i;
    const hasBusinessSignal = /(tenemos|precio|stock|reserva|asesor|podemos|te comparto|te paso|disponible)/i.test(cleaned);
    if (roleConfusionPattern.test(cleaned) && !hasBusinessSignal)
        flags.push("role_confusion");
    if (confidence < threshold)
        flags.push("low_confidence");
    if (flags.length > 0) {
        return {
            message: guardrailFallbackMessage,
            blocked: true,
            flags
        };
    }
    return { message: cleaned, blocked: false, flags };
};
const resolvePolicyBand = (confidence) => {
    if (confidence >= HIGH_CONFIDENCE_THRESHOLD)
        return "high";
    if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD)
        return "medium";
    return "low";
};
const buildRagProducts = async (tenantId, incomingText) => {
    const normalizedText = incomingText.toLowerCase().trim();
    const products = (await src_1.prisma.$queryRaw `
    select
      p.name,
      p.price,
      coalesce(sum(greatest(v.stock - v.reserved_stock, 0)), 0) as "availableStock"
    from public.products p
    left join public.product_variants v on v.product_id = p.id and v.is_active = true
    where p.tenant_id::text = ${tenantId}
      and lower(p.name) like ${`%${normalizedText}%`}
    group by p.id, p.name, p.price
    order by p.updated_at desc
    limit 3
  `);
    return products.map((item) => ({
        name: item.name,
        price: Number(item.price ?? 0),
        availableStock: Number(item.availableStock ?? 0)
    }));
};
exports.conversationOrchestratorWorker = new bullmq_1.Worker(src_2.QueueNames.llmOrchestration, async (job) => {
    const { tenantId, leadId, phone, incomingText, intentHint, correlationId, messageId, conversationId, dedupeKey } = job.data;
    const startedAt = Date.now();
    const lock = await lockService.acquire(tenantId, phone);
    try {
        const lead = await src_1.prisma.lead.findUnique({
            where: { id: leadId },
            select: { status: true, score: true, id: true }
        });
        if (!lead)
            return;
        const tenant = await src_1.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { llmConfidenceThreshold: true }
        });
        const confidenceThreshold = Number(tenant?.llmConfidenceThreshold ?? 0.72);
        const recentMessages = (await src_1.prisma.message.findMany({
            where: { tenantId, phone },
            orderBy: { createdAt: "desc" },
            take: 8,
            select: {
                direction: true,
                message: true
            }
        }));
        const ragProducts = await buildRagProducts(tenantId, incomingText);
        const tenantKnowledge = await tenantKnowledgeService.getWithRulePack(tenantId);
        const interpreted = await interpreterService.interpret({
            incomingText,
            hintIntent: intentHint,
            conversationStage: job.data.conversationStage,
            activeOffer: job.data.activeOffer ?? null,
            tenantProfile: tenantKnowledge.profile,
            rubroRulePack: tenantKnowledge.rulePack,
            recentMessages: recentMessages
                .reverse()
                .map((item) => ({
                direction: item.direction,
                message: item.message
            })),
            candidateProducts: ragProducts,
            ruleInterpretation: job.data.ruleInterpretation ?? null
        });
        const llmDecision = await llmService.decide({
            tenantId,
            phone,
            incomingText,
            hintIntent: intentHint,
            leadStatus: lead.status,
            leadScore: lead.score,
            candidateProducts: ragProducts,
            recentMessages: recentMessages
                .reverse()
                .map((item) => ({
                direction: item.direction,
                message: item.message
            })),
            confidenceThreshold,
            tenantProfile: tenantKnowledge.profile,
            rubroRulePack: tenantKnowledge.rulePack,
            conversationStage: job.data.conversationStage,
            activeOffer: job.data.activeOffer ?? null,
            interpretation: interpreted,
            memoryFacts: job.data.memoryFacts ?? {}
        });
        const payment = tenantKnowledge.profile.payment?.methods ?? [];
        const verifierRequired = job.data.verifierRequired !== false;
        const minVerifierScore = Math.max(0, Math.min(1, Number(job.data.minVerifierScore ?? 0.65)));
        const verification = await verifierService.verify({
            tenantId,
            incomingText,
            draftReply: llmDecision.draftReply,
            decision: llmDecision,
            candidateProducts: ragProducts,
            tenantProfile: tenantKnowledge.profile
        });
        const verifierFailed = verifierRequired && (!verification.passed || verification.score < minVerifierScore);
        const guardrailFallbackMessage = (await templateService.getTemplate(tenantId, "orchestrator_guardrail_handoff")) ||
            "Quiero asegurarme de darte la mejor respuesta. Te paso con un asesor para confirmar los detalles y ayudarte a cerrar la compra.";
        const guardrails = applyGuardrails(llmDecision.draftReply, guardrailFallbackMessage, incomingText, llmDecision.confidence, confidenceThreshold);
        const policyBand = resolvePolicyBand(llmDecision.confidence);
        const shadowMode = (job.data.executionMode ?? "active") === "shadow";
        const requiresHuman = Boolean(llmDecision.requiresHuman) ||
            llmDecision.confidence < confidenceThreshold ||
            verifierFailed;
        const policyResolution = (0, conversation_policy_service_1.resolvePolicyAction)({
            interpretation: interpreted,
            decision: llmDecision,
            shadowMode,
            allowSensitiveActions: Boolean(job.data.allowSensitiveActions),
            requiresHuman,
            forbiddenActions: tenantKnowledge.rulePack.forbiddenActions,
            paymentMethods: Array.isArray(payment) ? payment.map((item) => String(item)) : []
        });
        const recommendedAction = policyResolution.recommendedAction;
        const executedAction = policyResolution.executedAction;
        const contextRecovered = Boolean(typeof llmDecision.entities?.productName === "string" &&
            llmDecision.entities.productName &&
            !incomingText
                .toLowerCase()
                .includes(String(llmDecision.entities.productName).toLowerCase()));
        const effectiveDecision = {
            ...llmDecision,
            draftReply: guardrails.message,
            nextAction: recommendedAction,
            reason: llmDecision.reason ?? "decision_llm_or_fallback",
            requiresHuman: requiresHuman || guardrails.blocked,
            policyBand,
            executionMode: shadowMode ? "shadow" : "active",
            policy: {
                recommendedAction,
                executedAction,
                shadowMode,
                allowSensitiveActions: Boolean(job.data.allowSensitiveActions),
                contextRecovered,
                verifierRequired,
                minVerifierScore
            },
            verification,
            recommendedAction: recommendedAction,
            handoffRequired: llmDecision.handoffRequired || guardrails.blocked || requiresHuman,
            qualityFlags: [
                ...new Set([
                    ...(llmDecision.qualityFlags ?? []),
                    ...guardrails.flags,
                    ...policyResolution.flags,
                    ...(verifierFailed ? ["verifier_failed"] : []),
                    ...(verification.flags ?? [])
                ])
            ]
        };
        const activeOffer = (0, conversation_policy_service_1.buildActiveOfferSnapshot)({
            existing: job.data.activeOffer ?? null,
            productName: typeof interpreted.entities.productName === "string" ? interpreted.entities.productName : job.data.activeOffer?.productName,
            variantId: typeof interpreted.entities.variantId === "string" ? interpreted.entities.variantId : job.data.activeOffer?.variantId,
            attributes: interpreted.entities.variantAttributes &&
                typeof interpreted.entities.variantAttributes === "object" &&
                !Array.isArray(interpreted.entities.variantAttributes)
                ? interpreted.entities.variantAttributes
                : job.data.activeOffer?.attributes ?? {},
            price: ragProducts[0]?.price ?? job.data.activeOffer?.price ?? null,
            availableStock: ragProducts[0]?.availableStock ?? job.data.activeOffer?.availableStock ?? null,
            expectedCustomerAction: (0, conversation_policy_service_1.resolveExpectedCustomerAction)(interpreted.conversationStage)
        });
        await src_1.prisma.conversationMemory.upsert({
            where: {
                leadId
            },
            update: {
                conversationId: conversationId ?? undefined,
                facts: {
                    intent: effectiveDecision.intent,
                    leadStage: effectiveDecision.leadStage,
                    conversationStage: interpreted.conversationStage,
                    recommendedAction: effectiveDecision.recommendedAction,
                    entities: effectiveDecision.entities,
                    interpretation: interpreted,
                    activeProductName: typeof effectiveDecision.entities?.productName === "string"
                        ? effectiveDecision.entities.productName
                        : null,
                    activeOffer,
                    lastRecommendedAction: effectiveDecision.nextAction,
                    extractionConfidence: effectiveDecision.confidence,
                    missingFields: interpreted.missingFields
                },
                source: effectiveDecision.source,
                schemaVersion: src_2.JOB_SCHEMA_VERSION
            },
            create: {
                tenantId,
                leadId,
                conversationId,
                schemaVersion: src_2.JOB_SCHEMA_VERSION,
                facts: {
                    intent: effectiveDecision.intent,
                    leadStage: effectiveDecision.leadStage,
                    conversationStage: interpreted.conversationStage,
                    recommendedAction: effectiveDecision.recommendedAction,
                    entities: effectiveDecision.entities,
                    interpretation: interpreted,
                    activeProductName: typeof effectiveDecision.entities?.productName === "string"
                        ? effectiveDecision.entities.productName
                        : null,
                    activeOffer,
                    lastRecommendedAction: effectiveDecision.nextAction,
                    extractionConfidence: effectiveDecision.confidence,
                    missingFields: interpreted.missingFields
                },
                source: effectiveDecision.source
            }
        });
        const trace = await src_1.prisma.llmTrace.create({
            data: {
                tenantId,
                leadId,
                conversationId,
                messageId,
                correlationId,
                dedupeKey,
                traceKind: "reply",
                provider: effectiveDecision.provider ?? "self-hosted",
                model: effectiveDecision.model ?? "self-hosted-default",
                request: {
                    incomingText,
                    intentHint,
                    interpretation: interpreted,
                    ragProducts,
                    recentMessages,
                    tenantProfile: tenantKnowledge.profile,
                    rubroRulePack: tenantKnowledge.rulePack
                },
                response: effectiveDecision,
                promptTokens: null,
                completionTokens: null,
                latencyMs: Date.now() - startedAt,
                handoffRequired: effectiveDecision.handoffRequired
            }
        });
        if (shadowMode) {
            const recentChronological = recentMessages
                .slice()
                .reverse()
                .map((item) => ({
                direction: item.direction,
                message: item.message
            }));
            void (0, shadow_compare_service_1.logShadowExternalCompareIfConfigured)({
                tenantId,
                leadId,
                conversationId,
                messageId,
                correlationId,
                dedupeKey,
                phone,
                incomingText,
                interpretation: interpreted,
                baselineDecision: effectiveDecision,
                recentMessages: recentChronological,
                tenantBusinessCategory: tenantKnowledge.profile.businessCategory
            }).catch(() => undefined);
        }
        await src_1.prisma.llmTrace.create({
            data: {
                tenantId,
                leadId,
                conversationId,
                messageId,
                correlationId,
                dedupeKey: `${dedupeKey}:verify`,
                traceKind: "verification",
                provider: verification.provider,
                model: verification.model ?? null,
                request: {
                    incomingText,
                    interpretation: interpreted,
                    draftReply: llmDecision.draftReply,
                    candidateProducts: ragProducts,
                    minVerifierScore,
                    verifierRequired,
                    tenantProfile: tenantKnowledge.profile
                },
                response: verification,
                promptTokens: null,
                completionTokens: null,
                latencyMs: null,
                handoffRequired: verifierFailed
            }
        });
        const leadJob = {
            schemaVersion: src_2.JOB_SCHEMA_VERSION,
            correlationId,
            dedupeKey: (0, src_2.buildStableDedupeKey)("lead", dedupeKey, leadId),
            tenantId,
            leadId,
            phone,
            status: lead.status,
            intent: effectiveDecision.intent,
            incomingMessage: incomingText,
            isBusinessRelated: true,
            productName: typeof effectiveDecision.entities.productName === "string"
                ? effectiveDecision.entities.productName
                : null,
            variantId: typeof effectiveDecision.entities.variantId === "string"
                ? effectiveDecision.entities.variantId
                : null,
            variantAttributes: effectiveDecision.entities.variantAttributes &&
                typeof effectiveDecision.entities.variantAttributes === "object" &&
                !Array.isArray(effectiveDecision.entities.variantAttributes)
                ? effectiveDecision.entities.variantAttributes
                : {},
            stockReserved: false,
            conversationStage: interpreted.conversationStage,
            activeOffer,
            interpretation: interpreted,
            llmDecision: effectiveDecision
        };
        await src_2.leadProcessingQueue.add("lead-processed-v1", leadJob, {
            jobId: `lead_${leadJob.dedupeKey}`
        });
        orchestratorMetrics.onEnqueued();
        const nextScore = (0, src_3.leadStageToScore)(effectiveDecision.leadStage);
        await src_1.prisma.leadScoreEvent.create({
            data: {
                tenantId,
                leadId,
                previousScore: lead.score,
                newScore: nextScore,
                delta: nextScore - lead.score,
                reason: effectiveDecision.recommendedAction,
                source: effectiveDecision.source === "llm" ? "llm" : "rule",
                metadata: {
                    traceId: trace.id,
                    confidence: effectiveDecision.confidence,
                    qualityFlags: effectiveDecision.qualityFlags,
                    policyBand: effectiveDecision.policyBand,
                    recommendedAction: effectiveDecision.nextAction,
                    executedAction: effectiveDecision.policy?.executedAction
                },
                relatedTraceId: trace.id
            }
        });
        await src_1.prisma.lead.update({
            where: { id: leadId },
            data: { score: nextScore }
        });
        if (effectiveDecision.handoffRequired) {
            const existingConversation = await src_1.prisma.conversation.findFirst({
                where: { tenantId, phone },
                orderBy: { updatedAt: "desc" },
                select: { id: true }
            });
            if (existingConversation) {
                await src_1.prisma.conversation.update({
                    where: { id: existingConversation.id },
                    data: {
                        state: "manual_paused",
                        lastMessage: (await templateService.getTemplate(tenantId, "orchestrator_auto_handoff_summary")) ||
                            "Derivación automática a asesor por baja confianza o necesidad de atención humana."
                    }
                });
            }
        }
    }
    finally {
        await lockService.release(lock.key, lock.token);
    }
}, {
    connection: src_2.redisConnection,
    concurrency: Number(process.env.ORCHESTRATOR_CONCURRENCY ?? 4)
});
exports.conversationOrchestratorWorker.on("active", () => {
    orchestratorMetrics.onProcessing();
});
exports.conversationOrchestratorWorker.on("completed", () => {
    orchestratorMetrics.onCompleted();
});
exports.conversationOrchestratorWorker.on("failed", (job) => {
    const attempts = job?.opts?.attempts ?? 1;
    const willRetry = (job?.attemptsMade ?? 0) < attempts;
    orchestratorMetrics.onFailed(willRetry);
});
