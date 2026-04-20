import { Job, Worker } from "bullmq";
import { prisma } from "../../../packages/db/src";
import {
  JOB_SCHEMA_VERSION,
  LeadProcessingJobV1,
  ConversationInterpretationV1,
  LlmDecisionV1,
  LlmOrchestrationJobV1,
  QueueNames,
  buildStableDedupeKey,
  leadProcessingQueue,
  redisConnection
} from "../../../packages/queue/src";
import { QueueMetricsService } from "./services/queue-metrics.service";
import { SelfHostedLlmService } from "./services/self-hosted-llm.service";
import { ConversationLockService } from "./services/conversation-lock.service";
import { leadStageToScore } from "../../../packages/shared/src";
import { BotTemplateService } from "./services/bot-template.service";
import { LlmVerifierService } from "./services/llm-verifier.service";
import { TenantKnowledgeService } from "./services/tenant-knowledge.service";
import { OpenAiInterpreterService } from "./services/openai-interpreter.service";
import {
  applyReplyGuardrails,
  buildActiveOfferSnapshot,
  resolveExpectedCustomerAction,
  resolvePolicyAction
} from "./services/conversation-policy.service";
import {
  enrichRecentMessagesWithLastBotReply,
  replySimilarity
} from "./services/conversation-recent-messages.service";
import {
  logShadowExternalCompareIfConfigured,
  resolveProductIdForTenantVariant,
  tryWasellerCrewPrimaryReplacement
} from "./services/shadow-compare.service";

const orchestratorMetrics = new QueueMetricsService(QueueNames.llmOrchestration);
const llmService = new SelfHostedLlmService();
const interpreterService = new OpenAiInterpreterService();
const templateService = new BotTemplateService();
const verifierService = new LlmVerifierService();
const tenantKnowledgeService = new TenantKnowledgeService();
const lockService = new ConversationLockService(
  redisConnection,
  Math.max(1000, Number(process.env.ORCHESTRATOR_LOCK_TTL_MS ?? 12000)),
  Math.max(200, Number(process.env.ORCHESTRATOR_LOCK_WAIT_MS ?? 8000))
);
const HIGH_CONFIDENCE_THRESHOLD = Number(process.env.LLM_POLICY_HIGH_CONFIDENCE ?? 0.8);
const MEDIUM_CONFIDENCE_THRESHOLD = Number(process.env.LLM_POLICY_MEDIUM_CONFIDENCE ?? 0.6);

const resolvePolicyBand = (confidence: number): "high" | "medium" | "low" => {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
};

const buildRagProducts = async (
  tenantId: string,
  incomingText: string
): Promise<Array<{ name: string; price: number; availableStock: number }>> => {
  const normalizedText = incomingText.toLowerCase().trim();
  const products = (await (prisma as any).$queryRaw`
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
  `) as Array<{ name: string; price: unknown; availableStock: number }>;

  return products.map((item) => ({
    name: item.name,
    price: Number(item.price ?? 0),
    availableStock: Number(item.availableStock ?? 0)
  }));
};

export const conversationOrchestratorWorker = new Worker<LlmOrchestrationJobV1>(
  QueueNames.llmOrchestration,
  async (job: Job<LlmOrchestrationJobV1>) => {
    const {
      tenantId,
      leadId,
      phone,
      incomingText,
      intentHint,
      correlationId,
      messageId,
      conversationId,
      dedupeKey
    } = job.data;
    const startedAt = Date.now();
    const lock = await lockService.acquire(tenantId, phone);
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { status: true, score: true, id: true }
      });
      if (!lead) return;

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { llmConfidenceThreshold: true }
      });
      const confidenceThreshold = Number(tenant?.llmConfidenceThreshold ?? 0.72);

      let recentMessages = (await prisma.message.findMany({
        where: { tenantId, phone },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          direction: true,
          message: true
        }
      })) as Array<{ direction: "incoming" | "outgoing"; message: string }>;
      recentMessages = await enrichRecentMessagesWithLastBotReply(tenantId, phone, recentMessages);
      const ragProducts = await buildRagProducts(tenantId, incomingText);
      const tenantKnowledge = await tenantKnowledgeService.getWithRulePack(tenantId);
      const interpreted = await interpreterService.interpret({
        incomingText,
        hintIntent: intentHint,
        conversationStage: job.data.conversationStage,
        activeOffer: job.data.activeOffer ?? null,
        tenantProfile: tenantKnowledge.profile as Record<string, unknown>,
        rubroRulePack: tenantKnowledge.rulePack as Record<string, unknown>,
        recentMessages: recentMessages
          .reverse()
          .map((item: { direction: "incoming" | "outgoing"; message: string }) => ({
            direction: item.direction,
            message: item.message
          })),
        candidateProducts: ragProducts,
        ruleInterpretation: job.data.ruleInterpretation ?? null
      });
      let llmDecision = await llmService.decide({
        tenantId,
        phone,
        incomingText,
        hintIntent: intentHint,
        leadStatus: lead.status,
        leadScore: lead.score,
        candidateProducts: ragProducts,
        recentMessages: recentMessages
          .reverse()
          .map((item: { direction: "incoming" | "outgoing"; message: string }) => ({
            direction: item.direction,
            message: item.message
          })),
        confidenceThreshold,
        tenantProfile: tenantKnowledge.profile as Record<string, unknown>,
        rubroRulePack: tenantKnowledge.rulePack as Record<string, unknown>,
        conversationStage: job.data.conversationStage,
        activeOffer: job.data.activeOffer ?? null,
        interpretation: interpreted,
        memoryFacts: job.data.memoryFacts ?? {}
      });

      const recentChronologicalForCrew = recentMessages
        .slice()
        .reverse()
        .map((item: { direction: "incoming" | "outgoing"; message: string }) => ({
          direction: item.direction,
          message: item.message
        }));
      const variantIdForStock =
        (typeof interpreted.entities?.variantId === "string" ? interpreted.entities.variantId : null) ??
        job.data.activeOffer?.variantId ??
        null;
      let stockTableProductId: string | null = null;
      if (variantIdForStock) {
        try {
          stockTableProductId = await resolveProductIdForTenantVariant(tenantId, variantIdForStock);
        } catch {
          stockTableProductId = null;
        }
      }
      let crewPrimaryApplied = false;
      const crewPrimary = await tryWasellerCrewPrimaryReplacement({
        tenantId,
        leadId,
        conversationId,
        messageId,
        correlationId,
        dedupeKey,
        phone,
        incomingText,
        interpretation: interpreted,
        baselineDecision: llmDecision,
        recentMessages: recentChronologicalForCrew,
        tenantBusinessCategory: tenantKnowledge.profile.businessCategory,
        stockTableProductId
      }).catch(() => null);
      if (crewPrimary) {
        llmDecision = crewPrimary.decision;
        crewPrimaryApplied = true;
      }

      const payment =
        (tenantKnowledge.profile.payment as { methods?: string[] } | undefined)?.methods ?? [];
      const verifierRequired = job.data.verifierRequired !== false;
      const minVerifierScore = Math.max(0, Math.min(1, Number(job.data.minVerifierScore ?? 0.65)));
      const verification = await verifierService.verify({
        tenantId,
        incomingText,
        draftReply: llmDecision.draftReply,
        decision: llmDecision,
        candidateProducts: ragProducts,
        tenantProfile: tenantKnowledge.profile as Record<string, unknown>
      });
      const verifierFailed = verifierRequired && (!verification.passed || verification.score < minVerifierScore);

      const guardrailFallbackMessage =
        (await templateService.getTemplate(tenantId, "orchestrator_guardrail_handoff")) ||
        "Quiero asegurarme de darte la mejor respuesta. Te paso con un asesor para confirmar los detalles y ayudarte a cerrar la compra.";
      const guardrails = applyReplyGuardrails(
        llmDecision.draftReply,
        guardrailFallbackMessage,
        incomingText,
        llmDecision.confidence,
        confidenceThreshold
      );
      const policyBand = resolvePolicyBand(llmDecision.confidence);
      const shadowMode = (job.data.executionMode ?? "active") === "shadow";
      const requiresHuman =
        Boolean(llmDecision.requiresHuman) ||
        llmDecision.confidence < confidenceThreshold ||
        verifierFailed;
      const policyResolution = resolvePolicyAction({
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
      const contextRecovered = Boolean(
        typeof llmDecision.entities?.productName === "string" &&
          llmDecision.entities.productName &&
          !incomingText
            .toLowerCase()
            .includes(String(llmDecision.entities.productName).toLowerCase())
      );
      const effectiveDecision: LlmDecisionV1 = {
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
      const activeOffer = buildActiveOfferSnapshot({
        existing: job.data.activeOffer ?? null,
        productName:
          typeof interpreted.entities.productName === "string" ? interpreted.entities.productName : job.data.activeOffer?.productName,
        variantId:
          typeof interpreted.entities.variantId === "string" ? interpreted.entities.variantId : job.data.activeOffer?.variantId,
        attributes:
          interpreted.entities.variantAttributes &&
          typeof interpreted.entities.variantAttributes === "object" &&
          !Array.isArray(interpreted.entities.variantAttributes)
            ? (interpreted.entities.variantAttributes as Record<string, string>)
            : job.data.activeOffer?.attributes ?? {},
        price: ragProducts[0]?.price ?? job.data.activeOffer?.price ?? null,
        availableStock: ragProducts[0]?.availableStock ?? job.data.activeOffer?.availableStock ?? null,
        expectedCustomerAction: resolveExpectedCustomerAction(interpreted.conversationStage)
      });

      await prisma.conversationMemory.upsert({
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
            activeProductName:
              typeof effectiveDecision.entities?.productName === "string"
                ? effectiveDecision.entities.productName
                : null,
            activeOffer,
            lastRecommendedAction: effectiveDecision.nextAction,
            extractionConfidence: effectiveDecision.confidence,
            missingFields: interpreted.missingFields
          },
          source: effectiveDecision.source,
          schemaVersion: JOB_SCHEMA_VERSION
        },
        create: {
          tenantId,
          leadId,
          conversationId,
          schemaVersion: JOB_SCHEMA_VERSION,
          facts: {
            intent: effectiveDecision.intent,
            leadStage: effectiveDecision.leadStage,
            conversationStage: interpreted.conversationStage,
            recommendedAction: effectiveDecision.recommendedAction,
            entities: effectiveDecision.entities,
            interpretation: interpreted,
            activeProductName:
              typeof effectiveDecision.entities?.productName === "string"
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

      const lastOutgoingForDiag = await prisma.message.findFirst({
        where: { tenantId, phone, direction: "outgoing" },
        orderBy: { createdAt: "desc" },
        select: { message: true }
      });
      const baselineEchoesLastOutgoing =
        Boolean(lastOutgoingForDiag?.message?.trim()) &&
        replySimilarity(effectiveDecision.draftReply, lastOutgoingForDiag.message) >= 0.72;

      const trace = await prisma.llmTrace.create({
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
            rubroRulePack: tenantKnowledge.rulePack,
            conversationDiagnostics: {
              baselineEchoesLastOutgoing,
              recentMessageTurns: recentMessages.length,
              crewPrimaryApplied
            }
          },
          response: effectiveDecision,
          promptTokens: null,
          completionTokens: null,
          latencyMs: Date.now() - startedAt,
          handoffRequired: effectiveDecision.handoffRequired
        }
      });
      if (shadowMode && !crewPrimaryApplied) {
        void logShadowExternalCompareIfConfigured({
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
          recentMessages: recentChronologicalForCrew,
          tenantBusinessCategory: tenantKnowledge.profile.businessCategory,
          stockTableProductId
        }).catch(() => undefined);
      }
      await prisma.llmTrace.create({
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

      const leadJob: LeadProcessingJobV1 = {
        schemaVersion: JOB_SCHEMA_VERSION,
        correlationId,
        dedupeKey: buildStableDedupeKey("lead", dedupeKey, leadId),
        tenantId,
        leadId,
        phone,
        messageId,
        conversationId: conversationId ?? null,
        executionMode: shadowMode ? "shadow" : "active",
        status: lead.status,
        intent: effectiveDecision.intent,
        incomingMessage: incomingText,
        isBusinessRelated: true,
        productName:
          typeof effectiveDecision.entities.productName === "string"
            ? effectiveDecision.entities.productName
            : null,
        variantId:
          typeof effectiveDecision.entities.variantId === "string"
            ? effectiveDecision.entities.variantId
            : null,
        variantAttributes:
          effectiveDecision.entities.variantAttributes &&
          typeof effectiveDecision.entities.variantAttributes === "object" &&
          !Array.isArray(effectiveDecision.entities.variantAttributes)
            ? (effectiveDecision.entities.variantAttributes as Record<string, string>)
            : {},
        stockReserved: false,
        conversationStage: interpreted.conversationStage,
        activeOffer,
        interpretation: interpreted,
        llmDecision: effectiveDecision
      };
      await leadProcessingQueue.add("lead-processed-v1", leadJob, {
        jobId: `lead_${leadJob.dedupeKey}`
      });
      orchestratorMetrics.onEnqueued();

      const nextScore = leadStageToScore(effectiveDecision.leadStage);
      await prisma.leadScoreEvent.create({
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
      await prisma.lead.update({
        where: { id: leadId },
        data: { score: nextScore }
      });
      if (effectiveDecision.handoffRequired) {
        const existingConversation = await prisma.conversation.findFirst({
          where: { tenantId, phone },
          orderBy: { updatedAt: "desc" },
          select: { id: true }
        });
        if (existingConversation) {
          await prisma.conversation.update({
            where: { id: existingConversation.id },
            data: {
              state: "manual_paused",
              lastMessage:
                (await templateService.getTemplate(tenantId, "orchestrator_auto_handoff_summary")) ||
                "Derivación automática a asesor por baja confianza o necesidad de atención humana."
            }
          });
        }
      }
    } finally {
      await lockService.release(lock.key, lock.token);
    }
  },
  {
    connection: redisConnection,
    concurrency: Number(process.env.ORCHESTRATOR_CONCURRENCY ?? 4)
  }
);

conversationOrchestratorWorker.on("active", () => {
  orchestratorMetrics.onProcessing();
});

conversationOrchestratorWorker.on("completed", () => {
  orchestratorMetrics.onCompleted();
});

conversationOrchestratorWorker.on("failed", (job) => {
  const attempts = job?.opts?.attempts ?? 1;
  const willRetry = (job?.attemptsMade ?? 0) < attempts;
  orchestratorMetrics.onFailed(willRetry);
});
