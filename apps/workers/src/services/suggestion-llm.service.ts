import type { CustomerHistorySnapshot } from "./customer-history.service";
import type { RagExample } from "./rag-retrieval.service";
import type { StyleProfile } from "./style-profile.service";

export type RecommendedVariant = {
  variantId: string;
  productName: string;
  attributes?: Record<string, string>;
  reason: string;
  confidence: number;
};

export const NEXT_SELLER_ACTIONS = [
  "send_payment_link",
  "request_missing_info",
  "confirm_stock_and_reserve",
  "offer_alternative",
  "share_catalog_link",
  "schedule_followup",
  "mark_cold",
  "escalate_human",
  "close_won",
  "close_lost",
  "no_action"
] as const;
export type NextSellerAction = (typeof NEXT_SELLER_ACTIONS)[number];

export const ACTION_URGENCIES = ["now", "today", "this_week", "low"] as const;
export type ActionUrgency = (typeof ACTION_URGENCIES)[number];

export type CommercialPolicies = {
  maxDiscountPercent?: number;
  discountRequiresApprovalAbovePercent?: number;
  outOfStockPolicy?: "offer_alternative" | "waitlist" | "decline" | "backorder";
  coldLeadFollowUpHours?: number;
  warmLeadFollowUpHours?: number;
  escalationKeywords?: string[];
  businessHours?: string;
  notes?: string;
};

export type SuggestionLlmInput = {
  tenantBusinessProfile?: Record<string, unknown> | null;
  commercialPolicies?: CommercialPolicies | null;
  incomingText: string;
  intent: string;
  leadStatus: string;
  leadScore: number;
  matchedProduct?: {
    productName: string;
    variantId: string | null;
    attributes: Record<string, string>;
    availableStock?: number | null;
    price?: number | null;
  } | null;
  candidateVariants?: Array<{
    variantId: string;
    productName: string;
    attributes: Record<string, string>;
    availableStock: number;
    price: number;
  }>;
  customerHistory: CustomerHistorySnapshot;
  styleProfile?: StyleProfile | null;
  ragExamples?: RagExample[];
};

export type SuggestionLlmOutput = {
  draftReply: string;
  summaryForSeller: string;
  recommendedVariants: RecommendedVariant[];
  leadStatusReasoning: string;
  nextSellerAction: NextSellerAction;
  actionReason: string;
  actionUrgency: ActionUrgency;
  suggestedLeadStatus: string | null;
  model: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
};

const LEAD_STATUS_VALUES = new Set([
  "frio",
  "consulta",
  "interesado",
  "caliente",
  "listo_para_cobrar",
  "vendido",
  "cerrado"
]);

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

export class SuggestionLlmService {
  private readonly openAiModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  private readonly openAiApiKey = process.env.OPENAI_API_KEY;
  private readonly timeoutMs = Number(process.env.SUGGESTION_LLM_TIMEOUT_MS ?? 12000);

  async generate(input: SuggestionLlmInput): Promise<SuggestionLlmOutput> {
    const start = Date.now();
    if (!this.openAiApiKey) {
      return this.fallback(input, Date.now() - start);
    }

    const systemPrompt = this.buildSystemPrompt(
      input.styleProfile,
      input.ragExamples,
      input.commercialPolicies ?? null
    );
    const userPayload = this.buildUserPayload(input);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.openAiApiKey}`
        },
        body: JSON.stringify({
          model: this.openAiModel,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(userPayload) }
          ]
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        return this.fallback(input, Date.now() - start);
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = String(body.choices?.[0]?.message?.content ?? "").trim();
      if (!content) return this.fallback(input, Date.now() - start);

      const parsed = this.parseJson(content);
      if (!parsed) return this.fallback(input, Date.now() - start);

      const action = this.normalizeAction(parsed.nextSellerAction, input);
      return {
        draftReply: String(parsed.draftReply ?? "").trim() || this.fallbackDraft(input),
        summaryForSeller: String(parsed.summaryForSeller ?? "").trim(),
        recommendedVariants: this.normalizeRecommendations(parsed.recommendedVariants, input),
        leadStatusReasoning: String(parsed.leadStatusReasoning ?? "").trim(),
        nextSellerAction: action,
        actionReason: String(parsed.actionReason ?? "").trim() || this.defaultActionReason(action),
        actionUrgency: this.normalizeUrgency(parsed.actionUrgency, action),
        suggestedLeadStatus: this.normalizeSuggestedLeadStatus(parsed.suggestedLeadStatus, input),
        model: this.openAiModel,
        latencyMs: Date.now() - start,
        tokensIn: body.usage?.prompt_tokens,
        tokensOut: body.usage?.completion_tokens
      };
    } catch {
      return this.fallback(input, Date.now() - start);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildSystemPrompt(
    styleProfile?: StyleProfile | null,
    ragExamples?: RagExample[],
    policies?: CommercialPolicies | null
  ): string {
    const styleSection = this.formatStyleProfile(styleProfile);
    const ragSection = this.formatRagExamples(ragExamples);
    const policySection = this.formatPolicies(policies ?? null);
    return [
      "Sos un copiloto de ventas para WhatsApp.",
      "NO le respondés al cliente. Le sugerís a un VENDEDOR HUMANO qué responder y QUÉ HACER con este lead dentro del CRM.",
      "El humano va a leer tu output en un panel lateral mientras atiende el chat: usá tono profesional, conciso y accionable.",
      "Tu tarea: (1) sugerir un borrador de respuesta para el humano, (2) recomendar productos/variantes pertinentes, (3) explicar brevemente por qué este lead está en su status actual, (4) decidir la PRÓXIMA ACCIÓN concreta del vendedor sobre este lead.",
      "Considerá la intención del cliente, el historial de mensajes, las compras anteriores, el catálogo disponible Y las políticas comerciales del negocio.",
      "El borrador (draftReply) debe poder enviarse tal cual: hablá en primera persona como vendedor, sin saludos genéricos vacíos, sin inventar precios/stock.",
      styleSection,
      policySection,
      ragSection,
      "Si falta info para responder bien (talle, color, dirección de envío), el draft debe pedirla específicamente.",
      "Si el cliente pide hablar con humano, el draft simplemente debe confirmar que ya lo está atendiendo una persona.",
      "summaryForSeller: 1-2 frases para el humano. Qué quiere el cliente y qué oportunidad ves.",
      "recommendedVariants: array (puede ser vacío) con variantId del catálogo provisto. NO inventes variantIds. Incluí razón y confianza 0-1.",
      "leadStatusReasoning: 1 frase explicando por qué el lead está en `leadStatus` (qué señales detectaste).",
      "",
      "CAMPO `nextSellerAction` (OBLIGATORIO, elegí UNO de este enum cerrado):",
      "- send_payment_link: el cliente ya decidió comprar / dijo 'lo llevo' / pidió pagar; mandale link de Mercado Pago YA.",
      "- request_missing_info: hace falta talle/color/dirección/cantidad antes de avanzar; el draft debe pedirlo.",
      "- confirm_stock_and_reserve: pidió un producto que está en stock; reservalo y confirmá disponibilidad.",
      "- offer_alternative: pidió algo SIN stock; ofrecele variante similar disponible (respetá outOfStockPolicy del negocio).",
      "- share_catalog_link: consulta amplia/exploratoria; mejor mandarle el link al catálogo público que listar todo en chat.",
      "- schedule_followup: se enfrió o no respondió; agendá recordatorio según followUpHours del negocio.",
      "- mark_cold: sin señales de compra después de varios turnos; bajar prioridad y archivar de la bandeja activa.",
      "- escalate_human: queja, devolución, problema de pago, pedido fuera de catálogo, o cliente pidió humano explícitamente.",
      "- close_won: cobro confirmado / venta cerrada; mover lead a 'vendido'.",
      "- close_lost: el cliente dijo que no, o el deal murió; mover a 'cerrado'.",
      "- no_action: la pelota está del lado del cliente y no hay nada que hacer ahora; esperá su respuesta.",
      "",
      "CAMPO `actionUrgency` (OBLIGATORIO, uno de): now | today | this_week | low.",
      "- now: el lead se enfría si no actuás en minutos (cliente esperando respuesta, listo para pagar).",
      "- today: hay que tocarlo antes de que termine el día (consultas calientes).",
      "- this_week: follow-up programable (lead tibio, cliente que dijo 'lo pienso').",
      "- low: no urgente / archivar.",
      "",
      "CAMPO `actionReason` (OBLIGATORIO): 1 frase corta justificando la acción elegida (señales concretas del chat o políticas que se aplican).",
      "",
      "CAMPO `suggestedLeadStatus` (OPCIONAL, null si no cambia): si la acción implica mover el lead, devolvé el nuevo status. Valores: frio | consulta | interesado | caliente | listo_para_cobrar | vendido | cerrado.",
      "",
      "Respondé SOLO JSON con esta forma exacta:",
      '{"draftReply":"...","summaryForSeller":"...","recommendedVariants":[{"variantId":"...","productName":"...","reason":"...","confidence":0.8}],"leadStatusReasoning":"...","nextSellerAction":"send_payment_link","actionReason":"...","actionUrgency":"now","suggestedLeadStatus":"listo_para_cobrar"}'
    ]
      .filter((s) => s.length > 0)
      .join(" ");
  }

  private formatPolicies(policies: CommercialPolicies | null): string {
    if (!policies) return "";
    const lines: string[] = ["POLÍTICAS COMERCIALES DEL NEGOCIO (respetalas al recomendar acciones):"];
    if (typeof policies.maxDiscountPercent === "number") {
      lines.push(`- Descuento máximo sin aprobación: ${policies.maxDiscountPercent}%.`);
    }
    if (typeof policies.discountRequiresApprovalAbovePercent === "number") {
      lines.push(
        `- Sobre ${policies.discountRequiresApprovalAbovePercent}% de descuento, requerí aprobación (sugerí escalate_human).`
      );
    }
    if (policies.outOfStockPolicy) {
      const map: Record<string, string> = {
        offer_alternative: "ofrecé variante alternativa disponible (offer_alternative).",
        waitlist: "ofrecé anotarlo en lista de espera; no prometas fecha.",
        decline: "informá que no hay y NO ofrezcas alternativa salvo que el cliente pregunte.",
        backorder: "aceptá pedido bajo encargue, aclarando plazo."
      };
      lines.push(`- Sin stock: ${map[policies.outOfStockPolicy]}`);
    }
    if (typeof policies.coldLeadFollowUpHours === "number") {
      lines.push(
        `- Lead frío/consulta sin respuesta: hacer follow-up tras ${policies.coldLeadFollowUpHours}h.`
      );
    }
    if (typeof policies.warmLeadFollowUpHours === "number") {
      lines.push(
        `- Lead interesado/caliente sin respuesta: hacer follow-up tras ${policies.warmLeadFollowUpHours}h.`
      );
    }
    if (policies.escalationKeywords && policies.escalationKeywords.length > 0) {
      lines.push(
        `- Si el cliente menciona: ${policies.escalationKeywords.map((k) => `"${k}"`).join(", ")} → nextSellerAction = escalate_human.`
      );
    }
    if (policies.businessHours) {
      lines.push(`- Horario de atención: ${policies.businessHours}.`);
    }
    if (policies.notes) {
      lines.push(`- Notas: ${policies.notes}`);
    }
    return lines.join(" ");
  }

  private formatRagExamples(examples?: RagExample[]): string {
    if (!examples || examples.length === 0) return "";
    const lines: string[] = [
      "EJEMPLOS DE VENTAS QUE CERRARON (turnos similares de conversaciones que terminaron en venta — usalos como referencia de tono y estructura, NO los copies palabra por palabra):"
    ];
    for (const ex of examples.slice(0, 5)) {
      const inText = ex.incomingText.replace(/\s+/g, " ").slice(0, 240);
      const outText = ex.outgoingText.replace(/\s+/g, " ").slice(0, 320);
      lines.push(`- Cliente dijo: "${inText}" → Vendedor respondió: "${outText}"`);
    }
    return lines.join(" ");
  }

  private formatStyleProfile(profile?: StyleProfile | null): string {
    if (!profile || profile.sampleCount < 5) {
      return "Tono neutral, profesional y cercano (estilo argentino estándar).";
    }
    const parts: string[] = [
      "ESTILO DEL VENDEDOR (basado en sus mensajes reales — imitá este tono):"
    ];
    if (profile.formality !== "unknown") {
      const formalLabel =
        profile.formality === "voseo"
          ? "voseo argentino (tenés/querés/sos)"
          : profile.formality === "tuteo"
            ? "tuteo (tienes/quieres)"
            : profile.formality === "usted"
              ? "usted (formal)"
              : "mixto";
      parts.push(`- Tratamiento: ${formalLabel}.`);
    }
    parts.push(`- Largo medio: ~${profile.avgLength} caracteres.`);
    if (profile.emojiDensity > 0.3) {
      parts.push(
        `- Usa emojis (densidad ${profile.emojiDensity}/100 chars). Frecuentes: ${profile.topEmojis.join(" ")}.`
      );
    } else {
      parts.push("- Casi no usa emojis.");
    }
    if (profile.topGreetings.length > 0) {
      parts.push(`- Aperturas típicas: "${profile.topGreetings.join('", "')}".`);
    }
    if (profile.topClosings.length > 0) {
      parts.push(`- Cierres típicos: "${profile.topClosings.join('", "')}".`);
    }
    if (profile.catchphrases.length > 0) {
      parts.push(`- Frases recurrentes: "${profile.catchphrases.join('", "')}".`);
    }
    if (profile.usesAbbreviations) {
      parts.push("- Usa abreviaturas (q, xq, tb, etc.) — está OK usarlas.");
    } else {
      parts.push("- Escribe palabras completas, sin abreviaturas tipo 'xq'.");
    }
    return parts.join(" ");
  }

  private buildUserPayload(input: SuggestionLlmInput): Record<string, unknown> {
    return {
      tenantBusinessProfile: input.tenantBusinessProfile ?? null,
      commercialPolicies: input.commercialPolicies ?? null,
      incomingText: input.incomingText,
      detectedIntent: input.intent,
      leadStatus: input.leadStatus,
      leadScore: input.leadScore,
      matchedProduct: input.matchedProduct ?? null,
      candidateVariants: input.candidateVariants ?? [],
      conversationHistory: input.customerHistory.recentMessages,
      customerPastOrders: input.customerHistory.pastOrders,
      customerPreviousLeadStatuses: input.customerHistory.previousLeadStatuses
    };
  }

  private parseJson(raw: string): Record<string, unknown> | null {
    try {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = fenced?.[1]?.trim() || raw;
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private normalizeAction(raw: unknown, input: SuggestionLlmInput): NextSellerAction {
    const value = String(raw ?? "").trim();
    if ((NEXT_SELLER_ACTIONS as readonly string[]).includes(value)) {
      return value as NextSellerAction;
    }
    return this.fallbackAction(input);
  }

  private normalizeUrgency(raw: unknown, action: NextSellerAction): ActionUrgency {
    const value = String(raw ?? "").trim();
    if ((ACTION_URGENCIES as readonly string[]).includes(value)) {
      return value as ActionUrgency;
    }
    return this.defaultUrgency(action);
  }

  private normalizeSuggestedLeadStatus(raw: unknown, input: SuggestionLlmInput): string | null {
    const value = String(raw ?? "").trim();
    if (!value || value === "null") return null;
    if (!LEAD_STATUS_VALUES.has(value)) return null;
    if (value === input.leadStatus) return null;
    return value;
  }

  private fallbackAction(input: SuggestionLlmInput): NextSellerAction {
    if (input.leadScore >= 120) return "send_payment_link";
    if (input.leadScore >= 80 && input.matchedProduct?.variantId) return "confirm_stock_and_reserve";
    if (input.intent === "pedir_asesor") return "escalate_human";
    if (input.matchedProduct && (input.matchedProduct.availableStock ?? 0) <= 0) return "offer_alternative";
    if (input.intent === "buscar_producto" && !input.matchedProduct) return "share_catalog_link";
    if (input.leadStatus === "frio" || input.leadStatus === "consulta") return "schedule_followup";
    return "no_action";
  }

  private defaultUrgency(action: NextSellerAction): ActionUrgency {
    switch (action) {
      case "send_payment_link":
      case "escalate_human":
      case "confirm_stock_and_reserve":
        return "now";
      case "request_missing_info":
      case "offer_alternative":
      case "close_won":
        return "today";
      case "schedule_followup":
      case "share_catalog_link":
        return "this_week";
      default:
        return "low";
    }
  }

  private defaultActionReason(action: NextSellerAction): string {
    const map: Record<NextSellerAction, string> = {
      send_payment_link: "Lead listo para cobrar según score y señales de compra.",
      request_missing_info: "Falta información clave para avanzar.",
      confirm_stock_and_reserve: "Producto identificado con stock disponible.",
      offer_alternative: "Producto sin stock; ofrecer alternativa disponible.",
      share_catalog_link: "Consulta amplia; mejor derivar al catálogo público.",
      schedule_followup: "Sin respuesta del cliente; programar recordatorio.",
      mark_cold: "Sin señales de compra tras múltiples interacciones.",
      escalate_human: "Caso fuera del flujo automatizable o cliente lo pidió.",
      close_won: "Cobro confirmado; cerrar como venta.",
      close_lost: "Cliente descartó la compra explícitamente.",
      no_action: "Esperando respuesta del cliente."
    };
    return map[action];
  }

  private normalizeRecommendations(
    raw: unknown,
    input: SuggestionLlmInput
  ): RecommendedVariant[] {
    if (!Array.isArray(raw)) return this.defaultRecommendations(input);
    const validIds = new Set<string>();
    if (input.matchedProduct?.variantId) validIds.add(input.matchedProduct.variantId);
    for (const c of input.candidateVariants ?? []) validIds.add(c.variantId);

    const result: RecommendedVariant[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const variantId = String(obj.variantId ?? "").trim();
      if (!variantId || !validIds.has(variantId)) continue;
      result.push({
        variantId,
        productName: String(obj.productName ?? "").trim() || "Producto",
        attributes: typeof obj.attributes === "object" && obj.attributes ? (obj.attributes as Record<string, string>) : undefined,
        reason: String(obj.reason ?? "").trim(),
        confidence: clampNumber(obj.confidence, 0, 1, 0.6)
      });
    }
    return result.length > 0 ? result : this.defaultRecommendations(input);
  }

  private defaultRecommendations(input: SuggestionLlmInput): RecommendedVariant[] {
    if (input.matchedProduct?.variantId) {
      return [
        {
          variantId: input.matchedProduct.variantId,
          productName: input.matchedProduct.productName,
          attributes: input.matchedProduct.attributes,
          reason: "Match directo del matcher por keywords del mensaje.",
          confidence: 0.65
        }
      ];
    }
    return [];
  }

  private fallback(input: SuggestionLlmInput, latencyMs: number): SuggestionLlmOutput {
    const action = this.fallbackAction(input);
    return {
      draftReply: this.fallbackDraft(input),
      summaryForSeller: `Cliente con intent "${input.intent}" en status ${input.leadStatus}. Sin LLM disponible — respondé manualmente.`,
      recommendedVariants: this.defaultRecommendations(input),
      leadStatusReasoning: `Status ${input.leadStatus} (score ${input.leadScore}) calculado por reglas heurísticas.`,
      nextSellerAction: action,
      actionReason: this.defaultActionReason(action),
      actionUrgency: this.defaultUrgency(action),
      suggestedLeadStatus: null,
      model: "fallback",
      latencyMs
    };
  }

  private fallbackDraft(input: SuggestionLlmInput): string {
    if (input.matchedProduct?.productName) {
      return `Hola! Tenemos ${input.matchedProduct.productName}. ¿Querés que te pase más detalles?`;
    }
    if (input.intent === "consultar_precio") return "Hola, decime qué producto te interesa y te paso el precio.";
    if (input.intent === "buscar_producto") return "Hola, contame qué estás buscando y te confirmo si lo tenemos.";
    if (input.intent === "pedir_asesor") return "Hola! Te estoy atendiendo en este momento, contame qué necesitás.";
    return "Hola! ¿En qué puedo ayudarte?";
  }
}
