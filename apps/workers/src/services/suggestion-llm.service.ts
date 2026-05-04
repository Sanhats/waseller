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

export type SuggestionLlmInput = {
  tenantBusinessProfile?: Record<string, unknown> | null;
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
  model: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
};

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

    const systemPrompt = this.buildSystemPrompt(input.styleProfile, input.ragExamples);
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

      return {
        draftReply: String(parsed.draftReply ?? "").trim() || this.fallbackDraft(input),
        summaryForSeller: String(parsed.summaryForSeller ?? "").trim(),
        recommendedVariants: this.normalizeRecommendations(parsed.recommendedVariants, input),
        leadStatusReasoning: String(parsed.leadStatusReasoning ?? "").trim(),
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
    ragExamples?: RagExample[]
  ): string {
    const styleSection = this.formatStyleProfile(styleProfile);
    const ragSection = this.formatRagExamples(ragExamples);
    return [
      "Sos un copiloto de ventas para WhatsApp.",
      "NO le respondés al cliente. Le sugerís a un VENDEDOR HUMANO qué responder.",
      "El humano va a leer tu output en un panel lateral mientras atiende el chat: usá tono profesional, conciso y accionable.",
      "Tu tarea: (1) sugerir un borrador de respuesta para el humano, (2) recomendar productos/variantes específicas pertinentes, (3) explicar brevemente por qué este lead está en su status actual.",
      "Considerá la intención del cliente, el historial de mensajes, las compras anteriores del cliente (recurrencia, preferencias) y el catálogo disponible.",
      "El borrador (draftReply) debe poder enviarse tal cual: hablá en primera persona como vendedor, sin saludos genéricos vacíos, sin inventar precios/stock.",
      styleSection,
      ragSection,
      "Si falta info para responder bien (talle, color, dirección de envío), el draft debe pedirla específicamente.",
      "Si el cliente pide hablar con humano, el draft simplemente debe confirmar que ya lo está atendiendo una persona.",
      "summaryForSeller: 1-2 frases para el humano. Qué quiere el cliente y qué oportunidad ves.",
      "recommendedVariants: array (puede ser vacío) con variantId del catálogo provisto. NO inventes variantIds. Incluí razón y confianza 0-1.",
      "leadStatusReasoning: 1 frase explicando por qué el lead está en `leadStatus` (qué señales detectaste).",
      "Respondé SOLO JSON con esta forma exacta:",
      '{"draftReply":"...","summaryForSeller":"...","recommendedVariants":[{"variantId":"...","productName":"...","reason":"...","confidence":0.8}],"leadStatusReasoning":"..."}'
    ].join(" ");
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
    return {
      draftReply: this.fallbackDraft(input),
      summaryForSeller: `Cliente con intent "${input.intent}" en status ${input.leadStatus}. Sin LLM disponible — respondé manualmente.`,
      recommendedVariants: this.defaultRecommendations(input),
      leadStatusReasoning: `Status ${input.leadStatus} (score ${input.leadScore}) calculado por reglas heurísticas.`,
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
