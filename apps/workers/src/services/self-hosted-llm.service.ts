import {
  ActiveOfferV1,
  ConversationInterpretationV1,
  ConversationStageV1,
  LlmDecisionV1
} from "../../../../packages/queue/src";
import { BotTemplateService } from "./bot-template.service";

export type LlmContextInput = {
  tenantId: string;
  phone: string;
  incomingText: string;
  hintIntent?: string;
  leadStatus?: string;
  leadScore?: number;
  candidateProducts: Array<{ name: string; price: number; availableStock: number }>;
  recentMessages: Array<{ direction: "incoming" | "outgoing"; message: string }>;
  confidenceThreshold: number;
  tenantProfile?: Record<string, unknown>;
  rubroRulePack?: Record<string, unknown>;
  conversationStage?: ConversationStageV1 | null;
  activeOffer?: ActiveOfferV1 | null;
  interpretation?: ConversationInterpretationV1 | null;
  memoryFacts?: Record<string, unknown>;
};

type SelfHostedResponse = Partial<LlmDecisionV1> & {
  confidence?: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export class SelfHostedLlmService {
  private readonly endpoint = process.env.LLM_SELF_HOSTED_URL;
  private readonly model = process.env.LLM_MODEL_NAME ?? "self-hosted-default";
  private readonly openAiModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  private readonly openAiApiKey = process.env.OPENAI_API_KEY;
  private readonly timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 8000);
  private readonly templateService = new BotTemplateService();

  private parseJsonReply(raw: string): Partial<LlmDecisionV1> | null {
    const text = String(raw ?? "").trim();
    if (!text) return null;
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch?.[1]?.trim() || text;
    try {
      return JSON.parse(candidate) as Partial<LlmDecisionV1>;
    } catch {
      return null;
    }
  }

  private async fallback(context: LlmContextInput): Promise<LlmDecisionV1> {
    const product = context.candidateProducts[0];
    const normalizedInput = context.incomingText
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const interpretedIntent = context.interpretation?.intent;
    const interpretedNextAction = context.interpretation?.nextAction;
    const activeOfferProduct = context.activeOffer?.productName ?? null;
    const productName =
      (typeof context.interpretation?.entities?.productName === "string"
        ? context.interpretation.entities.productName
        : null) ??
      activeOfferProduct ??
      product?.name ??
      null;
    const reportedPaid =
      /ya pague|ya pague|pago realizado|ya transferi|te transferi|comprobante/.test(normalizedInput);
    const wantsPrice = /precio|cu[aá]nto|sale/i.test(context.incomingText);
    const asksPaymentOptions =
      /como puedo pagar|formas? de pago|medios? de pago|aceptan|se puede pagar|pago en efectivo|pagar en efectivo/.test(
        normalizedInput
      );
    const wantsDirectPaymentLink =
      /(pasame|enviame|mandame).*(link|alias)|quiero.*link|compart(i|í).*(link|alias)/.test(normalizedInput);
    const hasExplicitPurchaseIntent = /compr(ar|o)|reserv(a|o)|apartar|me lo llevo|me la llevo/.test(normalizedInput);
    const wantsBuy = hasExplicitPurchaseIntent || wantsDirectPaymentLink;
    const wantsCashPayment = /(efectivo|contado|cash)/.test(normalizedInput);
    const intent = interpretedIntent
      ? interpretedIntent
      : reportedPaid
      ? "reportar_pago"
      : wantsBuy
        ? "confirmar_compra"
        : wantsPrice
          ? "consultar_precio"
          : context.hintIntent ?? "buscar_producto";
    const leadStage = reportedPaid || wantsBuy ? "decision" : wantsPrice ? "consideration" : "discovery";
    const confidence = reportedPaid || wantsBuy || wantsPrice || asksPaymentOptions ? 0.78 : 0.64;
    const draftReply = (product || productName)
      ? reportedPaid
        ? await this.templateService.render(context.tenantId, "payment_report_received", {
            product_name: productName ?? product?.name ?? "tu producto"
          })
        : wantsCashPayment
        ? await this.templateService.render(context.tenantId, "payment_cash_available", {
            product_name: productName ?? product?.name ?? "tu producto"
          })
        : asksPaymentOptions
        ? await this.templateService.render(context.tenantId, "payment_options_overview", {
            product_name: productName ?? product?.name ?? "tu producto",
            price: product?.price ?? context.activeOffer?.price ?? 0
          })
        : wantsBuy
        ? await this.templateService.render(context.tenantId, "payment_link_offer", {
            product_name: productName ?? product?.name ?? "tu producto",
            price: product?.price ?? context.activeOffer?.price ?? 0
          })
        : await this.templateService.render(context.tenantId, "stock_offer", {
            product_name: productName ?? product?.name ?? "tu producto",
            price: product?.price ?? context.activeOffer?.price ?? 0,
            available_stock: product?.availableStock ?? context.activeOffer?.availableStock ?? 0
          })
      : await this.templateService.getTemplate(context.tenantId, "no_product_prompt");
    const nextAction: LlmDecisionV1["nextAction"] = interpretedNextAction
      ? interpretedNextAction
      : reportedPaid
      ? "manual_review"
      : wantsCashPayment
        ? "manual_review"
      : asksPaymentOptions
        ? "offer_reservation"
      : wantsBuy
        ? "share_payment_link"
        : wantsPrice
          ? "offer_reservation"
          : "ask_clarification";
    const reason = reportedPaid
      ? "cliente_reporta_pago"
      : wantsCashPayment
      ? "cliente_prefiere_pago_efectivo"
      : asksPaymentOptions
      ? "cliente_consulta_medios_de_pago"
      : wantsBuy
      ? "cliente_con_intencion_de_compra"
      : wantsPrice
        ? "cliente_pregunta_precio"
        : "falta_contexto_producto";
    return {
      intent,
      leadStage,
      confidence,
      entities: productName ? { productName } : {},
      nextAction,
      reason,
      requiresHuman: confidence < context.confidenceThreshold,
      policyBand: confidence >= 0.8 ? "high" : confidence >= 0.6 ? "medium" : "low",
      executionMode: "active",
      recommendedAction: reportedPaid
        ? "manual_payment_confirmation"
        : wantsBuy
          ? "share_payment_link"
          : asksPaymentOptions
            ? "offer_payment_options"
            : "qualify_need",
      draftReply,
      handoffRequired: confidence < context.confidenceThreshold,
      qualityFlags: [],
      source: "fallback",
      provider: "rules",
      model: this.model
    };
  }

  private async decideWithOpenAI(context: LlmContextInput): Promise<LlmDecisionV1> {
    const fallback = await this.fallback(context);
    if (!this.openAiApiKey) return fallback;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const systemPrompt = [
        "Sos un asistente comercial para WhatsApp en e-commerce.",
        "Debes responder con JSON valido y sin texto extra.",
        "No inventes datos. Usa el contexto del tenant y de productos.",
        "Si falta informacion critica, usa ask_clarification.",
        "Campos requeridos: intent, leadStage, confidence, entities, nextAction, reason, requiresHuman, recommendedAction, draftReply, handoffRequired, qualityFlags.",
        "nextAction permitido: reply_only|ask_clarification|offer_reservation|reserve_stock|share_payment_link|handoff_human|close_lead|manual_review.",
        "Si recentMessages incluye un mensaje outgoing previo y el incomingText es una pregunta de seguimiento distinta (ej. otro color, otra variante), NO repitas el mismo draftReply ni parafrasees sin aportar informacion nueva: responde a la pregunta nueva usando el hilo."
      ].join(" ");
      const userPayload = {
        incomingText: context.incomingText,
        hintIntent: context.hintIntent,
        conversationStage: context.conversationStage,
        activeOffer: context.activeOffer ?? null,
        interpretation: context.interpretation ?? null,
        memoryFacts: context.memoryFacts ?? {},
        leadStatus: context.leadStatus,
        leadScore: context.leadScore,
        candidateProducts: context.candidateProducts,
        recentMessages: context.recentMessages,
        tenantProfile: context.tenantProfile ?? {},
        rubroRulePack: context.rubroRulePack ?? {}
      };
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.openAiApiKey}`
        },
        body: JSON.stringify({
          model: this.openAiModel,
          temperature: 0.2,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(userPayload) }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) return fallback;
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = String(body.choices?.[0]?.message?.content ?? "");
      const parsed = this.parseJsonReply(content);
      if (!parsed) return fallback;
      return {
        ...fallback,
        ...parsed,
        confidence: clamp(Number(parsed.confidence ?? fallback.confidence), 0, 1),
        entities: typeof parsed.entities === "object" && parsed.entities ? parsed.entities : fallback.entities,
        qualityFlags: Array.isArray(parsed.qualityFlags)
          ? parsed.qualityFlags.map((x) => String(x))
          : fallback.qualityFlags,
        nextAction: (parsed.nextAction as LlmDecisionV1["nextAction"]) ?? fallback.nextAction,
        reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : fallback.reason,
        requiresHuman:
          typeof parsed.requiresHuman === "boolean"
            ? parsed.requiresHuman
            : clamp(Number(parsed.confidence ?? fallback.confidence), 0, 1) < context.confidenceThreshold,
        policyBand:
          (parsed.policyBand as "high" | "medium" | "low" | undefined) ??
          (clamp(Number(parsed.confidence ?? fallback.confidence), 0, 1) >= 0.8
            ? "high"
            : clamp(Number(parsed.confidence ?? fallback.confidence), 0, 1) >= 0.6
              ? "medium"
              : "low"),
        source: "llm",
        provider: "openai",
        model: this.openAiModel
      };
    } catch {
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  async decide(context: LlmContextInput): Promise<LlmDecisionV1> {
    if (!this.endpoint && this.openAiApiKey) {
      return this.decideWithOpenAI(context);
    }
    if (!this.endpoint) {
      return this.fallback(context);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          mode: "assistive_sales",
          input: context.incomingText,
          context
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        return this.fallback(context);
      }
      const data = (await response.json()) as SelfHostedResponse;
      const fallback = await this.fallback(context);
      return {
        ...fallback,
        ...data,
        confidence: clamp(Number(data.confidence ?? fallback.confidence), 0, 1),
        entities: typeof data.entities === "object" && data.entities ? data.entities : fallback.entities,
        qualityFlags: Array.isArray(data.qualityFlags) ? data.qualityFlags.map((x) => String(x)) : fallback.qualityFlags,
        nextAction: (data.nextAction as LlmDecisionV1["nextAction"]) ?? fallback.nextAction,
        reason: typeof data.reason === "string" && data.reason.trim() ? data.reason.trim() : fallback.reason,
        requiresHuman:
          typeof data.requiresHuman === "boolean"
            ? data.requiresHuman
            : clamp(Number(data.confidence ?? fallback.confidence), 0, 1) < context.confidenceThreshold,
        policyBand:
          (data.policyBand as "high" | "medium" | "low" | undefined) ??
          (clamp(Number(data.confidence ?? fallback.confidence), 0, 1) >= 0.8
            ? "high"
            : clamp(Number(data.confidence ?? fallback.confidence), 0, 1) >= 0.6
              ? "medium"
              : "low"),
        source: "llm",
        provider: "self-hosted",
        model: this.model
      };
    } catch {
      return this.fallback(context);
    } finally {
      clearTimeout(timeout);
    }
  }
}
