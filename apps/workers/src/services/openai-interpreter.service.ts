import {
  ActiveOfferV1,
  ConversationInterpretationV1,
  ConversationNextActionV1,
  ConversationStageV1
} from "../../../../packages/queue/src";
import {
  buildActiveOfferSnapshot,
  normalizeConversationText,
  resolveExpectedCustomerAction,
  resolveStageFromContext
} from "./conversation-policy.service";

type InterpreterInput = {
  incomingText: string;
  hintIntent?: string;
  conversationStage?: ConversationStageV1 | null;
  activeOffer?: ActiveOfferV1 | null;
  tenantProfile?: Record<string, unknown>;
  rubroRulePack?: Record<string, unknown>;
  recentMessages?: Array<{ direction: "incoming" | "outgoing"; message: string }>;
  candidateProducts?: Array<{ name: string; price: number; availableStock: number }>;
  ruleInterpretation?: ConversationInterpretationV1 | null;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export class OpenAiInterpreterService {
  private readonly openAiModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  private readonly openAiApiKey = process.env.OPENAI_API_KEY;
  private readonly timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 8000);

  private parseJsonReply(raw: string): Partial<ConversationInterpretationV1> | null {
    const text = String(raw ?? "").trim();
    if (!text) return null;
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch?.[1]?.trim() || text;
    try {
      return JSON.parse(candidate) as Partial<ConversationInterpretationV1>;
    } catch {
      return null;
    }
  }

  private fallback(input: InterpreterInput): ConversationInterpretationV1 {
    const normalizedInput = normalizeConversationText(input.incomingText);
    const activeOffer = input.activeOffer ?? null;
    const candidateProduct = input.candidateProducts?.[0];
    const baseIntent = input.ruleInterpretation?.intent ?? input.hintIntent ?? "desconocida";
    const references = input.ruleInterpretation?.references ?? [];
    const entities = {
      ...(input.ruleInterpretation?.entities ?? {}),
      productName:
        (input.ruleInterpretation?.entities?.productName as string | undefined) ??
        activeOffer?.productName ??
        candidateProduct?.name ??
        null,
      variantId: (input.ruleInterpretation?.entities?.variantId as string | undefined) ?? activeOffer?.variantId ?? null
    };

    let nextAction: ConversationNextActionV1 = input.ruleInterpretation?.nextAction ?? "ask_clarification";
    if (/link de pago|pasame el link|enviame el link|mandame el link/.test(normalizedInput)) {
      nextAction = "share_payment_link";
    } else if (/si|sí|dale|de una|perfecto|me sirve|voy con esa/.test(normalizedInput)) {
      nextAction =
        input.conversationStage === "waiting_reservation_confirmation" ? "reserve_stock" : nextAction;
    } else if (/otra|alternativa|otra opcion|otra opción/.test(normalizedInput)) {
      nextAction = "suggest_alternative";
    } else if (/talle|color|blanca|negra|roja/.test(normalizedInput)) {
      nextAction = "confirm_variant";
    }

    const stage = resolveStageFromContext({
      previousStage: input.conversationStage,
      intent: baseIntent,
      hasVariant: Boolean(entities.variantId),
      missingAxes: input.ruleInterpretation?.missingFields ?? [],
      hasReservation: input.conversationStage === "reserved_waiting_payment_method",
      paymentLinkSent: input.conversationStage === "payment_link_sent",
      paymentApproved: input.conversationStage === "sale_confirmed"
    });

    return {
      intent: baseIntent,
      confidence: clamp(Number(input.ruleInterpretation?.confidence ?? 0.72), 0, 1),
      entities,
      references,
      conversationStage: stage,
      missingFields: input.ruleInterpretation?.missingFields ?? [],
      nextAction,
      source: "rules",
      notes: [resolveExpectedCustomerAction(stage) ?? "unknown_expected_action"]
    };
  }

  async interpret(input: InterpreterInput): Promise<ConversationInterpretationV1> {
    const fallback = this.fallback(input);
    if (!this.openAiApiKey) return fallback;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const systemPrompt = [
        "Sos un interprete estructurado de conversaciones comerciales de WhatsApp.",
        "Debes responder SOLO JSON valido y sin texto extra.",
        "No inventes stock, pagos ni politicas.",
        "Tu tarea es interpretar intencion, referencias, entidades y siguiente accion conversacional.",
        "Usa un nextAction controlado entre: reply_only, ask_clarification, confirm_variant, offer_reservation, reserve_stock, share_payment_link, suggest_alternative, handoff_human, close_lead, manual_review.",
        "Si el cliente usa referencias cortas como 'esa', 'la otra', 'si', 'dale', usa activeOffer y conversationStage.",
        "Devuelve: intent, confidence, entities, references, conversationStage, missingFields, nextAction, notes."
      ].join(" ");

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.openAiApiKey}`
        },
        body: JSON.stringify({
          model: this.openAiModel,
          temperature: 0.1,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                incomingText: input.incomingText,
                hintIntent: input.hintIntent,
                conversationStage: input.conversationStage,
                activeOffer: buildActiveOfferSnapshot({
                  existing: input.activeOffer ?? null,
                  expectedCustomerAction: resolveExpectedCustomerAction(input.conversationStage)
                }),
                tenantProfile: input.tenantProfile ?? {},
                rubroRulePack: input.rubroRulePack ?? {},
                recentMessages: input.recentMessages ?? [],
                candidateProducts: input.candidateProducts ?? [],
                ruleInterpretation: input.ruleInterpretation ?? null
              })
            }
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
        references: Array.isArray(parsed.references) ? parsed.references : fallback.references,
        conversationStage:
          (parsed.conversationStage as ConversationStageV1 | undefined) ?? fallback.conversationStage,
        missingFields: Array.isArray(parsed.missingFields)
          ? parsed.missingFields.map((item) => String(item))
          : fallback.missingFields,
        nextAction: (parsed.nextAction as ConversationNextActionV1 | undefined) ?? fallback.nextAction,
        source: "openai",
        notes: Array.isArray(parsed.notes) ? parsed.notes.map((item) => String(item)) : fallback.notes
      };
    } catch {
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }
}
