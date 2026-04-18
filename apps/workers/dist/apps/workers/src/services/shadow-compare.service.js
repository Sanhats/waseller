"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logShadowExternalCompareIfConfigured = logShadowExternalCompareIfConfigured;
const src_1 = require("../../../../packages/db/src");
const src_2 = require("../../../../packages/queue/src");
/**
 * Si `LLM_SHADOW_COMPARE_URL` está definida, envía el baseline a un servicio externo (p. ej. CrewAI)
 * y persiste el resultado en `LlmTrace` con `traceKind: "shadow_compare"`.
 * No lanza: errores de red o de persistencia se ignoran para no afectar el camino principal.
 */
async function logShadowExternalCompareIfConfigured(input) {
    const url = String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim();
    if (!url)
        return;
    const timeoutMs = Math.max(1000, Math.min(120_000, Number(process.env.LLM_SHADOW_COMPARE_TIMEOUT_MS ?? 8000)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const shadowSecret = String(process.env.LLM_SHADOW_COMPARE_SECRET ?? "").trim();
    const authorizationSent = shadowSecret.length > 0;
    const buildRequestPayload = () => {
        const payload = {
            schemaVersion: src_2.JOB_SCHEMA_VERSION,
            kind: "waseller.shadow_compare.v1",
            tenantId: input.tenantId,
            leadId: input.leadId,
            incomingText: input.incomingText,
            interpretation: input.interpretation,
            baselineDecision: input.baselineDecision
        };
        const phone = String(input.phone ?? "").trim();
        if (phone)
            payload.phone = phone;
        if (input.correlationId.trim())
            payload.correlationId = input.correlationId;
        if (input.messageId.trim())
            payload.messageId = input.messageId;
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
    const persist = async (body, outboundBody) => {
        try {
            await src_1.prisma.llmTrace.create({
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
        }
        catch {
            // No bloquear orquestación si el esquema de DB difiere o falla escritura.
        }
    };
    const outboundBody = buildRequestPayload();
    const headers = { "content-type": "application/json" };
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
        let json;
        try {
            json = raw ? JSON.parse(raw) : {};
        }
        catch {
            await persist({
                httpStatus: res.status,
                error: "invalid_json_body",
                response: { rawSnippet: raw.slice(0, 800) }
            }, outboundBody);
            return;
        }
        const parsed = (0, src_2.parseShadowCompareHttpResponse)(json);
        if (!parsed.ok) {
            await persist({
                httpStatus: res.status,
                error: parsed.error,
                response: { issues: parsed.issues ?? [] }
            }, outboundBody);
            return;
        }
        const candidate = parsed.value.candidateDecision;
        const diff = candidate !== undefined
            ? (0, src_2.summarizeDecisionDiff)(input.baselineDecision, candidate)
            : { skipped: true, reason: "no_candidateDecision" };
        await persist({
            httpStatus: res.status,
            response: {
                httpOk: res.ok,
                candidateDecision: candidate ?? null,
                candidateInterpretation: parsed.value.candidateInterpretation ?? null,
                diff
            }
        }, outboundBody);
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await persist({
            error: message,
            response: { aborted: message.includes("abort") }
        }, outboundBody);
    }
    finally {
        clearTimeout(timer);
    }
}
