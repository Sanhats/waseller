import { prisma } from "../../../../packages/db/src";
import {
  JOB_SCHEMA_VERSION,
  parseShadowCompareHttpResponse,
  summarizeDecisionDiff,
  type ConversationInterpretationV1,
  type LlmDecisionV1
} from "../../../../packages/queue/src";

export type ShadowCompareRecentMessageV1 = {
  direction: "incoming" | "outgoing";
  message: string;
};

/** Payload shadow-compare v1 + opcionales alineados a docs/integrations/waseller-crew/CONTRATO_V1_1.md */
export type ShadowCompareInput = {
  tenantId: string;
  leadId: string;
  conversationId?: string;
  messageId: string;
  correlationId: string;
  dedupeKey: string;
  phone: string;
  incomingText: string;
  interpretation: ConversationInterpretationV1;
  baselineDecision: LlmDecisionV1;
  /** Cronológico (más antiguo primero); tope 8 en origen. */
  recentMessages?: ShadowCompareRecentMessageV1[];
};

/**
 * Si `LLM_SHADOW_COMPARE_URL` está definida, envía el baseline a un servicio externo (p. ej. CrewAI)
 * y persiste el resultado en `LlmTrace` con `traceKind: "shadow_compare"`.
 * No lanza: errores de red o de persistencia se ignoran para no afectar el camino principal.
 */
export async function logShadowExternalCompareIfConfigured(input: ShadowCompareInput): Promise<void> {
  const url = String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim();
  if (!url) return;

  const timeoutMs = Math.max(
    1000,
    Math.min(120_000, Number(process.env.LLM_SHADOW_COMPARE_TIMEOUT_MS ?? 8000))
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const shadowSecret = String(process.env.LLM_SHADOW_COMPARE_SECRET ?? "").trim();
  const authorizationSent = shadowSecret.length > 0;

  const buildRequestPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      schemaVersion: JOB_SCHEMA_VERSION,
      kind: "waseller.shadow_compare.v1",
      tenantId: input.tenantId,
      leadId: input.leadId,
      incomingText: input.incomingText,
      interpretation: input.interpretation,
      baselineDecision: input.baselineDecision
    };
    const phone = String(input.phone ?? "").trim();
    if (phone) payload.phone = phone;
    if (input.correlationId.trim()) payload.correlationId = input.correlationId;
    if (input.messageId.trim()) payload.messageId = input.messageId;
    if (input.conversationId !== undefined && input.conversationId !== null && String(input.conversationId).trim()) {
      payload.conversationId = input.conversationId;
    }
    const recent = input.recentMessages?.filter((m) => m.message?.trim()) ?? [];
    if (recent.length > 0) {
      payload.recentMessages = recent.slice(-8).map((m) => ({
        direction: m.direction,
        message: m.message
      }));
    }
    return payload;
  };

  const persist = async (
    body: {
      httpStatus?: number;
      response: Record<string, unknown>;
      error?: string;
    },
    outboundBody: Record<string, unknown>
  ) => {
    try {
      await prisma.llmTrace.create({
        data: {
          tenantId: input.tenantId,
          leadId: input.leadId,
          conversationId: input.conversationId ?? null,
          messageId: input.messageId,
          correlationId: input.correlationId,
          dedupeKey: `${input.dedupeKey}:shadow_compare`,
          traceKind: "shadow_compare",
          provider: "shadow_compare_http",
          model: null,
          request: {
            url,
            timeoutMs,
            authorizationSent,
            body: outboundBody
          },
          response: body.response,
          promptTokens: null,
          completionTokens: null,
          latencyMs: null,
          handoffRequired: false,
          error: body.error ?? null
        }
      });
    } catch {
      // No bloquear orquestación si el esquema de DB difiere o falla escritura.
    }
  };

  const outboundBody = buildRequestPayload();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorizationSent) {
    headers.Authorization = `Bearer ${shadowSecret}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(outboundBody)
    });
    const raw = await res.text();
    let json: unknown;
    try {
      json = raw ? (JSON.parse(raw) as unknown) : {};
    } catch {
      await persist(
        {
          httpStatus: res.status,
          error: "invalid_json_body",
          response: { rawSnippet: raw.slice(0, 800) }
        },
        outboundBody
      );
      return;
    }

    const parsed = parseShadowCompareHttpResponse(json);
    if (!parsed.ok) {
      await persist(
        {
          httpStatus: res.status,
          error: parsed.error,
          response: { issues: parsed.issues ?? [] }
        },
        outboundBody
      );
      return;
    }

    const candidate = parsed.value.candidateDecision;
    const diff =
      candidate !== undefined
        ? summarizeDecisionDiff(input.baselineDecision, candidate)
        : { skipped: true as const, reason: "no_candidateDecision" };

    await persist(
      {
        httpStatus: res.status,
        response: {
          httpOk: res.ok,
          candidateDecision: candidate ?? null,
          candidateInterpretation: parsed.value.candidateInterpretation ?? null,
          diff
        }
      },
      outboundBody
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await persist(
      {
        error: message,
        response: { aborted: message.includes("abort") }
      },
      outboundBody
    );
  } finally {
    clearTimeout(timer);
  }
}
