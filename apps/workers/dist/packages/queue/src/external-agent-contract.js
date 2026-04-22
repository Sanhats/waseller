"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.llmDecisionV1JsonSchema = exports.conversationInterpretationV1JsonSchema = exports.CONVERSATION_STAGES = exports.CONVERSATION_NEXT_ACTIONS = void 0;
exports.parseExternalConversationInterpretation = parseExternalConversationInterpretation;
exports.parseExternalLlmDecision = parseExternalLlmDecision;
exports.parseShadowCompareHttpResponse = parseShadowCompareHttpResponse;
exports.summarizeDecisionDiff = summarizeDecisionDiff;
exports.CONVERSATION_NEXT_ACTIONS = [
    "reply_only",
    "ask_clarification",
    "confirm_variant",
    "offer_reservation",
    "reserve_stock",
    "share_payment_link",
    "suggest_alternative",
    "handoff_human",
    "close_lead",
    "manual_review"
];
const NEXT_ACTION_SET = new Set(exports.CONVERSATION_NEXT_ACTIONS);
exports.CONVERSATION_STAGES = [
    "waiting_product",
    "waiting_variant",
    "variant_offered",
    "waiting_reservation_confirmation",
    "reserved_waiting_payment_method",
    "payment_link_sent",
    "waiting_payment_confirmation",
    "sale_confirmed"
];
const STAGE_SET = new Set(exports.CONVERSATION_STAGES);
const REFERENCE_KINDS = new Set([
    "active_offer",
    "active_variant",
    "reserved_variant",
    "alternative_variant",
    "product_context"
]);
const LEAD_STAGE_SET = new Set(["discovery", "consideration", "decision", "handoff"]);
const POLICY_BANDS = new Set(["high", "medium", "low"]);
const EXEC_MODES = new Set(["shadow", "active"]);
const LLM_SOURCES = new Set(["llm", "fallback"]);
const PROVIDERS = new Set(["self-hosted", "openai", "rules", "waseller-crew"]);
const VERIFIER_PROVIDERS = new Set(["llm-verifier", "rules"]);
const INTERP_SOURCES = new Set(["rules", "openai"]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isInterpretationEntityValue(value) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return true;
    }
    if (!isRecord(value))
        return false;
    return Object.entries(value).every(([k, v]) => typeof k === "string" && typeof v === "string");
}
function parseInterpretationEntities(raw, path, issues) {
    if (!isRecord(raw)) {
        issues.push({ path, message: "entities must be an object" });
        return null;
    }
    const out = {};
    for (const [key, val] of Object.entries(raw)) {
        if (!isInterpretationEntityValue(val)) {
            issues.push({ path: `${path}.${key}`, message: "invalid entity value" });
            return null;
        }
        out[key] = val;
    }
    return out;
}
function parseLlmEntities(raw, path, issues) {
    if (!isRecord(raw)) {
        issues.push({ path, message: "entities must be an object" });
        return null;
    }
    const out = {};
    for (const [key, val] of Object.entries(raw)) {
        if (val === null || typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
            out[key] = val;
        }
        else {
            issues.push({ path: `${path}.${key}`, message: "invalid entity value for LlmDecision" });
            return null;
        }
    }
    return out;
}
function parseReferences(raw, path, issues) {
    if (!Array.isArray(raw)) {
        issues.push({ path, message: "references must be an array" });
        return null;
    }
    const out = [];
    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (!isRecord(item)) {
            issues.push({ path: `${path}[${i}]`, message: "reference must be an object" });
            return null;
        }
        const kind = item.kind;
        if (typeof kind !== "string" || !REFERENCE_KINDS.has(kind)) {
            issues.push({ path: `${path}[${i}].kind`, message: "invalid reference kind" });
            return null;
        }
        const ref = { kind: kind };
        if ("value" in item)
            ref.value = item.value === undefined ? undefined : item.value;
        if ("axis" in item)
            ref.axis = item.axis === undefined ? undefined : item.axis;
        if ("index" in item)
            ref.index = item.index === undefined ? undefined : item.index;
        if (typeof item.confidence === "number")
            ref.confidence = item.confidence;
        if (item.metadata !== undefined) {
            if (!isRecord(item.metadata)) {
                issues.push({ path: `${path}[${i}].metadata`, message: "metadata must be an object" });
                return null;
            }
            const meta = {};
            for (const [mk, mv] of Object.entries(item.metadata)) {
                if (mv === null || typeof mv === "string" || typeof mv === "number" || typeof mv === "boolean") {
                    meta[mk] = mv;
                }
                else {
                    issues.push({ path: `${path}[${i}].metadata.${mk}`, message: "invalid metadata value" });
                    return null;
                }
            }
            ref.metadata = meta;
        }
        out.push(ref);
    }
    return out;
}
/**
 * Valida JSON externo (p. ej. salida de CrewAI) contra `ConversationInterpretationV1`.
 */
function parseExternalConversationInterpretation(input) {
    const issues = [];
    if (!isRecord(input)) {
        return { ok: false, error: "root must be object", issues: [{ path: "", message: "root must be object" }] };
    }
    if (typeof input.intent !== "string")
        issues.push({ path: "intent", message: "string required" });
    if (typeof input.confidence !== "number")
        issues.push({ path: "confidence", message: "number required" });
    const entities = parseInterpretationEntities(input.entities, "entities", issues);
    const references = parseReferences(input.references, "references", issues);
    if (!Array.isArray(input.missingFields) || !input.missingFields.every((x) => typeof x === "string")) {
        issues.push({ path: "missingFields", message: "string[] required" });
    }
    if (typeof input.nextAction !== "string" || !NEXT_ACTION_SET.has(input.nextAction)) {
        issues.push({ path: "nextAction", message: "invalid ConversationNextActionV1" });
    }
    if (typeof input.source !== "string" || !INTERP_SOURCES.has(input.source)) {
        issues.push({ path: "source", message: "rules | openai required" });
    }
    if (input.conversationStage !== undefined &&
        (typeof input.conversationStage !== "string" || !STAGE_SET.has(input.conversationStage))) {
        issues.push({ path: "conversationStage", message: "invalid stage" });
    }
    if (input.notes !== undefined && (!Array.isArray(input.notes) || !input.notes.every((n) => typeof n === "string"))) {
        issues.push({ path: "notes", message: "string[] expected" });
    }
    if (input.activeOfferDigest !== undefined &&
        (typeof input.activeOfferDigest !== "string" || input.activeOfferDigest.length > 2000)) {
        issues.push({ path: "activeOfferDigest", message: "string expected (max 2000)" });
    }
    if (input.closingGaps !== undefined &&
        (!Array.isArray(input.closingGaps) || !input.closingGaps.every((x) => typeof x === "string"))) {
        issues.push({ path: "closingGaps", message: "string[] expected" });
    }
    if (input.memoryFactsDigest !== undefined && !isRecord(input.memoryFactsDigest)) {
        issues.push({ path: "memoryFactsDigest", message: "object expected" });
    }
    if (input.baselineLeadStage !== undefined &&
        (typeof input.baselineLeadStage !== "string" ||
            !["discovery", "consideration", "decision", "handoff"].includes(input.baselineLeadStage))) {
        issues.push({ path: "baselineLeadStage", message: "invalid lead stage" });
    }
    if (input.baselineRecommendedAction !== undefined &&
        (typeof input.baselineRecommendedAction !== "string" || input.baselineRecommendedAction.length > 400)) {
        issues.push({ path: "baselineRecommendedAction", message: "string expected" });
    }
    if (issues.length > 0 || !entities || !references || !Array.isArray(input.missingFields)) {
        return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join("; "), issues };
    }
    const value = {
        intent: input.intent,
        confidence: input.confidence,
        entities,
        references,
        missingFields: input.missingFields,
        nextAction: input.nextAction,
        source: input.source
    };
    if (typeof input.conversationStage === "string" && STAGE_SET.has(input.conversationStage)) {
        value.conversationStage = input.conversationStage;
    }
    if (Array.isArray(input.notes))
        value.notes = input.notes;
    if (typeof input.activeOfferDigest === "string" && input.activeOfferDigest.length <= 2000) {
        value.activeOfferDigest = input.activeOfferDigest;
    }
    if (Array.isArray(input.closingGaps) && input.closingGaps.every((x) => typeof x === "string")) {
        value.closingGaps = input.closingGaps;
    }
    if (isRecord(input.memoryFactsDigest)) {
        const md = {};
        for (const [k, v] of Object.entries(input.memoryFactsDigest)) {
            if (typeof k !== "string" || k.length > 64)
                continue;
            if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
                md[k] = v;
            }
        }
        if (Object.keys(md).length > 0)
            value.memoryFactsDigest = md;
    }
    if (typeof input.baselineLeadStage === "string" &&
        ["discovery", "consideration", "decision", "handoff"].includes(input.baselineLeadStage)) {
        value.baselineLeadStage = input.baselineLeadStage;
    }
    if (typeof input.baselineRecommendedAction === "string" && input.baselineRecommendedAction.length <= 400) {
        value.baselineRecommendedAction = input.baselineRecommendedAction;
    }
    return { ok: true, value };
}
function parseVerification(raw, path, issues) {
    if (raw === undefined)
        return undefined;
    if (!isRecord(raw)) {
        issues.push({ path, message: "verification must be object" });
        return undefined;
    }
    const vIssues = [];
    if (typeof raw.passed !== "boolean")
        vIssues.push({ path: `${path}.passed`, message: "boolean required" });
    if (typeof raw.score !== "number")
        vIssues.push({ path: `${path}.score`, message: "number required" });
    if (!Array.isArray(raw.flags) || !raw.flags.every((f) => typeof f === "string")) {
        vIssues.push({ path: `${path}.flags`, message: "string[] required" });
    }
    if (typeof raw.reason !== "string")
        vIssues.push({ path: `${path}.reason`, message: "string required" });
    if (typeof raw.provider !== "string" || !VERIFIER_PROVIDERS.has(raw.provider)) {
        vIssues.push({ path: `${path}.provider`, message: "invalid provider" });
    }
    if (vIssues.length > 0) {
        issues.push(...vIssues);
        return undefined;
    }
    const v = {
        passed: raw.passed,
        score: raw.score,
        flags: raw.flags,
        reason: raw.reason,
        provider: raw.provider
    };
    if (typeof raw.model === "string")
        v.model = raw.model;
    return v;
}
function parsePolicy(raw, path, issues) {
    if (raw === undefined)
        return undefined;
    if (!isRecord(raw)) {
        issues.push({ path, message: "policy must be object" });
        return undefined;
    }
    const pIssues = [];
    const keys = [
        "recommendedAction",
        "executedAction",
        "shadowMode",
        "allowSensitiveActions"
    ];
    for (const k of keys) {
        if (k === "recommendedAction" || k === "executedAction") {
            if (typeof raw[k] !== "string")
                pIssues.push({ path: `${path}.${k}`, message: "string required" });
        }
        else if (typeof raw[k] !== "boolean") {
            pIssues.push({ path: `${path}.${k}`, message: "boolean required" });
        }
    }
    if (pIssues.length > 0) {
        issues.push(...pIssues);
        return undefined;
    }
    const p = {
        recommendedAction: String(raw.recommendedAction),
        executedAction: String(raw.executedAction),
        shadowMode: Boolean(raw.shadowMode),
        allowSensitiveActions: Boolean(raw.allowSensitiveActions)
    };
    if (typeof raw.contextRecovered === "boolean")
        p.contextRecovered = raw.contextRecovered;
    if (typeof raw.verifierRequired === "boolean")
        p.verifierRequired = raw.verifierRequired;
    if (typeof raw.minVerifierScore === "number")
        p.minVerifierScore = raw.minVerifierScore;
    return p;
}
/**
 * Valida JSON externo contra `LlmDecisionV1`.
 */
function parseExternalLlmDecision(input) {
    const issues = [];
    if (!isRecord(input)) {
        return { ok: false, error: "root must be object", issues: [{ path: "", message: "root must be object" }] };
    }
    if (typeof input.intent !== "string")
        issues.push({ path: "intent", message: "string required" });
    if (typeof input.leadStage !== "string" || !LEAD_STAGE_SET.has(input.leadStage)) {
        issues.push({ path: "leadStage", message: "invalid leadStage" });
    }
    if (typeof input.confidence !== "number")
        issues.push({ path: "confidence", message: "number required" });
    const entities = parseLlmEntities(input.entities, "entities", issues);
    if (typeof input.nextAction !== "string" || !NEXT_ACTION_SET.has(input.nextAction)) {
        issues.push({ path: "nextAction", message: "invalid nextAction" });
    }
    if (typeof input.reason !== "string")
        issues.push({ path: "reason", message: "string required" });
    if (typeof input.requiresHuman !== "boolean")
        issues.push({ path: "requiresHuman", message: "boolean required" });
    if (input.policyBand !== undefined && (typeof input.policyBand !== "string" || !POLICY_BANDS.has(input.policyBand))) {
        issues.push({ path: "policyBand", message: "invalid policyBand" });
    }
    if (input.executionMode !== undefined &&
        (typeof input.executionMode !== "string" || !EXEC_MODES.has(input.executionMode))) {
        issues.push({ path: "executionMode", message: "invalid executionMode" });
    }
    if (typeof input.recommendedAction !== "string")
        issues.push({ path: "recommendedAction", message: "string required" });
    if (typeof input.draftReply !== "string")
        issues.push({ path: "draftReply", message: "string required" });
    if (typeof input.handoffRequired !== "boolean")
        issues.push({ path: "handoffRequired", message: "boolean required" });
    if (!Array.isArray(input.qualityFlags) || !input.qualityFlags.every((q) => typeof q === "string")) {
        issues.push({ path: "qualityFlags", message: "string[] required" });
    }
    if (typeof input.source !== "string" || !LLM_SOURCES.has(input.source)) {
        issues.push({ path: "source", message: "llm | fallback required" });
    }
    if (input.provider !== undefined && (typeof input.provider !== "string" || !PROVIDERS.has(input.provider))) {
        issues.push({ path: "provider", message: "invalid provider" });
    }
    if (input.model !== undefined && typeof input.model !== "string") {
        issues.push({ path: "model", message: "string expected" });
    }
    const policy = parsePolicy(input.policy, "policy", issues);
    const verification = parseVerification(input.verification, "verification", issues);
    if (issues.length > 0 || !entities) {
        return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join("; "), issues };
    }
    const value = {
        intent: input.intent,
        leadStage: input.leadStage,
        confidence: input.confidence,
        entities,
        nextAction: input.nextAction,
        reason: input.reason,
        requiresHuman: input.requiresHuman,
        recommendedAction: input.recommendedAction,
        draftReply: input.draftReply,
        handoffRequired: input.handoffRequired,
        qualityFlags: input.qualityFlags,
        source: input.source
    };
    if (typeof input.policyBand === "string" && POLICY_BANDS.has(input.policyBand)) {
        value.policyBand = input.policyBand;
    }
    if (typeof input.executionMode === "string" && EXEC_MODES.has(input.executionMode)) {
        value.executionMode = input.executionMode;
    }
    if (policy)
        value.policy = policy;
    if (verification)
        value.verification = verification;
    if (typeof input.provider === "string" && PROVIDERS.has(input.provider)) {
        value.provider = input.provider;
    }
    if (typeof input.model === "string")
        value.model = input.model;
    return { ok: true, value };
}
function parseNextActionOptional(raw, path, issues) {
    if (raw === undefined)
        return undefined;
    if (typeof raw !== "string" || !NEXT_ACTION_SET.has(raw)) {
        issues.push({ path, message: "invalid optional nextAction" });
        return undefined;
    }
    return raw;
}
/**
 * Respuesta esperada del POST `LLM_SHADOW_COMPARE_URL` (campos opcionales para no forzar un contrato rígido al comparar).
 */
function parseShadowCompareHttpResponse(input) {
    const issues = [];
    if (!isRecord(input)) {
        return { ok: false, error: "root must be object", issues: [{ path: "", message: "root must be object" }] };
    }
    const value = {};
    if (input.candidateDecision !== undefined) {
        if (!isRecord(input.candidateDecision)) {
            issues.push({ path: "candidateDecision", message: "must be object" });
        }
        else {
            const c = input.candidateDecision;
            const cand = {};
            if (c.draftReply !== undefined) {
                if (typeof c.draftReply !== "string")
                    issues.push({ path: "candidateDecision.draftReply", message: "string" });
                else
                    cand.draftReply = c.draftReply;
            }
            if (c.intent !== undefined) {
                if (typeof c.intent !== "string")
                    issues.push({ path: "candidateDecision.intent", message: "string" });
                else
                    cand.intent = c.intent;
            }
            const na = parseNextActionOptional(c.nextAction, "candidateDecision.nextAction", issues);
            if (na !== undefined)
                cand.nextAction = na;
            if (c.recommendedAction !== undefined) {
                if (typeof c.recommendedAction !== "string") {
                    issues.push({ path: "candidateDecision.recommendedAction", message: "string" });
                }
                else
                    cand.recommendedAction = c.recommendedAction;
            }
            if (c.confidence !== undefined) {
                if (typeof c.confidence !== "number")
                    issues.push({ path: "candidateDecision.confidence", message: "number" });
                else
                    cand.confidence = c.confidence;
            }
            if (c.reason !== undefined) {
                if (typeof c.reason !== "string")
                    issues.push({ path: "candidateDecision.reason", message: "string" });
                else
                    cand.reason = c.reason;
            }
            if (Object.keys(cand).length > 0)
                value.candidateDecision = cand;
        }
    }
    if (input.candidateInterpretation !== undefined) {
        if (!isRecord(input.candidateInterpretation)) {
            issues.push({ path: "candidateInterpretation", message: "must be object" });
        }
        else {
            const interpIssues = [];
            const partial = input.candidateInterpretation;
            if (partial.source !== undefined && !INTERP_SOURCES.has(partial.source)) {
                interpIssues.push({ path: "candidateInterpretation.source", message: "rules | openai" });
            }
            if (partial.nextAction !== undefined &&
                (typeof partial.nextAction !== "string" || !NEXT_ACTION_SET.has(partial.nextAction))) {
                interpIssues.push({ path: "candidateInterpretation.nextAction", message: "invalid nextAction" });
            }
            if (partial.conversationStage !== undefined &&
                (typeof partial.conversationStage !== "string" || !STAGE_SET.has(partial.conversationStage))) {
                interpIssues.push({ path: "candidateInterpretation.conversationStage", message: "invalid stage" });
            }
            if (interpIssues.length > 0)
                issues.push(...interpIssues);
            else
                value.candidateInterpretation = partial;
        }
    }
    if (issues.length > 0) {
        return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join("; "), issues };
    }
    return { ok: true, value };
}
function summarizeDecisionDiff(baseline, candidate) {
    const cDraft = candidate.draftReply;
    const cIntent = candidate.intent;
    const cNext = candidate.nextAction;
    const cRec = candidate.recommendedAction;
    const cConf = candidate.confidence;
    return {
        draftReplyEqual: typeof cDraft === "string" ? baseline.draftReply === cDraft : null,
        intentMatch: typeof cIntent === "string" ? baseline.intent === cIntent : null,
        nextActionMatch: cNext !== undefined ? baseline.nextAction === cNext : null,
        recommendedActionMatch: typeof cRec === "string" ? baseline.recommendedAction === cRec : null,
        confidenceDelta: typeof cConf === "number" ? cConf - baseline.confidence : null
    };
}
/**
 * JSON Schema (draft-07) equivalente a `ConversationInterpretationV1` para herramientas externas.
 */
exports.conversationInterpretationV1JsonSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "ConversationInterpretationV1",
    type: "object",
    additionalProperties: false,
    required: ["intent", "confidence", "entities", "references", "missingFields", "nextAction", "source"],
    properties: {
        intent: { type: "string" },
        confidence: { type: "number" },
        entities: {
            type: "object",
            additionalProperties: {
                oneOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" },
                    { type: "null" },
                    { type: "object", additionalProperties: { type: "string" } }
                ]
            }
        },
        references: {
            type: "array",
            items: {
                type: "object",
                required: ["kind"],
                properties: {
                    kind: {
                        type: "string",
                        enum: [...REFERENCE_KINDS]
                    },
                    value: { type: ["string", "null"] },
                    axis: { type: ["string", "null"] },
                    index: { type: ["number", "null"] },
                    confidence: { type: "number" },
                    metadata: {
                        type: "object",
                        additionalProperties: {
                            oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }]
                        }
                    }
                }
            }
        },
        conversationStage: { type: "string", enum: [...STAGE_SET] },
        missingFields: { type: "array", items: { type: "string" } },
        nextAction: { type: "string", enum: [...NEXT_ACTION_SET] },
        source: { type: "string", enum: [...INTERP_SOURCES] },
        notes: { type: "array", items: { type: "string" } },
        activeOfferDigest: { type: "string", maxLength: 2000 },
        closingGaps: { type: "array", items: { type: "string", maxLength: 220 } },
        memoryFactsDigest: {
            type: "object",
            additionalProperties: {
                oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }]
            }
        },
        baselineLeadStage: { type: "string", enum: [...LEAD_STAGE_SET] },
        baselineRecommendedAction: { type: "string", maxLength: 400 }
    }
};
/**
 * JSON Schema (draft-07) equivalente a `LlmDecisionV1` para herramientas externas.
 */
exports.llmDecisionV1JsonSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "LlmDecisionV1",
    type: "object",
    additionalProperties: false,
    required: [
        "intent",
        "leadStage",
        "confidence",
        "entities",
        "nextAction",
        "reason",
        "requiresHuman",
        "recommendedAction",
        "draftReply",
        "handoffRequired",
        "qualityFlags",
        "source"
    ],
    properties: {
        intent: { type: "string" },
        leadStage: { type: "string", enum: [...LEAD_STAGE_SET] },
        confidence: { type: "number" },
        entities: {
            type: "object",
            additionalProperties: {
                oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }]
            }
        },
        nextAction: { type: "string", enum: [...NEXT_ACTION_SET] },
        reason: { type: "string" },
        requiresHuman: { type: "boolean" },
        policyBand: { type: "string", enum: [...POLICY_BANDS] },
        executionMode: { type: "string", enum: [...EXEC_MODES] },
        policy: { type: "object" },
        verification: { type: "object" },
        recommendedAction: { type: "string" },
        draftReply: { type: "string" },
        handoffRequired: { type: "boolean" },
        qualityFlags: { type: "array", items: { type: "string" } },
        source: { type: "string", enum: [...LLM_SOURCES] },
        provider: { type: "string", enum: [...PROVIDERS] },
        model: { type: "string" }
    }
};
