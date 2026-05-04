/**
 * Generador de conversaciones sintéticas de venta WhatsApp en español argentino,
 * orientado a indumentaria y calzado. Usa GPT-4 con prompts estructurados que
 * cubren los escenarios típicos del rubro.
 *
 * Output: una conversación con turnos cliente/vendedor que termina en venta
 * (o muy cerca). Se inyecta luego al RAG como `source=synthetic`.
 */

export type Segment = "mujer" | "hombre" | "unisex" | "ninos";

export type Scenario =
  | "consulta_precio"
  | "consulta_talle"
  | "consulta_color"
  | "consulta_stock"
  | "consulta_envio"
  | "retiro_local"
  | "duda_talle_recomendacion"
  | "alternativa_sin_stock"
  | "combinar_productos"
  | "regalo"
  | "consulta_cuotas"
  | "negociacion_precio";

export type Tone = "casual_emojis" | "casual_sin_emojis" | "profesional";

export type SyntheticTurn = {
  speaker: "cliente" | "vendedor";
  text: string;
};

export type SyntheticConversation = {
  segment: Segment;
  scenario: Scenario;
  tone: Tone;
  category: string;
  productName: string;
  turns: SyntheticTurn[];
};

const CATEGORIES: Record<Segment, string[]> = {
  mujer: [
    "vestido",
    "pollera",
    "jean",
    "remera",
    "camisa",
    "campera",
    "buzo",
    "zapatillas",
    "sandalias",
    "botas",
    "conjunto deportivo",
    "calza",
    "top",
    "blazer"
  ],
  hombre: [
    "jean",
    "remera",
    "camisa",
    "pantalón",
    "buzo",
    "campera",
    "zapatillas",
    "mocasines",
    "botines",
    "conjunto deportivo",
    "polo",
    "bermuda"
  ],
  unisex: [
    "zapatillas",
    "remera oversize",
    "hoodie",
    "gorra",
    "buzo",
    "riñonera",
    "ojotas"
  ],
  ninos: [
    "conjunto deportivo",
    "remera",
    "jean",
    "pantalón jogger",
    "campera",
    "vestido",
    "zapatillas",
    "ojotas",
    "ropa de bebé",
    "buzo escolar"
  ]
};

const SCENARIO_HINTS: Record<Scenario, string> = {
  consulta_precio:
    "El cliente pregunta precio. El vendedor confirma precio + ofrece formas de pago + invita a confirmar.",
  consulta_talle:
    "El cliente pregunta qué talles hay. El vendedor enumera disponibles y pregunta cuál necesita.",
  consulta_color:
    "El cliente pregunta colores disponibles. El vendedor enumera y eventualmente sugiere uno.",
  consulta_stock:
    "El cliente pregunta si hay stock de un talle/color específico. El vendedor confirma o avisa pocas unidades para crear urgencia honesta.",
  consulta_envio:
    "El cliente pregunta por envío. El vendedor explica zonas + costo + tiempo + ofrece coordinarlo.",
  retiro_local:
    "El cliente quiere pasar a buscar. El vendedor da dirección, horarios y reserva el producto.",
  duda_talle_recomendacion:
    "El cliente da sus medidas o talle habitual y pide recomendación. El vendedor sugiere talle con criterio.",
  alternativa_sin_stock:
    "El producto que pidió no está. El vendedor ofrece una alternativa similar (color o modelo) y rescata la venta.",
  combinar_productos:
    "El cliente arma un outfit / combo. El vendedor sugiere prendas que combinen y arma un total.",
  regalo:
    "El cliente está comprando para regalar. El vendedor pregunta talle/preferencias del agasajado y orienta.",
  consulta_cuotas:
    "El cliente pregunta por cuotas. El vendedor explica medios de pago disponibles (transferencia, tarjeta con/sin interés, MP).",
  negociacion_precio:
    "El cliente intenta regatear o pide descuento. El vendedor mantiene precio o ofrece pequeño beneficio (envío bonificado, descuento mínimo)."
};

const TONE_HINTS: Record<Tone, string> = {
  casual_emojis:
    "Tono casual, voseo argentino, con uso moderado de emojis (😊 ✨ 🛍️ 👟). El vendedor tutea cercano sin caer en exceso.",
  casual_sin_emojis:
    "Tono casual, voseo argentino, sin emojis. Mensajes cortos y directos.",
  profesional:
    "Tono profesional pero cercano, voseo argentino, sin emojis o con uno muy puntual."
};

const SEGMENT_LABEL: Record<Segment, string> = {
  mujer: "indumentaria/calzado de mujer",
  hombre: "indumentaria/calzado de hombre",
  unisex: "indumentaria/calzado unisex",
  ninos: "indumentaria/calzado infantil (bebés y chicos hasta 14 años)"
};

const pickRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const ALL_SCENARIOS = Object.keys(SCENARIO_HINTS) as Scenario[];
const ALL_TONES = Object.keys(TONE_HINTS) as Tone[];

export class SyntheticConversationService {
  private readonly openAiModel = process.env.SYNTHETIC_LLM_MODEL ?? "gpt-4o-mini";
  private readonly openAiApiKey = process.env.OPENAI_API_KEY;
  private readonly timeoutMs = Number(process.env.SYNTHETIC_LLM_TIMEOUT_MS ?? 25000);

  isAvailable(): boolean {
    return Boolean(this.openAiApiKey);
  }

  async generateOne(input: {
    segment: Segment;
    scenario?: Scenario;
    tone?: Tone;
  }): Promise<SyntheticConversation | null> {
    if (!this.openAiApiKey) return null;

    const scenario = input.scenario ?? pickRandom(ALL_SCENARIOS);
    const tone = input.tone ?? pickRandom(ALL_TONES);
    const category = pickRandom(CATEGORIES[input.segment]);
    const productName = `${category}${input.segment === "ninos" ? " infantil" : ""}`;

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt({
      segment: input.segment,
      scenario,
      tone,
      category,
      productName
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.openAiApiKey}`
        },
        body: JSON.stringify({
          model: this.openAiModel,
          temperature: 0.85,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        }),
        signal: controller.signal
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = String(body.choices?.[0]?.message?.content ?? "").trim();
      if (!content) return null;

      const parsed = this.parseJson(content);
      if (!parsed || !Array.isArray(parsed.turns)) return null;

      const turns: SyntheticTurn[] = [];
      for (const t of parsed.turns) {
        if (!t || typeof t !== "object") continue;
        const speaker = String((t as any).speaker ?? "").toLowerCase();
        const text = String((t as any).text ?? "").trim();
        if (!text) continue;
        if (speaker !== "cliente" && speaker !== "vendedor") continue;
        turns.push({ speaker: speaker as "cliente" | "vendedor", text });
      }
      if (turns.length < 4) return null;
      // Tiene que haber al menos 1 par cliente→vendedor utilizable.
      const hasPair = turns.some(
        (t, i) => t.speaker === "cliente" && turns[i + 1]?.speaker === "vendedor"
      );
      if (!hasPair) return null;

      return {
        segment: input.segment,
        scenario,
        tone,
        category,
        productName,
        turns
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseJson(raw: string): { turns?: unknown } | null {
    try {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = fenced?.[1]?.trim() || raw;
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  private buildSystemPrompt(): string {
    return [
      "Sos un generador experto de conversaciones REALES de venta WhatsApp en español argentino.",
      "Vas a producir UNA conversación entre un cliente y un vendedor de una tienda de indumentaria/calzado.",
      "Reglas estrictas:",
      "1) VOSEO argentino: tenés / querés / sos / podés / mandame / pasame.",
      "2) Mensajes naturales, NO formales: como se escribe en WhatsApp real (a veces con minúsculas, abreviaturas tipo 'q', signos al final).",
      "3) El cliente puede dudar, pedir más fotos, preguntar por talle, regatear suavemente, ser breve.",
      "4) El vendedor cierra con propuesta concreta: link de pago, alias para transferencia, coordinación de envío, retiro en local.",
      "5) La conversación termina en venta o MUY cerca (cliente confirmando, pidiendo link/alias, dando dirección).",
      "6) Entre 4 y 12 turnos en total, alternando cliente y vendedor.",
      "7) Sin alucinar — no inventes URLs específicas, alias bancarios reales, ni precios irreales.",
      "8) NO uses datos personales reales (nombres genéricos como 'Hola Lu', 'amor', 'gracias' o sin nombre).",
      "Respondé SOLO JSON con esta forma:",
      '{"turns":[{"speaker":"cliente","text":"..."},{"speaker":"vendedor","text":"..."}, ...]}'
    ].join(" ");
  }

  private buildUserPrompt(args: {
    segment: Segment;
    scenario: Scenario;
    tone: Tone;
    category: string;
    productName: string;
  }): string {
    return [
      `Generá una conversación sobre ${SEGMENT_LABEL[args.segment]}, específicamente sobre ${args.category}.`,
      `Escenario: ${SCENARIO_HINTS[args.scenario]}`,
      `Tono: ${TONE_HINTS[args.tone]}`,
      args.segment === "ninos"
        ? "Considerá que quien escribe es la mamá/papá/familiar (no el chico). Talles infantiles típicos: 0-3M, 6M, 12M, 2, 4, 6, 8, 10, 12, 14."
        : "Talles típicos del segmento (números o letras según corresponda al producto).",
      "Producto sobre el que conversan:",
      `- Categoría: ${args.category}`,
      `- Tipo: ${args.productName}`,
      "Asegurate de que la conversación sea creíble y diferente cada vez (no copies fórmulas)."
    ].join(" ");
  }

  static randomSegment(): Segment {
    return pickRandom(["mujer", "hombre", "unisex", "ninos"] as Segment[]);
  }

  static segments(): Segment[] {
    return ["mujer", "hombre", "unisex", "ninos"];
  }
}
