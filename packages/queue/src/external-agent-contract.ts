import type {
  ConversationInterpretationV1,
  ConversationNextActionV1,
  ConversationReferenceV1,
  ConversationStageV1,
  LlmDecisionV1
} from "./contracts";

export type ValidationIssue = { path: string; message: string };

export const CONVERSATION_NEXT_ACTIONS = [
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
] as const satisfies readonly ConversationNextActionV1[];

const NEXT_ACTION_SET = new Set<string>(CONVERSATION_NEXT_ACTIONS);

export const CONVERSATION_STAGES = [
  "waiting_product",
  "waiting_variant",
  "variant_offered",
  "waiting_reservation_confirmation",
  "reserved_waiting_payment_method",
  "payment_link_sent",
  "waiting_payment_confirmation",
  "sale_confirmed"
] as const satisfies readonly ConversationStageV1[];

const STAGE_SET = new Set<string>(CONVERSATION_STAGES);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInterpretationEntityValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([k, v]) => typeof k === "string" && typeof v === "string"
  );
}

function parseInterpretationEntities(raw: unknown, path: string, issues: ValidationIssue[]): Record<
  string,
  string | number | boolean | null | Record<string, string>
> | null {
  if (!isRecord(raw)) {
    issues.push({ path, message: "entities must be an object" });
    return null;
  }
  const out: Record<string, string | number | boolean | null | Record<string, string>> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!isInterpretationEntityValue(val)) {
      issues.push({ path: `${path}.${key}`, message: "invalid entity value" });
      return null;
    }
    out[key] = val as string | number | boolean | null | Record<string, string>;
  }
  return out;
}

function parseLlmEntities(raw: unknown, path: string, issues: ValidationIssue[]): Record<
  string,
  string | number | boolean | null
> | null {
  if (!isRecord(raw)) {
    issues.push({ path, message: "entities must be an object" });
    return null;
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val === null || typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      out[key] = val;
    } else {
      issues.push({ path: `${path}.${key}`, message: "invalid entity value for LlmDecision" });
      return null;
    }
  }
  return out;
}

function parseReferences(raw: unknown, path: string, issues: ValidationIssue[]): ConversationReferenceV1[] | null {
  if (!Array.isArray(raw)) {
    issues.push({ path, message: "references must be an array" });
    return null;
  }
  const out: ConversationReferenceV1[] = [];
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
    const ref: ConversationReferenceV1 = { kind: kind as ConversationReferenceV1["kind"] };
    if ("value" in item) ref.value = item.value === undefined ? undefined : (item.value as string | null);
    if ("axis" in item) ref.axis = item.axis === undefined ? undefined : (item.axis as string | null);
    if ("index" in item) ref.index = item.index === undefined ? undefined : (item.index as number | null);
    if (typeof item.confidence === "number") ref.confidence = item.confidence;
    if (item.metadata !== undefined) {
      if (!isRecord(item.metadata)) {
        issues.push({ path: `${path}[${i}].metadata`, message: "metadata must be an object" });
        return null;
      }
      const meta: Record<string, string | number | boolean | null> = {};
      for (const [mk, mv] of Object.entries(item.metadata)) {
        if (mv === null || typeof mv === "string" || typeof mv === "number" || typeof mv === "boolean") {
          meta[mk] = mv;
        } else {
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
export function parseExternalConversationInterpretation(
  input: unknown
): { ok: true; value: ConversationInterpretationV1 } | { ok: false; error: string; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, error: "root must be object", issues: [{ path: "", message: "root must be object" }] };
  }
  if (typeof input.intent !== "string") issues.push({ path: "intent", message: "string required" });
  if (typeof input.confidence !== "number") issues.push({ path: "confidence", message: "number required" });
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
  if (
    input.conversationStage !== undefined &&
    (typeof input.conversationStage !== "string" || !STAGE_SET.has(input.conversationStage))
  ) {
    issues.push({ path: "conversationStage", message: "invalid stage" });
  }
  if (input.notes !== undefined && (!Array.isArray(input.notes) || !input.notes.every((n) => typeof n === "string"))) {
    issues.push({ path: "notes", message: "string[] expected" });
  }
  if (
    input.activeOfferDigest !== undefined &&
    (typeof input.activeOfferDigest !== "string" || input.activeOfferDigest.length > 2000)
  ) {
    issues.push({ path: "activeOfferDigest", message: "string expected (max 2000)" });
  }
  if (
    input.closingGaps !== undefined &&
    (!Array.isArray(input.closingGaps) || !input.closingGaps.every((x) => typeof x === "string"))
  ) {
    issues.push({ path: "closingGaps", message: "string[] expected" });
  }
  if (input.memoryFactsDigest !== undefined && !isRecord(input.memoryFactsDigest)) {
    issues.push({ path: "memoryFactsDigest", message: "object expected" });
  }
  if (
    input.baselineLeadStage !== undefined &&
    (typeof input.baselineLeadStage !== "string" ||
      !["discovery", "consideration", "decision", "handoff"].includes(input.baselineLeadStage))
  ) {
    issues.push({ path: "baselineLeadStage", message: "invalid lead stage" });
  }
  if (
    input.baselineRecommendedAction !== undefined &&
    (typeof input.baselineRecommendedAction !== "string" || input.baselineRecommendedAction.length > 400)
  ) {
    issues.push({ path: "baselineRecommendedAction", message: "string expected" });
  }
  if (issues.length > 0 || !entities || !references || !Array.isArray(input.missingFields)) {
    return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join("; "), issues };
  }
  const value: ConversationInterpretationV1 = {
    intent: input.intent as string,
    confidence: input.confidence as number,
    entities,
    references,
    missingFields: input.missingFields as string[],
    nextAction: input.nextAction as ConversationNextActionV1,
    source: input.source as "rules" | "openai"
  };
  if (typeof input.conversationStage === "string" && STAGE_SET.has(input.conversationStage)) {
    value.conversationStage = input.conversationStage as ConversationStageV1;
  }
  if (Array.isArray(input.notes)) value.notes = input.notes as string[];
  if (typeof input.activeOfferDigest === "string" && input.activeOfferDigest.length <= 2000) {
    value.activeOfferDigest = input.activeOfferDigest;
  }
  if (Array.isArray(input.closingGaps) && input.closingGaps.every((x) => typeof x === "string")) {
    value.closingGaps = input.closingGaps as string[];
  }
  if (isRecord(input.memoryFactsDigest)) {
    const md: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(input.memoryFactsDigest)) {
      if (typeof k !== "string" || k.length > 64) continue;
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        md[k] = v as string | number | boolean | null;
      }
    }
    if (Object.keys(md).length > 0) value.memoryFactsDigest = md;
  }
  if (
    typeof input.baselineLeadStage === "string" &&
    ["discovery", "consideration", "decision", "handoff"].includes(input.baselineLeadStage)
  ) {
    value.baselineLeadStage = input.baselineLeadStage as ConversationInterpretationV1["baselineLeadStage"];
  }
  if (typeof input.baselineRecommendedAction === "string" && input.baselineRecommendedAction.length <= 400) {
    value.baselineRecommendedAction = input.baselineRecommendedAction;
  }
  return { ok: true, value };
}

function parseVerification(raw: unknown, path: string, issues: ValidationIssue[]): LlmDecisionV1["verification"] {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    issues.push({ path, message: "verification must be object" });
    return undefined;
  }
  const vIssues: ValidationIssue[] = [];
  if (typeof raw.passed !== "boolean") vIssues.push({ path: `${path}.passed`, message: "boolean required" });
  if (typeof raw.score !== "number") vIssues.push({ path: `${path}.score`, message: "number required" });
  if (!Array.isArray(raw.flags) || !raw.flags.every((f) => typeof f === "string")) {
    vIssues.push({ path: `${path}.flags`, message: "string[] required" });
  }
  if (typeof raw.reason !== "string") vIssues.push({ path: `${path}.reason`, message: "string required" });
  if (typeof raw.provider !== "string" || !VERIFIER_PROVIDERS.has(raw.provider)) {
    vIssues.push({ path: `${path}.provider`, message: "invalid provider" });
  }
  if (vIssues.length > 0) {
    issues.push(...vIssues);
    return undefined;
  }
  const v: NonNullable<LlmDecisionV1["verification"]> = {
    passed: raw.passed as boolean,
    score: raw.score as number,
    flags: raw.flags as string[],
    reason: raw.reason as string,
    provider: raw.provider as "llm-verifier" | "rules"
  };
  if (typeof raw.model === "string") v.model = raw.model;
  return v;
}

function parsePolicy(raw: unknown, path: string, issues: ValidationIssue[]): LlmDecisionV1["policy"] {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    issues.push({ path, message: "policy must be object" });
    return undefined;
  }
  const pIssues: ValidationIssue[] = [];
  const keys = [
    "recommendedAction",
    "executedAction",
    "shadowMode",
    "allowSensitiveActions"
  ] as const;
  for (const k of keys) {
    if (k === "recommendedAction" || k === "executedAction") {
      if (typeof raw[k] !== "string") pIssues.push({ path: `${path}.${k}`, message: "string required" });
    } else if (typeof raw[k] !== "boolean") {
      pIssues.push({ path: `${path}.${k}`, message: "boolean required" });
    }
  }
  if (pIssues.length > 0) {
    issues.push(...pIssues);
    return undefined;
  }
  const p: NonNullable<LlmDecisionV1["policy"]> = {
    recommendedAction: String(raw.recommendedAction),
    executedAction: String(raw.executedAction),
    shadowMode: Boolean(raw.shadowMode),
    allowSensitiveActions: Boolean(raw.allowSensitiveActions)
  };
  if (typeof raw.contextRecovered === "boolean") p.contextRecovered = raw.contextRecovered;
  if (typeof raw.verifierRequired === "boolean") p.verifierRequired = raw.verifierRequired;
  if (typeof raw.minVerifierScore === "number") p.minVerifierScore = raw.minVerifierScore;
  return p;
}

/**
 * Valida JSON externo contra `LlmDecisionV1`.
 */
export function parseExternalLlmDecision(
  input: unknown
): { ok: true; value: LlmDecisionV1 } | { ok: false; error: string; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, error: "root must be object", issues: [{ path: "", message: "root must be object" }] };
  }
  if (typeof input.intent !== "string") issues.push({ path: "intent", message: "string required" });
  if (typeof input.leadStage !== "string" || !LEAD_STAGE_SET.has(input.leadStage)) {
    issues.push({ path: "leadStage", message: "invalid leadStage" });
  }
  if (typeof input.confidence !== "number") issues.push({ path: "confidence", message: "number required" });
  const entities = parseLlmEntities(input.entities, "entities", issues);
  if (typeof input.nextAction !== "string" || !NEXT_ACTION_SET.has(input.nextAction)) {
    issues.push({ path: "nextAction", message: "invalid nextAction" });
  }
  if (typeof input.reason !== "string") issues.push({ path: "reason", message: "string required" });
  if (typeof input.requiresHuman !== "boolean") issues.push({ path: "requiresHuman", message: "boolean required" });
  if (input.policyBand !== undefined && (typeof input.policyBand !== "string" || !POLICY_BANDS.has(input.policyBand))) {
    issues.push({ path: "policyBand", message: "invalid policyBand" });
  }
  if (
    input.executionMode !== undefined &&
    (typeof input.executionMode !== "string" || !EXEC_MODES.has(input.executionMode))
  ) {
    issues.push({ path: "executionMode", message: "invalid executionMode" });
  }
  if (typeof input.recommendedAction !== "string") issues.push({ path: "recommendedAction", message: "string required" });
  if (typeof input.draftReply !== "string") issues.push({ path: "draftReply", message: "string required" });
  if (typeof input.handoffRequired !== "boolean") issues.push({ path: "handoffRequired", message: "boolean required" });
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
  const value: LlmDecisionV1 = {
    intent: input.intent as string,
    leadStage: input.leadStage as LlmDecisionV1["leadStage"],
    confidence: input.confidence as number,
    entities,
    nextAction: input.nextAction as ConversationNextActionV1,
    reason: input.reason as string,
    requiresHuman: input.requiresHuman as boolean,
    recommendedAction: input.recommendedAction as string,
    draftReply: input.draftReply as string,
    handoffRequired: input.handoffRequired as boolean,
    qualityFlags: input.qualityFlags as string[],
    source: input.source as "llm" | "fallback"
  };
  if (typeof input.policyBand === "string" && POLICY_BANDS.has(input.policyBand)) {
    value.policyBand = input.policyBand as LlmDecisionV1["policyBand"];
  }
  if (typeof input.executionMode === "string" && EXEC_MODES.has(input.executionMode)) {
    value.executionMode = input.executionMode as "shadow" | "active";
  }
  if (policy) value.policy = policy;
  if (verification) value.verification = verification;
  if (typeof input.provider === "string" && PROVIDERS.has(input.provider)) {
    value.provider = input.provider as LlmDecisionV1["provider"];
  }
  if (typeof input.model === "string") value.model = input.model;
  return { ok: true, value };
}

export type ShadowCompareCandidateDecision = {
  draftReply?: string;
  intent?: string;
  nextAction?: ConversationNextActionV1;
  recommendedAction?: string;
  confidence?: number;
  reason?: string;
};

export type ShadowCompareHttpResponse = {
  candidateDecision?: ShadowCompareCandidateDecision;
  candidateInterpretation?: Partial<ConversationInterpretationV1>;
};

function parseNextActionOptional(raw: unknown, path: string, issues: ValidationIssue[]): ConversationNextActionV1 | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !NEXT_ACTION_SET.has(raw)) {
    issues.push({ path, message: "invalid optional nextAction" });
    return undefined;
  }
  return raw as ConversationNextActionV1;
}

/**
 * Respuesta esperada del POST `LLM_SHADOW_COMPARE_URL` (campos opcionales para no forzar un contrato rígido al comparar).
 */
export function parseShadowCompareHttpResponse(
  input: unknown
): { ok: true; value: ShadowCompareHttpResponse } | { ok: false; error: string; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, error: "root must be object", issues: [{ path: "", message: "root must be object" }] };
  }
  const value: ShadowCompareHttpResponse = {};
  if (input.candidateDecision !== undefined) {
    if (!isRecord(input.candidateDecision)) {
      issues.push({ path: "candidateDecision", message: "must be object" });
    } else {
      const c = input.candidateDecision;
      const cand: ShadowCompareCandidateDecision = {};
      if (c.draftReply !== undefined) {
        if (typeof c.draftReply !== "string") issues.push({ path: "candidateDecision.draftReply", message: "string" });
        else cand.draftReply = c.draftReply;
      }
      if (c.intent !== undefined) {
        if (typeof c.intent !== "string") issues.push({ path: "candidateDecision.intent", message: "string" });
        else cand.intent = c.intent;
      }
      const na = parseNextActionOptional(c.nextAction, "candidateDecision.nextAction", issues);
      if (na !== undefined) cand.nextAction = na;
      if (c.recommendedAction !== undefined) {
        if (typeof c.recommendedAction !== "string") {
          issues.push({ path: "candidateDecision.recommendedAction", message: "string" });
        } else cand.recommendedAction = c.recommendedAction;
      }
      if (c.confidence !== undefined) {
        if (typeof c.confidence !== "number") issues.push({ path: "candidateDecision.confidence", message: "number" });
        else cand.confidence = c.confidence;
      }
      if (c.reason !== undefined) {
        if (typeof c.reason !== "string") issues.push({ path: "candidateDecision.reason", message: "string" });
        else cand.reason = c.reason;
      }
      if (Object.keys(cand).length > 0) value.candidateDecision = cand;
    }
  }
  if (input.candidateInterpretation !== undefined) {
    if (!isRecord(input.candidateInterpretation)) {
      issues.push({ path: "candidateInterpretation", message: "must be object" });
    } else {
      const interpIssues: ValidationIssue[] = [];
      const partial = input.candidateInterpretation as Partial<ConversationInterpretationV1>;
      if (partial.source !== undefined && !INTERP_SOURCES.has(partial.source)) {
        interpIssues.push({ path: "candidateInterpretation.source", message: "rules | openai" });
      }
      if (
        partial.nextAction !== undefined &&
        (typeof partial.nextAction !== "string" || !NEXT_ACTION_SET.has(partial.nextAction))
      ) {
        interpIssues.push({ path: "candidateInterpretation.nextAction", message: "invalid nextAction" });
      }
      if (
        partial.conversationStage !== undefined &&
        (typeof partial.conversationStage !== "string" || !STAGE_SET.has(partial.conversationStage))
      ) {
        interpIssues.push({ path: "candidateInterpretation.conversationStage", message: "invalid stage" });
      }
      if (interpIssues.length > 0) issues.push(...interpIssues);
      else value.candidateInterpretation = partial;
    }
  }
  if (issues.length > 0) {
    return { ok: false, error: issues.map((i) => `${i.path}: ${i.message}`).join("; "), issues };
  }
  return { ok: true, value };
}

export function summarizeDecisionDiff(
  baseline: Pick<LlmDecisionV1, "draftReply" | "intent" | "nextAction" | "confidence" | "recommendedAction">,
  candidate: ShadowCompareCandidateDecision
): Record<string, string | boolean | number | null> {
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
export const conversationInterpretationV1JsonSchema = {
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
} as const;

/**
 * JSON Schema (draft-07) equivalente a `LlmDecisionV1` para herramientas externas.
 */
export const llmDecisionV1JsonSchema = {
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
} as const;
