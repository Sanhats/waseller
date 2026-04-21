"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractInterpretationProductId = extractInterpretationProductId;
exports.resolveProductIdForTenantVariant = resolveProductIdForTenantVariant;
exports.assembleShadowCompareOutboundBody = assembleShadowCompareOutboundBody;
exports.tryWasellerCrewPrimaryReplacement = tryWasellerCrewPrimaryReplacement;
exports.logShadowExternalCompareIfConfigured = logShadowExternalCompareIfConfigured;
const src_1 = require("../../../../packages/db/src");
const src_2 = require("../../../../packages/queue/src");
const crew_business_profile_slug_1 = require("../../../../packages/shared/src/crew-business-profile-slug");
const normalizeShadowStockAttributes = (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return {};
    const entries = Object.entries(raw)
        .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
        .filter(([key, value]) => key.length > 0 && value.length > 0);
    return Object.fromEntries(entries);
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function sanitizeUuidProductIds(ids, max) {
    const out = [];
    const seen = new Set();
    for (const id of ids ?? []) {
        const t = String(id ?? "").trim();
        if (!UUID_RE.test(t) || seen.has(t))
            continue;
        seen.add(t);
        out.push(t);
        if (out.length >= max)
            break;
    }
    return out;
}
function mapStockRows(rows) {
    return rows.map((row) => ({
        variantId: row.variantId,
        productId: row.productId,
        name: row.name,
        sku: row.sku,
        attributes: normalizeShadowStockAttributes(row.attributes),
        stock: Number(row.stock ?? 0),
        reservedStock: Number(row.reservedStock ?? 0),
        availableStock: Number(row.availableStock ?? 0),
        effectivePrice: Number(row.effectivePrice ?? 0),
        imageUrl: row.imageUrl ?? undefined,
        isActive: Boolean(row.isActive),
        tags: Array.isArray(row.tags) ? row.tags : [],
        basePrice: row.basePrice == null ? null : Number(row.basePrice),
        variantPrice: row.variantPrice == null ? null : Number(row.variantPrice)
    }));
}
async function queryVariantsForProduct(tenantId, productId, rowLimit) {
    const pid = String(productId).trim();
    if (!UUID_RE.test(pid))
        return [];
    const rows = (await src_1.prisma.$queryRaw `
    select
      v.id as "variantId",
      p.id as "productId",
      p.name as "name",
      p.price as "basePrice",
      v.price as "variantPrice",
      coalesce(v.price, p.price) as "effectivePrice",
      v.sku as "sku",
      v.attributes as "attributes",
      v.stock as "stock",
      v.reserved_stock as "reservedStock",
      greatest(v.stock - v.reserved_stock, 0) as "availableStock",
      p.image_url as "imageUrl",
      p.tags as "tags",
      v.is_active as "isActive"
    from public.product_variants v
    inner join public.products p on p.id = v.product_id
    where v.tenant_id::text = ${tenantId}
      and p.id::text = ${pid}
      and v.is_active = true
      and greatest(v.stock - v.reserved_stock, 0) > 0
    order by p.updated_at desc, p.name asc, v.sku asc
    limit ${Math.max(1, Math.min(500, rowLimit))}
  `);
    return mapStockRows(rows);
}
async function loadStockTableBundle(tenantId, singleProductId, ragProductIds) {
    const single = singleProductId && String(singleProductId).trim();
    if (single && UUID_RE.test(single)) {
        const rows = await queryVariantsForProduct(tenantId, single, 500);
        return { rows, scope: "single_product", ragProductIdsTried: [] };
    }
    const ragRowLimit = Math.max(5, Math.min(100, Number(process.env.LLM_SHADOW_COMPARE_STOCK_RAG_ROW_LIMIT ?? 30)));
    const ragIds = sanitizeUuidProductIds(ragProductIds ?? [], 8);
    if (ragIds.length === 0) {
        return { rows: [], scope: "none", ragProductIdsTried: [] };
    }
    const combined = [];
    const seen = new Set();
    for (const pid of ragIds) {
        const chunk = await queryVariantsForProduct(tenantId, pid, ragRowLimit);
        for (const r of chunk) {
            if (seen.has(r.variantId))
                continue;
            seen.add(r.variantId);
            combined.push(r);
            if (combined.length >= ragRowLimit)
                break;
        }
        if (combined.length >= ragRowLimit)
            break;
    }
    return {
        rows: combined.slice(0, ragRowLimit),
        scope: "multi_rag",
        ragProductIdsTried: ragIds
    };
}
function buildInventoryNarrowingNote(input) {
    if (input.scope === "none") {
        return "No se incluyó tabla de stock: sin producto concreto en contexto ni coincidencias RAG por nombre para acotar el catálogo. El catálogo completo puede tener más productos.";
    }
    if (input.rowCount === 0) {
        if (input.scope === "single_product") {
            return "Se acotó al producto en contexto pero no hay variantes activas con stock disponible en Waseller.";
        }
        return "Se filtraron productos candidatos (similitud con el mensaje) pero ninguna variante activa tiene stock > 0.";
    }
    if (input.scope === "single_product") {
        if (input.rowCount === 1 && input.stockTableProductId) {
            return "En el inventario enviado solo figura una variante activa con stock de este producto; no inventes otras combinaciones de color/talle salvo que el cliente las mencione en el hilo.";
        }
        return "Solo variantes activas con stock > 0 del producto asociado a la conversación (Waseller).";
    }
    const n = input.ragProductIdsTried.length;
    return `Hasta ${n} producto(s) candidato(s) por similitud con el mensaje; solo variantes activas con stock > 0, máximo ${input.ragRowCap} filas (${input.rowCount} enviadas). El catálogo completo tiene más artículos.`;
}
/** `productId` en entities de la interpretación, si viene como UUID válido. */
function extractInterpretationProductId(interpreted) {
    const pid = interpreted.entities?.productId;
    if (typeof pid === "string" && UUID_RE.test(pid.trim()))
        return pid.trim();
    return null;
}
/** Resuelve el producto de una variante para acotar `stockTable` al mismo alcance que el lead worker (hermanas). */
async function resolveProductIdForTenantVariant(tenantId, variantId) {
    const vid = String(variantId ?? "").trim();
    if (!vid)
        return null;
    const rows = (await src_1.prisma.$queryRaw `
    select p.id as "productId"
    from public.product_variants v
    inner join public.products p on p.id = v.product_id
    where v.tenant_id::text = ${tenantId}
      and v.id::text = ${vid}
    limit 1
  `);
    return rows[0]?.productId ?? null;
}
const readShadowCompareSecret = () => String(process.env.LLM_SHADOW_COMPARE_SECRET ?? process.env.SHADOW_COMPARE_SECRET ?? "").trim();
const isWasellerCrewPrimaryEnabled = () => /^(1|true|yes)$/i.test(String(process.env.WASELLER_CREW_PRIMARY ?? "").trim());
function mergeCrewCandidateIntoLlmDecision(baseline, candidate) {
    if (!candidate)
        return null;
    const draft = typeof candidate.draftReply === "string" ? candidate.draftReply.trim() : "";
    if (draft.length < 2)
        return null;
    return {
        ...baseline,
        draftReply: draft,
        intent: typeof candidate.intent === "string" && candidate.intent.trim().length > 0
            ? candidate.intent.trim()
            : baseline.intent,
        confidence: typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
            ? candidate.confidence
            : baseline.confidence,
        nextAction: candidate.nextAction ?? baseline.nextAction,
        recommendedAction: typeof candidate.recommendedAction === "string" && candidate.recommendedAction.trim().length > 0
            ? candidate.recommendedAction.trim()
            : baseline.recommendedAction,
        reason: typeof candidate.reason === "string" && candidate.reason.trim().length > 0
            ? candidate.reason.trim()
            : baseline.reason,
        source: "llm",
        provider: "waseller-crew",
        model: baseline.model ?? "waseller-crew-primary",
        qualityFlags: Array.from(new Set([...(baseline.qualityFlags ?? []), "crew_primary"]))
    };
}
/** Cuerpo JSON del POST shadow-compare (mismo contrato para comparar o para modo primary). */
async function assembleShadowCompareOutboundBody(input) {
    let stockLoad = { rows: [], scope: "none", ragProductIdsTried: [] };
    try {
        stockLoad = await loadStockTableBundle(input.tenantId, input.stockTableProductId ?? null, input.stockTableRagProductIds ?? null);
    }
    catch {
        stockLoad = { rows: [], scope: "none", ragProductIdsTried: [] };
    }
    const stockTable = stockLoad.rows;
    const ragRowCap = Math.max(5, Math.min(100, Number(process.env.LLM_SHADOW_COMPARE_STOCK_RAG_ROW_LIMIT ?? 30)));
    const inventoryNarrowingNote = buildInventoryNarrowingNote({
        scope: stockLoad.scope,
        rowCount: stockTable.length,
        stockTableProductId: input.stockTableProductId,
        ragProductIdsTried: stockLoad.ragProductIdsTried,
        ragRowCap
    });
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
    if (stockTable.length > 0) {
        payload.stockTable = stockTable;
    }
    payload.inventoryNarrowingNote = inventoryNarrowingNote;
    const crewSlug = (0, crew_business_profile_slug_1.toCrewBusinessProfileSlug)(String(input.tenantBusinessCategory ?? ""));
    if (crewSlug) {
        payload.businessProfileSlug = crewSlug;
    }
    return payload;
}
/**
 * Una sola llamada a waseller-crew: si responde con `candidateDecision.draftReply` válido, reemplaza la decisión
 * interna (OpenAI/self-hosted) **antes** del verificador y guardrails. Requiere `LLM_SHADOW_COMPARE_URL` y
 * `WASELLER_CREW_PRIMARY=true`. No lanza hacia arriba.
 */
async function tryWasellerCrewPrimaryReplacement(input) {
    if (!isWasellerCrewPrimaryEnabled())
        return null;
    const url = String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim();
    if (!url)
        return null;
    const outboundBody = await assembleShadowCompareOutboundBody(input);
    const timeoutMs = Math.max(1000, Math.min(120_000, Number(process.env.LLM_SHADOW_COMPARE_TIMEOUT_MS ?? 30_000)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const shadowSecret = readShadowCompareSecret();
    const authorizationSent = shadowSecret.length > 0;
    const headers = { "content-type": "application/json" };
    if (authorizationSent) {
        headers.Authorization = `Bearer ${shadowSecret}`;
    }
    const persistCrew = async (response, error) => {
        try {
            await src_1.prisma.llmTrace.create({
                data: {
                    tenantId: input.tenantId,
                    leadId: input.leadId,
                    conversationId: input.conversationId ?? null,
                    messageId: input.messageId,
                    correlationId: input.correlationId,
                    dedupeKey: `${input.dedupeKey}:crew_primary`,
                    traceKind: "crew_primary",
                    provider: "waseller-crew",
                    model: null,
                    request: {
                        url,
                        timeoutMs,
                        authorizationSent,
                        body: outboundBody
                    },
                    response,
                    promptTokens: null,
                    completionTokens: null,
                    latencyMs: null,
                    handoffRequired: false,
                    error: error ?? null
                }
            });
        }
        catch {
            // noop
        }
    };
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
            await persistCrew({ httpStatus: res.status, rawSnippet: raw.slice(0, 800) }, "invalid_json_body");
            return null;
        }
        const parsed = (0, src_2.parseShadowCompareHttpResponse)(json);
        if (!parsed.ok) {
            await persistCrew({
                httpStatus: res.status,
                issues: parsed.issues ?? []
            }, parsed.error);
            return null;
        }
        const merged = mergeCrewCandidateIntoLlmDecision(input.baselineDecision, parsed.value.candidateDecision);
        if (!merged || !res.ok) {
            await persistCrew({
                httpStatus: res.status,
                httpOk: res.ok,
                candidateDecision: parsed.value.candidateDecision ?? null,
                skipped: merged ? false : "no_mergeable_candidate"
            }, !res.ok ? `http_${res.status}` : "no_mergeable_candidate");
            return null;
        }
        await persistCrew({
            httpStatus: res.status,
            httpOk: res.ok,
            candidateDecision: parsed.value.candidateDecision ?? null,
            applied: true
        });
        return { decision: merged, outboundBody };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await persistCrew({ aborted: message.includes("abort"), detail: message }, message);
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Si `LLM_SHADOW_COMPARE_URL` está definida, envía el baseline a un servicio externo (p. ej. CrewAI)
 * y persiste el resultado en `LlmTrace` con `traceKind: "shadow_compare"`.
 * No lanza: errores de red o de persistencia se ignoran para no afectar el camino principal.
 */
async function logShadowExternalCompareIfConfigured(input) {
    const url = String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim();
    if (!url)
        return;
    const timeoutMs = Math.max(1000, Math.min(120_000, Number(process.env.LLM_SHADOW_COMPARE_TIMEOUT_MS ?? 30_000)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const shadowSecret = readShadowCompareSecret();
    const authorizationSent = shadowSecret.length > 0;
    const outboundBody = await assembleShadowCompareOutboundBody(input);
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
