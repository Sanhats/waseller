import { Job, Worker } from "bullmq";
import {
  QueueNames,
  SuggestionGenerationJobV1,
  redisConnection
} from "../../../packages/queue/src";
import { prisma } from "../../../packages/db/src";
import { CustomerHistoryService } from "./services/customer-history.service";
import { EmbeddingService } from "./services/embedding.service";
import { RagRetrievalService } from "./services/rag-retrieval.service";
import { StyleProfileService } from "./services/style-profile.service";
import { SuggestionLlmService } from "./services/suggestion-llm.service";
import { TenantKnowledgeService } from "./services/tenant-knowledge.service";

const customerHistoryService = new CustomerHistoryService();
const styleProfileService = new StyleProfileService();
const embeddingService = new EmbeddingService();
const ragRetrievalService = new RagRetrievalService(embeddingService);
const suggestionLlm = new SuggestionLlmService();
const tenantKnowledgeService = new TenantKnowledgeService();

/** Recompute si el perfil tiene más de N días o está vacío. */
const STYLE_PROFILE_TTL_MS = Number(process.env.STYLE_PROFILE_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);

const ensureStyleProfile = async (tenantId: string) => {
  const existing = await styleProfileService.load(tenantId);
  if (existing && Date.now() - existing.computedAt.getTime() < STYLE_PROFILE_TTL_MS) {
    return existing;
  }
  try {
    return await styleProfileService.recompute(tenantId);
  } catch (e) {
    console.error("[suggestion-generator] style profile recompute failed", e);
    return existing;
  }
};

const loadMatchedProduct = async (
  tenantId: string,
  variantId: string | null | undefined
) => {
  if (!variantId) return null;
  const rows = (await (prisma as any).$queryRaw`
    select
      p.name as "productName",
      v.id as "variantId",
      v.attributes as "attributes",
      v.stock as "stock",
      v.reserved_stock as "reservedStock",
      coalesce(v.price, p.price) as "price"
    from public.product_variants v
    inner join public.products p on p.id = v.product_id
    where v.tenant_id::text = ${tenantId}
      and v.id::text = ${variantId}
    limit 1
  `) as Array<{
    productName: string;
    variantId: string;
    attributes: Record<string, string>;
    stock: number | null;
    reservedStock: number | null;
    price: unknown;
  }>;
  const row = rows[0];
  if (!row) return null;
  const available = (row.stock ?? 0) - (row.reservedStock ?? 0);
  const priceNum = row.price == null ? null : Number(row.price);
  return {
    productName: row.productName,
    variantId: row.variantId,
    attributes: row.attributes ?? {},
    availableStock: available,
    price: Number.isFinite(priceNum as number) ? (priceNum as number) : null
  };
};

const loadCandidateVariants = async (
  tenantId: string,
  matchedProductName: string | null | undefined,
  excludeVariantId: string | null | undefined
) => {
  if (!matchedProductName) return [];
  const rows = (await (prisma as any).$queryRaw`
    select
      v.id as "variantId",
      p.name as "productName",
      v.attributes as "attributes",
      greatest(coalesce(v.stock, 0) - coalesce(v.reserved_stock, 0), 0) as "availableStock",
      coalesce(v.price, p.price, 0) as "price"
    from public.product_variants v
    inner join public.products p on p.id = v.product_id
    where v.tenant_id::text = ${tenantId}
      and p.name = ${matchedProductName}
      and (${excludeVariantId}::text is null or v.id::text <> ${excludeVariantId})
    order by v.created_at desc
    limit 6
  `) as Array<{
    variantId: string;
    productName: string;
    attributes: Record<string, string>;
    availableStock: number;
    price: unknown;
  }>;
  return rows.map((r) => ({
    variantId: r.variantId,
    productName: r.productName,
    attributes: r.attributes ?? {},
    availableStock: Number(r.availableStock ?? 0),
    price: Number(r.price ?? 0)
  }));
};

export const suggestionGeneratorWorker = new Worker<SuggestionGenerationJobV1>(
  QueueNames.suggestionGeneration,
  async (job: Job<SuggestionGenerationJobV1>) => {
    const data = job.data;

    await prisma.conversationSuggestion.updateMany({
      where: { conversationId: data.conversationId, status: "fresh" },
      data: { status: "stale" }
    });

    const [tenantKnowledge, customerHistory, matchedProduct, styleProfile] = await Promise.all([
      tenantKnowledgeService.getWithRulePack(data.tenantId),
      customerHistoryService.load(data.tenantId, data.phone),
      loadMatchedProduct(data.tenantId, data.matchedVariantId),
      ensureStyleProfile(data.tenantId)
    ]);

    const candidateVariants = await loadCandidateVariants(
      data.tenantId,
      data.matchedProductName ?? matchedProduct?.productName ?? null,
      data.matchedVariantId ?? null
    );
    const candidatePayload = candidateVariants.map((c) => ({
      variantId: c.variantId,
      productName: c.productName,
      attributes: c.attributes,
      availableStock: c.availableStock,
      price: c.price
    }));

    const incomingText =
      data.trigger === "manual_regen"
        ? await loadIncomingText(data)
        : await loadIncomingText(data);

    const ragExamples = await ragRetrievalService
      .retrieve(data.tenantId, incomingText, data.matchedProductName ?? matchedProduct?.productName ?? null)
      .catch((e) => {
        console.error("[suggestion-generator] rag retrieve failed", e);
        return [];
      });

    const llmResult = await suggestionLlm.generate({
      tenantBusinessProfile: (tenantKnowledge.profile ?? null) as Record<string, unknown> | null,
      incomingText,
      intent: data.intent ?? "desconocida",
      leadStatus: data.leadStatus ?? "frio",
      leadScore: data.leadScore ?? 0,
      matchedProduct,
      candidateVariants: candidatePayload,
      customerHistory,
      styleProfile,
      ragExamples
    });

    await prisma.conversationSuggestion.create({
      data: {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        triggerMessageId: data.triggerMessageId ?? null,
        trigger: data.trigger,
        intent: data.intent ?? null,
        leadScore: data.leadScore ?? null,
        leadStatus: data.leadStatus ?? null,
        reasoning: {
          leadStatusReasoning: llmResult.leadStatusReasoning,
          summaryForSeller: llmResult.summaryForSeller
        } as any,
        recommendedVariants: llmResult.recommendedVariants as any,
        draftReply: llmResult.draftReply,
        summaryForSeller: llmResult.summaryForSeller,
        status: "fresh",
        llmModel: llmResult.model,
        llmLatencyMs: llmResult.latencyMs,
        llmTokensIn: llmResult.tokensIn ?? null,
        llmTokensOut: llmResult.tokensOut ?? null
      }
    });
  },
  {
    connection: redisConnection,
    concurrency: Number(process.env.SUGGESTION_GENERATOR_CONCURRENCY ?? 4)
  }
);

const loadIncomingText = async (data: SuggestionGenerationJobV1): Promise<string> => {
  if (data.triggerMessageId) {
    const msg = await prisma.message.findUnique({
      where: { id: data.triggerMessageId },
      select: { message: true }
    });
    if (msg?.message) return msg.message;
  }
  const last = await prisma.message.findFirst({
    where: { tenantId: data.tenantId, phone: data.phone, direction: "incoming" },
    orderBy: { createdAt: "desc" },
    select: { message: true }
  });
  return last?.message ?? "";
};
