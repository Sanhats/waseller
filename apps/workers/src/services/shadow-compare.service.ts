import { prisma } from "../../../../packages/db/src";
import {
  JOB_SCHEMA_VERSION,
  parseShadowCompareHttpResponse,
  summarizeDecisionDiff,
  type ActiveOfferV1,
  type ConversationInterpretationV1,
  type ConversationReferenceV1,
  type ConversationStageV1,
  type LlmDecisionV1,
  type ShadowCompareCandidateDecision,
  type ValidationIssue
} from "../../../../packages/queue/src";
import { injectLastOutgoingMessageForCrew } from "./conversation-recent-messages.service";
import { toCrewBusinessProfileSlug } from "../../../../packages/shared/src/crew-business-profile-slug";
import type { TenantBusinessProfile } from "../../../../packages/shared/src/tenant-business-profile";

export type ShadowCompareRecentMessageV1 = {
  direction: "incoming" | "outgoing";
  message: string;
};

/**
 * Resumen del tenant para waseller-crew (`tenantBrief` en el POST). Campos opcionales; el crew usa `extra="ignore"` si no los implementa aún.
 */
export type CrewTenantBriefV1 = {
  businessName?: string;
  businessCategory?: string;
  businessLabels?: string[];
  tone?: string;
  deliveryInfo?: string;
  /** ISO 8601; última actualización de `tenant_knowledge` en Waseller. */
  knowledgeUpdatedAt?: string;
  payment?: {
    methods: string[];
    acceptsInstallments?: boolean;
    /** No se envía el alias; solo si está configurado. */
    transferAliasConfigured?: boolean;
  };
  shipping?: { methods: string[]; zones: string[]; sameDay: boolean };
  policy?: {
    reservationTtlMinutes?: number;
    supportHours?: string;
    notes?: string;
    allowExchange?: boolean;
    allowReturns?: boolean;
  };
};

/** Construye el bloque enviado a waseller-crew a partir del perfil normalizado (sin secretos). */
export function buildCrewTenantBriefFromProfile(
  profile: TenantBusinessProfile,
  meta?: { knowledgeUpdatedAt?: string }
): CrewTenantBriefV1 {
  const brief: CrewTenantBriefV1 = {
    businessName: profile.businessName,
    businessCategory: profile.businessCategory,
    businessLabels: profile.businessLabels?.length ? [...profile.businessLabels] : undefined,
    tone: profile.tone,
    deliveryInfo: profile.deliveryInfo,
    knowledgeUpdatedAt: meta?.knowledgeUpdatedAt,
    payment: {
      methods: [...(profile.payment?.methods ?? [])],
      acceptsInstallments: profile.payment?.acceptsInstallments,
      transferAliasConfigured: Boolean(String(profile.payment?.transferAlias ?? "").trim())
    },
    shipping: {
      methods: [...(profile.shipping?.methods ?? [])],
      zones: [...(profile.shipping?.zones ?? [])],
      sameDay: Boolean(profile.shipping?.sameDay)
    },
    policy: {
      reservationTtlMinutes: profile.policy?.reservationTtlMinutes,
      supportHours: profile.policy?.supportHours,
      notes: profile.policy?.notes,
      allowExchange: profile.policy?.allowExchange,
      allowReturns: profile.policy?.allowReturns
    }
  };
  if (brief.payment?.methods?.length === 0 && !brief.payment?.acceptsInstallments && !brief.payment?.transferAliasConfigured) {
    delete brief.payment;
  }
  if (
    brief.shipping &&
    brief.shipping.methods.length === 0 &&
    brief.shipping.zones.length === 0 &&
    !brief.shipping.sameDay
  ) {
    delete brief.shipping;
  }
  return brief;
}

/** Misma forma que `GET /products` / tabla de stock del dashboard (`StockProductVariantRow`). */
export type ShadowCompareStockRowV1 = {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  attributes: Record<string, string>;
  stock: number;
  reservedStock: number;
  availableStock: number;
  effectivePrice: number;
  imageUrl?: string | null;
  isActive: boolean;
  tags: string[];
  basePrice: number | null;
  variantPrice: number | null;
};

function readNumericEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampStr(s: string, max: number): string {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function slimCrewTenantBriefForHttp(b: CrewTenantBriefV1): CrewTenantBriefV1 {
  const maxName = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_BRIEF_NAME_CHARS", 120);
  const maxDelivery = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_BRIEF_DELIVERY_CHARS", 900);
  const maxNotes = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_BRIEF_POLICY_NOTES_CHARS", 480);
  const maxHours = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_BRIEF_SUPPORT_HOURS_CHARS", 160);
  const maxTone = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_BRIEF_TONE_CHARS", 48);
  const maxLabels = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_BRIEF_LABELS", 16);
  const out: CrewTenantBriefV1 = {
    ...b,
    businessName: b.businessName ? clampStr(b.businessName, maxName) : undefined,
    tone: b.tone ? clampStr(b.tone, maxTone) : undefined,
    deliveryInfo: b.deliveryInfo ? clampStr(b.deliveryInfo, maxDelivery) : undefined,
    businessLabels: b.businessLabels?.slice(0, maxLabels)
  };
  if (b.policy) {
    out.policy = {
      ...b.policy,
      supportHours: b.policy.supportHours ? clampStr(b.policy.supportHours, maxHours) : undefined,
      notes: b.policy.notes ? clampStr(b.policy.notes, maxNotes) : undefined
    };
  }
  if (b.shipping?.zones?.length) {
    out.shipping = {
      ...b.shipping,
      zones: b.shipping.zones.slice(0, 12).map((z) => clampStr(z, 80))
    };
  }
  return out;
}

function crewTenantBriefHasSignal(b: CrewTenantBriefV1): boolean {
  if (b.businessName || b.businessCategory || b.tone || b.deliveryInfo || b.knowledgeUpdatedAt) return true;
  if (b.businessLabels && b.businessLabels.length > 0) return true;
  if (b.payment?.methods?.length) return true;
  if (b.payment?.transferAliasConfigured || b.payment?.acceptsInstallments) return true;
  if (b.shipping && (b.shipping.methods.length > 0 || b.shipping.zones.length > 0 || b.shipping.sameDay)) return true;
  if (b.policy && Object.keys(b.policy).length > 0) return true;
  return false;
}

/**
 * Texto plano para overlay junto a `tenant_prompts/<businessProfileSlug>.txt` en waseller-crew.
 * Misma fuente que `tenantBrief` (objeto estructurado); el crew puede preferir este campo para inyectar en el prompt.
 */
function buildTenantCommercialContextFromBrief(b: CrewTenantBriefV1): string {
  const lines: string[] = [];
  if (b.businessName) lines.push(`Nombre del negocio: ${b.businessName}`);
  if (b.businessCategory) lines.push(`Categoría (Waseller): ${b.businessCategory}`);
  if (b.businessLabels?.length) lines.push(`Etiquetas: ${b.businessLabels.join(", ")}`);
  if (b.tone) lines.push(`Tono sugerido: ${b.tone}`);
  if (b.deliveryInfo) lines.push(`Entregas / logística: ${b.deliveryInfo}`);
  if (b.payment?.methods?.length) {
    lines.push(`Medios de pago: ${b.payment.methods.join(", ")}`);
    if (b.payment.acceptsInstallments) lines.push("Cuotas: sí");
    if (b.payment.transferAliasConfigured) lines.push("Alias transferencia: configurado (valor no enviado en API)");
  }
  if (b.shipping) {
    const bits: string[] = [];
    if (b.shipping.methods.length) bits.push(`métodos: ${b.shipping.methods.join(", ")}`);
    if (b.shipping.zones.length) bits.push(`zonas: ${b.shipping.zones.join(", ")}`);
    if (b.shipping.sameDay) bits.push("mismo día: sí");
    if (bits.length) lines.push(`Envíos: ${bits.join("; ")}`);
  }
  if (b.policy) {
    const p = b.policy;
    if (p.reservationTtlMinutes != null) lines.push(`Reserva (TTL min): ${p.reservationTtlMinutes}`);
    if (p.supportHours) lines.push(`Horario atención: ${p.supportHours}`);
    if (p.notes) lines.push(`Notas políticas: ${p.notes}`);
    lines.push(`Cambios: ${p.allowExchange ? "sí" : "no"} | Devoluciones: ${p.allowReturns ? "sí" : "no"}`);
  }
  if (b.knowledgeUpdatedAt) lines.push(`Perfil actualizado (ISO): ${b.knowledgeUpdatedAt}`);
  return lines.join("\n");
}

function activeOfferHasSignal(offer: ActiveOfferV1 | null | undefined): boolean {
  if (!offer) return false;
  return Boolean(
    (offer.productName && offer.productName.trim()) ||
      (offer.variantId && String(offer.variantId).trim()) ||
      (offer.attributes && Object.keys(offer.attributes).length > 0) ||
      offer.price != null ||
      offer.availableStock != null ||
      (offer.alternativeVariants && offer.alternativeVariants.length > 0) ||
      (offer.expectedCustomerAction && offer.expectedCustomerAction.trim())
  );
}

/** Objeto `activeOffer` en raíz del POST (paridad con waseller-crew / ShadowCompareRequest). */
function slimActiveOfferForCrewRoot(offer: ActiveOfferV1): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (offer.productName?.trim()) out.productName = clampStr(offer.productName.trim(), 200);
  if (offer.variantId?.trim()) out.variantId = String(offer.variantId).trim();
  if (offer.attributes && Object.keys(offer.attributes).length > 0) {
    const attrs: Record<string, string> = {};
    let ak = 0;
    for (const [k, v] of Object.entries(offer.attributes)) {
      if (ak++ >= 16) break;
      attrs[clampStr(k, 40)] = clampStr(String(v), 120);
    }
    out.attributes = attrs;
  }
  if (offer.price != null && Number.isFinite(Number(offer.price))) out.price = Number(offer.price);
  if (offer.availableStock != null && Number.isFinite(Number(offer.availableStock))) {
    out.availableStock = Number(offer.availableStock);
  }
  if (offer.expectedCustomerAction?.trim()) {
    out.expectedCustomerAction = clampStr(offer.expectedCustomerAction.trim(), 280);
  }
  if (offer.alternativeVariants?.length) {
    out.alternativeVariants = offer.alternativeVariants.slice(0, 12).map((av) => ({
      variantId: av.variantId?.trim() ? String(av.variantId).trim() : null,
      attributes: Object.fromEntries(
        Object.entries(av.attributes ?? {})
          .slice(0, 8)
          .map(([k, vv]) => [clampStr(k, 40), clampStr(String(vv), 80)])
      ),
      availableStock:
        av.availableStock != null && Number.isFinite(Number(av.availableStock))
          ? Number(av.availableStock)
          : null
    }));
  }
  return out;
}

/** Hasta 40 líneas ≤400 caracteres (contrato crew); entrada: hechos en memoria del lead. */
function memoryFactsRecordToStringArray(facts: Record<string, unknown>, maxLines: number, maxLineLen: number): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(facts ?? {})) {
    if (out.length >= maxLines) break;
    const key = clampStr(k, 80).trim();
    if (!key) continue;
    let val: string;
    if (v === null || typeof v === "number" || typeof v === "boolean") val = String(v);
    else if (typeof v === "string") val = v;
    else val = JSON.stringify(v);
    const line = clampStr(`${key}: ${val}`, maxLineLen);
    if (line.trim()) out.push(line);
  }
  return out;
}

function summarizeActiveOfferForCrew(offer: ActiveOfferV1 | null | undefined): string | undefined {
  if (!offer) return undefined;
  const parts: string[] = [];
  if (offer.productName) parts.push(`Producto: ${offer.productName}`);
  if (offer.variantId) parts.push(`variantId: ${offer.variantId}`);
  if (offer.attributes && Object.keys(offer.attributes).length > 0) {
    const attrs = Object.entries(offer.attributes)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    parts.push(`Atributos: ${attrs}`.slice(0, 420));
  }
  if (offer.price != null && Number.isFinite(Number(offer.price))) parts.push(`Precio ref.: ${offer.price}`);
  if (offer.availableStock != null && Number.isFinite(Number(offer.availableStock))) {
    parts.push(`Stock ref.: ${offer.availableStock}`);
  }
  if (offer.expectedCustomerAction?.trim()) {
    parts.push(`Acción esperada del cliente: ${offer.expectedCustomerAction.trim()}`);
  }
  if (offer.alternativeVariants?.length) {
    parts.push(`Alternativas con stock: ${offer.alternativeVariants.length}`);
  }
  const s = parts.join(" · ");
  return s.length > 0 ? s : undefined;
}

function slimMemoryFactsForCrewDigest(
  facts: Record<string, unknown>,
  maxKeys: number,
  maxVal: number
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  let c = 0;
  for (const [k, v] of Object.entries(facts ?? {})) {
    if (c++ >= maxKeys) break;
    const key = clampStr(k, 72);
    if (!key) continue;
    if (v === null || typeof v === "number" || typeof v === "boolean") {
      out[key] = v;
    } else if (typeof v === "string") {
      out[key] = clampStr(v, maxVal);
    } else if (typeof v === "object") {
      out[key] = clampStr(JSON.stringify(v), maxVal);
    }
  }
  return out;
}

function deriveClosingGapsForCrew(
  i: ConversationInterpretationV1,
  offer: ActiveOfferV1 | null | undefined,
  baseline: LlmDecisionV1
): string[] {
  const gaps = new Set<string>();
  for (const m of i.missingFields ?? []) {
    const s = String(m).trim();
    if (s) gaps.add(`Pendiente: ${s}`);
  }
  if (offer?.expectedCustomerAction?.trim()) {
    gaps.add(`Cliente: ${offer.expectedCustomerAction.trim()}`);
  }
  if (offer && (!offer.variantId || !String(offer.variantId).trim()) && (i.missingFields?.length ?? 0) > 0) {
    gaps.add("Confirmar variante / combinación para cotizar");
  }
  if (baseline.requiresHuman) gaps.add("Baseline: requiresHuman");
  if (baseline.handoffRequired) gaps.add("Baseline: handoffRequired");
  const na = String(baseline.nextAction ?? "").trim();
  const ra = String(baseline.recommendedAction ?? "").trim();
  if (na && ra && na !== ra) {
    gaps.add(`Política: nextAction=${na} vs recommendedAction=${ra}`);
  }
  return Array.from(gaps);
}

function buildRichInterpretationForShadowCompare(input: ShadowCompareInput): ConversationInterpretationV1 {
  const i = input.interpretation;
  const stage = (input.conversationStage ?? i.conversationStage) as ConversationStageV1 | undefined;
  const digest = summarizeActiveOfferForCrew(input.activeOffer ?? null);
  const gaps = deriveClosingGapsForCrew(i, input.activeOffer ?? null, input.baselineDecision);
  const maxMemKeys = Math.max(4, Math.min(32, Number(process.env.LLM_SHADOW_COMPARE_MAX_MEMORY_FACT_KEYS ?? 18)));
  const maxMemVal = Math.max(80, Math.min(600, Number(process.env.LLM_SHADOW_COMPARE_MAX_MEMORY_FACT_VALUE_CHARS ?? 280)));
  const mem =
    input.memoryFacts && Object.keys(input.memoryFacts).length > 0
      ? slimMemoryFactsForCrewDigest(input.memoryFacts, maxMemKeys, maxMemVal)
      : undefined;
  const ra = String(input.baselineDecision.recommendedAction ?? "").trim();
  return {
    ...i,
    conversationStage: stage ?? i.conversationStage,
    activeOfferDigest: digest,
    closingGaps: gaps.length > 0 ? gaps : undefined,
    memoryFactsDigest: mem && Object.keys(mem).length > 0 ? mem : undefined,
    baselineLeadStage: input.baselineDecision.leadStage,
    baselineRecommendedAction: ra || undefined
  };
}

/** Reduce tokens en waseller-crew: truncar textos y quitar campos pesados del JSON HTTP. */
function slimInterpretationForCrewHttp(i: ConversationInterpretationV1): ConversationInterpretationV1 {
  const maxRef = readNumericEnv("LLM_SHADOW_COMPARE_MAX_REFERENCES", 8);
  const maxNotes = readNumericEnv("LLM_SHADOW_COMPARE_MAX_NOTES", 5);
  const maxEntityStr = readNumericEnv("LLM_SHADOW_COMPARE_MAX_ENTITY_VALUE_CHARS", 320);
  const maxMissing = readNumericEnv("LLM_SHADOW_COMPARE_MAX_MISSING_FIELDS", 14);
  const maxEntityKeys = readNumericEnv("LLM_SHADOW_COMPARE_MAX_ENTITY_KEYS", 28);
  const maxOfferDigest = readNumericEnv("LLM_SHADOW_COMPARE_MAX_ACTIVE_OFFER_DIGEST_CHARS", 560);
  const maxClosing = readNumericEnv("LLM_SHADOW_COMPARE_MAX_CLOSING_GAPS", 12);
  const maxClosingItem = readNumericEnv("LLM_SHADOW_COMPARE_MAX_CLOSING_GAP_ITEM_CHARS", 200);
  const maxMemDigestKeys = readNumericEnv("LLM_SHADOW_COMPARE_MAX_MEMORY_DIGEST_KEYS", 20);
  const maxMemDigestVal = readNumericEnv("LLM_SHADOW_COMPARE_MAX_MEMORY_DIGEST_VALUE_CHARS", 260);

  const entities: ConversationInterpretationV1["entities"] = {};
  let ek = 0;
  for (const [k, v] of Object.entries(i.entities ?? {})) {
    if (ek++ >= maxEntityKeys) break;
    if (typeof v === "string") {
      entities[k] = clampStr(v, maxEntityStr);
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const sub: Record<string, string> = {};
      let skc = 0;
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (skc++ >= 12) break;
        sub[sk] = typeof sv === "string" ? clampStr(sv, 120) : String(sv ?? "").slice(0, 80);
      }
      entities[k] = sub;
    } else {
      (entities as Record<string, string | number | boolean | null | Record<string, string>>)[k] = v as
        | string
        | number
        | boolean
        | null;
    }
  }

  const references: ConversationReferenceV1[] = (i.references ?? []).slice(0, maxRef).map((r) => ({
    ...r,
    value:
      r.value != null && String(r.value).length > 140 ? `${String(r.value).slice(0, 140)}…` : r.value,
    metadata:
      r.metadata && Object.keys(r.metadata).length > 8
        ? Object.fromEntries(Object.entries(r.metadata).slice(0, 8))
        : r.metadata
  }));

  const out: ConversationInterpretationV1 = {
    ...i,
    entities,
    references,
    notes: i.notes?.slice(0, maxNotes),
    missingFields: (i.missingFields ?? []).slice(0, maxMissing)
  };
  if (i.activeOfferDigest?.trim()) {
    out.activeOfferDigest = clampStr(i.activeOfferDigest, maxOfferDigest);
  } else {
    delete out.activeOfferDigest;
  }
  if (i.closingGaps?.length) {
    out.closingGaps = i.closingGaps
      .slice(0, maxClosing)
      .map((g) => clampStr(String(g), maxClosingItem))
      .filter(Boolean);
  } else {
    delete out.closingGaps;
  }
  if (i.memoryFactsDigest && typeof i.memoryFactsDigest === "object") {
    const slimmed = slimMemoryFactsForCrewDigest(
      i.memoryFactsDigest as Record<string, unknown>,
      maxMemDigestKeys,
      maxMemDigestVal
    );
    if (Object.keys(slimmed).length > 0) out.memoryFactsDigest = slimmed;
    else delete out.memoryFactsDigest;
  } else {
    delete out.memoryFactsDigest;
  }
  if (i.baselineLeadStage) out.baselineLeadStage = i.baselineLeadStage;
  else delete out.baselineLeadStage;
  if (i.baselineRecommendedAction?.trim()) {
    out.baselineRecommendedAction = clampStr(i.baselineRecommendedAction, 200);
  } else {
    delete out.baselineRecommendedAction;
  }
  return out;
}

function slimDecisionEntities(entities: LlmDecisionV1["entities"]): LlmDecisionV1["entities"] {
  const out: LlmDecisionV1["entities"] = {};
  let c = 0;
  const maxKeys = readNumericEnv("LLM_SHADOW_COMPARE_MAX_BASELINE_ENTITY_KEYS", 24);
  const maxVal = readNumericEnv("LLM_SHADOW_COMPARE_MAX_BASELINE_ENTITY_VALUE_CHARS", 280);
  for (const [k, v] of Object.entries(entities ?? {})) {
    if (c++ >= maxKeys) break;
    if (typeof v === "string") out[k] = clampStr(v, maxVal);
    else out[k] = v;
  }
  return out;
}

function slimBaselineForCrewHttp(d: LlmDecisionV1): LlmDecisionV1 {
  const maxDraft = readNumericEnv("LLM_SHADOW_COMPARE_MAX_DRAFT_CHARS", 1400);
  const maxReason = readNumericEnv("LLM_SHADOW_COMPARE_MAX_REASON_CHARS", 420);
  const { verification, ...rest } = d;
  return {
    ...rest,
    draftReply: clampStr(rest.draftReply ?? "", maxDraft),
    reason: clampStr(rest.reason ?? "", maxReason),
    entities: slimDecisionEntities(rest.entities),
    qualityFlags: (rest.qualityFlags ?? []).slice(0, 16),
    verification: verification
      ? {
          passed: verification.passed,
          score: verification.score,
          flags: (verification.flags ?? []).slice(0, 8),
          reason: clampStr(verification.reason ?? "", 200),
          provider: verification.provider,
          model: verification.model
        }
      : undefined,
    policy: rest.policy
      ? {
          recommendedAction: rest.policy.recommendedAction,
          executedAction: rest.policy.executedAction,
          shadowMode: rest.policy.shadowMode,
          allowSensitiveActions: rest.policy.allowSensitiveActions,
          contextRecovered: rest.policy.contextRecovered,
          verifierRequired: rest.policy.verifierRequired,
          minVerifierScore: rest.policy.minVerifierScore
        }
      : undefined
  };
}

/** Filas más livianas para el POST (sin tags/imagen por defecto). */
function slimStockRowsForCrewHttp(rows: ShadowCompareStockRowV1[]): Record<string, unknown>[] {
  const includeImage = /^(1|true|yes)$/i.test(
    String(process.env.LLM_SHADOW_COMPARE_INCLUDE_STOCK_IMAGE_URL ?? "").trim()
  );
  const maxName = readNumericEnv("LLM_SHADOW_COMPARE_MAX_STOCK_NAME_CHARS", 120);
  const maxSku = readNumericEnv("LLM_SHADOW_COMPARE_MAX_STOCK_SKU_CHARS", 64);
  const maxAttr = readNumericEnv("LLM_SHADOW_COMPARE_MAX_STOCK_ATTR_KEYS", 12);
  const maxAttrVal = readNumericEnv("LLM_SHADOW_COMPARE_MAX_STOCK_ATTR_VALUE_CHARS", 80);
  return rows.map((r) => {
    const attrs = Object.fromEntries(
      Object.entries(r.attributes).slice(0, maxAttr).map(([k, v]) => [k, clampStr(v, maxAttrVal)])
    );
    const row: Record<string, unknown> = {
      variantId: r.variantId,
      productId: r.productId,
      name: clampStr(r.name, maxName),
      sku: clampStr(r.sku, maxSku),
      attributes: attrs,
      stock: r.stock,
      reservedStock: r.reservedStock,
      availableStock: r.availableStock,
      effectivePrice: r.effectivePrice,
      isActive: r.isActive,
      basePrice: r.basePrice,
      variantPrice: r.variantPrice
    };
    if (includeImage && r.imageUrl) row.imageUrl = r.imageUrl;
    return row;
  });
}

const normalizeShadowStockAttributes = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  return Object.fromEntries(entries);
};

type StockRowRaw = {
  variantId: string;
  productId: string;
  name: string;
  basePrice: unknown;
  variantPrice: unknown;
  effectivePrice: unknown;
  sku: string;
  attributes: unknown;
  stock: number;
  reservedStock: number;
  availableStock: number;
  imageUrl?: string | null;
  tags?: string[] | null;
  isActive: boolean;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ShadowStockLoadScope = "single_product" | "multi_rag" | "none";

type ShadowStockLoadResult = {
  rows: ShadowCompareStockRowV1[];
  scope: ShadowStockLoadScope;
  ragProductIdsTried: string[];
};

function sanitizeUuidProductIds(ids: unknown[] | null | undefined, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids ?? []) {
    const t = String(id ?? "").trim();
    if (!UUID_RE.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function mapStockRows(rows: StockRowRaw[]): ShadowCompareStockRowV1[] {
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

async function queryVariantsForProduct(
  tenantId: string,
  productId: string,
  rowLimit: number
): Promise<ShadowCompareStockRowV1[]> {
  const pid = String(productId).trim();
  if (!UUID_RE.test(pid)) return [];
  const rows = (await (prisma as any).$queryRaw`
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
  `) as StockRowRaw[];
  return mapStockRows(rows);
}

async function loadStockTableBundle(
  tenantId: string,
  singleProductId: string | null | undefined,
  ragProductIds: string[] | null | undefined
): Promise<ShadowStockLoadResult> {
  const single = singleProductId && String(singleProductId).trim();
  if (single && UUID_RE.test(single)) {
    const rows = await queryVariantsForProduct(tenantId, single, 500);
    return { rows, scope: "single_product", ragProductIdsTried: [] };
  }
  const ragRowLimit = Math.max(
    5,
    Math.min(100, Number(process.env.LLM_SHADOW_COMPARE_STOCK_RAG_ROW_LIMIT ?? 30))
  );
  const ragIds = sanitizeUuidProductIds(ragProductIds ?? [], 8);
  if (ragIds.length === 0) {
    return { rows: [], scope: "none", ragProductIdsTried: [] };
  }
  const combined: ShadowCompareStockRowV1[] = [];
  const seen = new Set<string>();
  for (const pid of ragIds) {
    const chunk = await queryVariantsForProduct(tenantId, pid, ragRowLimit);
    for (const r of chunk) {
      if (seen.has(r.variantId)) continue;
      seen.add(r.variantId);
      combined.push(r);
      if (combined.length >= ragRowLimit) break;
    }
    if (combined.length >= ragRowLimit) break;
  }
  return {
    rows: combined.slice(0, ragRowLimit),
    scope: "multi_rag",
    ragProductIdsTried: ragIds
  };
}

function buildInventoryNarrowingNote(input: {
  scope: ShadowStockLoadScope;
  rowCount: number;
  stockTableProductId?: string | null;
  ragProductIdsTried: string[];
  ragRowCap: number;
}): string {
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
export function extractInterpretationProductId(interpreted: ConversationInterpretationV1): string | null {
  const pid = interpreted.entities?.productId;
  if (typeof pid === "string" && UUID_RE.test(pid.trim())) return pid.trim();
  return null;
}

/** Resuelve el producto de una variante para acotar `stockTable` al mismo alcance que el lead worker (hermanas). */
export async function resolveProductIdForTenantVariant(
  tenantId: string,
  variantId: string
): Promise<string | null> {
  const vid = String(variantId ?? "").trim();
  if (!vid) return null;
  const rows = (await (prisma as any).$queryRaw`
    select p.id as "productId"
    from public.product_variants v
    inner join public.products p on p.id = v.product_id
    where v.tenant_id::text = ${tenantId}
      and v.id::text = ${vid}
    limit 1
  `) as Array<{ productId: string }>;
  return rows[0]?.productId ?? null;
}

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
  /**
   * Rubro / categoría de negocio (`tenant_knowledge.business_category`).
   * Se mapea a `businessProfileSlug` del crew cuando aplica (p. ej. `hogar_deco` → `muebles_deco`).
   */
  tenantBusinessCategory?: string;
  /**
   * Variantes del mismo producto (activas, stock > 0). Tiene prioridad sobre `stockTableRagProductIds`.
   */
  stockTableProductId?: string | null;
  /**
   * Productos candidatos (p. ej. RAG por nombre) cuando no hay `stockTableProductId`: hasta 8 IDs, máx. filas según `LLM_SHADOW_COMPARE_STOCK_RAG_ROW_LIMIT` (default 30).
   */
  stockTableRagProductIds?: string[] | null;
  /** Resumen comercial del tenant (tono, envíos, políticas) para waseller-crew. */
  tenantBrief?: CrewTenantBriefV1 | null;
  /** Oferta activa (orquestador / lead) para enriquecer `interpretation` en el POST. */
  activeOffer?: ActiveOfferV1 | null;
  /** Hechos de memoria (solo orquestador) para digest en `interpretation`. */
  memoryFacts?: Record<string, unknown>;
  /** Etapa del pipeline Waseller (refuerza `interpretation.conversationStage` si falta). */
  conversationStage?: ConversationStageV1;
};

const readShadowCompareSecret = (): string =>
  String(process.env.LLM_SHADOW_COMPARE_SECRET ?? process.env.SHADOW_COMPARE_SECRET ?? "").trim();

/**
 * Origen público del storefront **sin barra final** (mismo host que sirve `/tienda/<slug>`).
 * `PUBLIC_CATALOG_BASE_URL` tiene prioridad; si falta, `PUBLIC_API_BASE_URL` (p. ej. dashboard Vercel).
 */
export function resolvePublicCatalogBaseUrlForCrew(): string | null {
  const raw = String(
    process.env.PUBLIC_CATALOG_BASE_URL ?? process.env.PUBLIC_API_BASE_URL ?? ""
  )
    .trim()
    .replace(/\/+$/, "");
  return raw.length > 0 ? raw : null;
}

async function loadPublicCatalogFieldsForCrewPayload(
  tenantId: string
): Promise<{ publicCatalogSlug: string; publicCatalogBaseUrl: string } | null> {
  const tid = String(tenantId ?? "").trim();
  if (!tid) return null;
  const publicCatalogBaseUrl = resolvePublicCatalogBaseUrlForCrew();
  if (!publicCatalogBaseUrl) return null;
  try {
    const row = await prisma.tenant.findUnique({
      where: { id: tid },
      select: { publicCatalogSlug: true }
    });
    const slug = typeof row?.publicCatalogSlug === "string" ? row.publicCatalogSlug.trim() : "";
    if (!slug) return null;
    return { publicCatalogSlug: slug, publicCatalogBaseUrl };
  } catch {
    return null;
  }
}

/**
 * Snapshot ordenado de la fila `tenants` + `tenant_knowledge` + integraciones de pago (solo `provider`/`status`),
 * para que waseller-crew orqueste sin depender de lectura directa de la BD de Waseller.
 * **No** incluye tokens ni `tenant_knowledge.profile` JSON completo (eso sigue en `tenantBrief` cuando el caller lo arma).
 */
export type CrewTenantRuntimeContextV1 = {
  version: 1;
  identity: { tenantId: string; displayName: string; plan: string };
  knowledge: {
    businessCategory: string;
    businessLabels: string[];
    profileUpdatedAt?: string;
  };
  llm: {
    assistEnabled: boolean;
    confidenceThreshold: number;
    guardrailsStrict: boolean;
    rolloutPercent: number;
    modelName: string;
  };
  outboundMessaging: {
    senderRateMs: number;
    senderPauseEvery: number;
    senderPauseMs: number;
  };
  catalog: { publicSlug: string | null; publicBaseUrl: string | null };
  paymentChannels: Array<{ provider: string; status: string }>;
  timestamps: { tenantCreatedAt: string; tenantUpdatedAt: string };
  /** Solo si `LLM_SHADOW_COMPARE_INCLUDE_TENANT_WHATSAPP_NUMBER=true` (número del canal bot del tenant). */
  channel?: { whatsAppBusinessNumber?: string };
};

function slimCrewTenantRuntimeContextForHttp(ctx: CrewTenantRuntimeContextV1): CrewTenantRuntimeContextV1 {
  const maxName = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_RUNTIME_DISPLAY_NAME_CHARS", 160);
  const maxLabels = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_RUNTIME_LABELS", 24);
  const maxPaymentRows = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_RUNTIME_PAYMENT_CHANNELS", 12);
  const maxWa = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_RUNTIME_WHATSAPP_CHARS", 48);
  const maxModel = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_RUNTIME_MODEL_NAME_CHARS", 80);
  const out: CrewTenantRuntimeContextV1 = {
    ...ctx,
    identity: {
      ...ctx.identity,
      displayName: clampStr(ctx.identity.displayName, maxName)
    },
    knowledge: {
      ...ctx.knowledge,
      businessLabels: ctx.knowledge.businessLabels.slice(0, maxLabels).map((l) => clampStr(l, 64))
    },
    llm: {
      ...ctx.llm,
      modelName: clampStr(ctx.llm.modelName, maxModel)
    },
    paymentChannels: ctx.paymentChannels.slice(0, maxPaymentRows)
  };
  if (out.channel?.whatsAppBusinessNumber) {
    out.channel = {
      whatsAppBusinessNumber: clampStr(out.channel.whatsAppBusinessNumber, maxWa)
    };
  }
  return out;
}

/**
 * Carga desde Prisma el contexto de tenant para el POST al crew. Respetar privacidad: el número WhatsApp del tenant
 * solo se envía si `LLM_SHADOW_COMPARE_INCLUDE_TENANT_WHATSAPP_NUMBER=true`.
 */
export async function loadCrewTenantRuntimeContextForCrewPayload(
  tenantId: string
): Promise<CrewTenantRuntimeContextV1 | null> {
  const tid = String(tenantId ?? "").trim();
  if (!tid) return null;
  if (/^(1|true|yes)$/i.test(String(process.env.LLM_SHADOW_COMPARE_OMIT_TENANT_RUNTIME_CONTEXT ?? "").trim())) {
    return null;
  }
  try {
    const row = await prisma.tenant.findUnique({
      where: { id: tid },
      select: {
        id: true,
        name: true,
        plan: true,
        publicCatalogSlug: true,
        whatsappNumber: true,
        senderRateMs: true,
        senderPauseEvery: true,
        senderPauseMs: true,
        llmAssistEnabled: true,
        llmConfidenceThreshold: true,
        llmGuardrailsStrict: true,
        llmRolloutPercent: true,
        llmModelName: true,
        createdAt: true,
        updatedAt: true,
        tenantKnowledge: {
          select: {
            businessCategory: true,
            businessLabels: true,
            updatedAt: true
          }
        },
        paymentIntegrations: {
          select: { provider: true, status: true }
        }
      }
    });
    if (!row) return null;

    const publicBaseUrl = resolvePublicCatalogBaseUrlForCrew();
    const slug =
      typeof row.publicCatalogSlug === "string" && row.publicCatalogSlug.trim()
        ? row.publicCatalogSlug.trim()
        : null;
    const thr = Number(row.llmConfidenceThreshold);
    const ctx: CrewTenantRuntimeContextV1 = {
      version: 1,
      identity: {
        tenantId: row.id,
        displayName: row.name,
        plan: row.plan
      },
      knowledge: {
        businessCategory: String(row.tenantKnowledge?.businessCategory ?? "general").trim() || "general",
        businessLabels: [...(row.tenantKnowledge?.businessLabels ?? [])],
        profileUpdatedAt: row.tenantKnowledge?.updatedAt?.toISOString()
      },
      llm: {
        assistEnabled: row.llmAssistEnabled,
        confidenceThreshold: Number.isFinite(thr) ? thr : 0.72,
        guardrailsStrict: row.llmGuardrailsStrict,
        rolloutPercent: row.llmRolloutPercent,
        modelName: String(row.llmModelName ?? "").trim() || "self-hosted-default"
      },
      outboundMessaging: {
        senderRateMs: row.senderRateMs,
        senderPauseEvery: row.senderPauseEvery,
        senderPauseMs: row.senderPauseMs
      },
      catalog: {
        publicSlug: slug,
        publicBaseUrl: slug && publicBaseUrl ? publicBaseUrl : null
      },
      paymentChannels: row.paymentIntegrations.map((p: { provider: unknown; status: unknown }) => ({
        provider: String(p.provider),
        status: String(p.status)
      })),
      timestamps: {
        tenantCreatedAt: row.createdAt.toISOString(),
        tenantUpdatedAt: row.updatedAt.toISOString()
      }
    };
    if (/^(1|true|yes)$/i.test(String(process.env.LLM_SHADOW_COMPARE_INCLUDE_TENANT_WHATSAPP_NUMBER ?? "").trim())) {
      const wa = String(row.whatsappNumber ?? "").trim();
      if (wa) {
        ctx.channel = { whatsAppBusinessNumber: wa };
      }
    }
    return slimCrewTenantRuntimeContextForHttp(ctx);
  } catch {
    return null;
  }
}

export const isWasellerCrewPrimaryEnabled = (): boolean =>
  /^(1|true|yes)$/i.test(String(process.env.WASELLER_CREW_PRIMARY ?? "").trim());

/**
 * Modo “solo waseller-crew” para **respuestas a leads** vía POST al crew:
 * - **Orquestador:** no intérprete OpenAI ni `SelfHostedLlmService.decide`; baseline stub + crew.
 * - **Lead worker (ruta directa):** el POST al crew usa interpretación/baseline stub (no el texto largo de plantillas como baseline); si el crew no aplica, mensaje = handoff.
 * Requiere `LLM_SHADOW_COMPARE_URL`. Sin `WASELLER_CREW_PRIMARY`, el POST igual se habilita con este flag.
 */
export const isWasellerCrewSoleModeEnabled = (): boolean =>
  /^(1|true|yes)$/i.test(String(process.env.WASELLER_CREW_SOLE_MODE ?? "").trim());

/** Si es true, el message-processor envía el turno al orquestador aunque antes iría solo al lead (p. ej. variante ya resuelta). */
export const isWasellerCrewOrchestrateFirstEnabled = (): boolean =>
  /^(1|true|yes)$/i.test(String(process.env.WASELLER_CREW_ORCHESTRATE_FIRST ?? "").trim());

/**
 * Si hay `LLM_SHADOW_COMPARE_URL`, por defecto la conversación comercial se delega a waseller-crew
 * (sin depender de `WASELLER_CREW_PRIMARY` / `WASELLER_CREW_SOLE_MODE`). Opt-out: `WASELLER_CREW_DELEGATE_CONVERSATION=false`.
 * Sin URL nunca delega.
 */
export function wasellerCrewDelegatesConversation(): boolean {
  const url = String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim();
  if (!url) return false;
  if (isWasellerCrewPrimaryEnabled() || isWasellerCrewSoleModeEnabled()) return true;
  const raw = String(process.env.WASELLER_CREW_DELEGATE_CONVERSATION ?? "").trim();
  if (/^(0|false|no)$/i.test(raw)) return false;
  if (/^(1|true|yes)$/i.test(raw)) return true;
  return true;
}

/**
 * Delegación de conversación al crew (waseller-crew) cuando la URL está configurada.
 * El perfil comercial incompleto se avisa en el dashboard; los workers no bloquean el crew por eso.
 */
export function isWasellerCrewConversationDelegationActiveForTenant(_profile: TenantBusinessProfile): boolean {
  return wasellerCrewDelegatesConversation();
}

/** Shell de interpretación antes del POST al crew (reglas del processor o stub mínimo). */
export function buildCrewSoleStubInterpretation(input: {
  intentHint?: string;
  ruleInterpretation?: ConversationInterpretationV1 | null;
  conversationStage?: ConversationStageV1;
}): ConversationInterpretationV1 {
  const r = input.ruleInterpretation;
  if (r && typeof r.intent === "string" && r.intent.trim() && typeof r.nextAction === "string" && r.nextAction.trim()) {
    return {
      ...r,
      source: "rules",
      notes: Array.from(new Set([...(r.notes ?? []), "crew_sole_mode_shell"]))
    };
  }
  const hint = String(input.intentHint ?? "desconocido").trim() || "desconocido";
  return {
    intent: hint,
    confidence: 0.2,
    entities: {},
    references: [],
    conversationStage: input.conversationStage ?? "waiting_product",
    missingFields: ["crew_will_refine"],
    nextAction: "reply_only",
    source: "rules",
    notes: ["crew_sole_mode_stub", "nl_delegated_to_waseller_crew"]
  };
}

/** Baseline mínimo para `mergeCrewCandidateIntoLlmDecision` (el borrador real lo aporta el crew). */
export function buildCrewSoleStubBaselineDecision(interpretation: ConversationInterpretationV1): LlmDecisionV1 {
  return {
    intent: interpretation.intent,
    leadStage: "discovery",
    confidence: 0.35,
    entities: {},
    nextAction: "reply_only",
    reason: "crew_sole_mode_stub_baseline",
    requiresHuman: false,
    recommendedAction: "reply_only",
    draftReply: "  ",
    handoffRequired: false,
    qualityFlags: ["crew_sole_stub_baseline"],
    source: "fallback"
  };
}

export function mergeCrewCandidateInterpretation(
  base: ConversationInterpretationV1,
  partial?: Partial<ConversationInterpretationV1> | null
): ConversationInterpretationV1 {
  if (!partial || Object.keys(partial).length === 0) return base;
  const entities =
    partial.entities !== undefined ? { ...base.entities, ...partial.entities } : base.entities;
  const references = partial.references !== undefined ? partial.references : base.references;
  const missingFields = partial.missingFields !== undefined ? partial.missingFields : base.missingFields;
  const notes =
    partial.notes !== undefined
      ? Array.from(new Set([...(base.notes ?? []), ...partial.notes]))
      : base.notes;
  return {
    ...base,
    ...partial,
    entities,
    references,
    missingFields,
    notes
  };
}

/**
 * Suelo más bajo de confianza cuando el `draftReply` viene de waseller-crew (primary), para no bloquear
 * guardrails / `requiresHuman` con el mismo umbral que el LLM interno.
 */
export function resolveCrewPrimaryEffectiveConfidenceThreshold(
  tenantConfidenceThreshold: number,
  crewPrimaryApplied: boolean
): number {
  const relax =
    crewPrimaryApplied &&
    /^(1|true|yes)$/i.test(String(process.env.CREW_PRIMARY_RELAX_GUARDRAILS ?? "true").trim());
  if (!relax) return tenantConfidenceThreshold;
  const floor = Math.max(0.35, Math.min(0.95, Number(process.env.CREW_PRIMARY_GUARDRAIL_CONFIDENCE_FLOOR ?? 0.55)));
  return Math.min(tenantConfidenceThreshold, floor);
}

/** Resultado de un POST a `LLM_SHADOW_COMPARE_URL` (sin persistir en DB). */
export type ShadowCompareHttpExecution = {
  outboundBody: Record<string, unknown>;
  httpStatus: number;
  httpOk: boolean;
  merged: LlmDecisionV1 | null;
  candidateDecision?: ShadowCompareCandidateDecision | null;
  candidateInterpretation?: Partial<ConversationInterpretationV1>;
  parseOk: boolean;
  parseError?: string;
  issues?: ValidationIssue[];
  jsonInvalid: boolean;
  rawSnippet?: string;
  /** Fallo de red / abort antes de respuesta HTTP útil */
  networkError?: string;
};

function mergeCrewCandidateIntoLlmDecision(
  baseline: LlmDecisionV1,
  candidate: ShadowCompareCandidateDecision | undefined
): LlmDecisionV1 | null {
  if (!candidate) return null;
  const draft = typeof candidate.draftReply === "string" ? candidate.draftReply.trim() : "";
  if (draft.length < 2) return null;
  const recStr =
    typeof candidate.recommendedAction === "string" && candidate.recommendedAction.trim().length > 0
      ? candidate.recommendedAction.trim()
      : "";
  let mergedNext = candidate.nextAction ?? baseline.nextAction;
  if (
    (recStr === "handoff_human" || recStr === "manual_review") &&
    mergedNext !== "handoff_human" &&
    mergedNext !== "manual_review"
  ) {
    mergedNext = recStr as LlmDecisionV1["nextAction"];
  }
  const mergedRec = recStr || baseline.recommendedAction;
  const wantsHandoff =
    mergedNext === "handoff_human" ||
    mergedNext === "manual_review" ||
    mergedRec === "handoff_human" ||
    mergedRec === "manual_review";
  return {
    ...baseline,
    draftReply: draft,
    intent:
      typeof candidate.intent === "string" && candidate.intent.trim().length > 0
        ? candidate.intent.trim()
        : baseline.intent,
    confidence:
      typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
        ? candidate.confidence
        : baseline.confidence,
    nextAction: mergedNext,
    recommendedAction: mergedRec,
    requiresHuman: Boolean(baseline.requiresHuman || wantsHandoff),
    handoffRequired: Boolean(baseline.handoffRequired || wantsHandoff),
    reason:
      typeof candidate.reason === "string" && candidate.reason.trim().length > 0
        ? candidate.reason.trim()
        : baseline.reason,
    source: "llm",
    provider: "waseller-crew",
    model: baseline.model ?? "waseller-crew-primary",
    qualityFlags: Array.from(new Set([...(baseline.qualityFlags ?? []), "crew_primary"]))
  };
}

/** Cuerpo JSON del POST shadow-compare (mismo contrato para comparar o para modo primary). */
export async function assembleShadowCompareOutboundBody(input: ShadowCompareInput): Promise<Record<string, unknown>> {
  const recentForPayload = await injectLastOutgoingMessageForCrew(
    input.tenantId,
    String(input.phone ?? "").trim(),
    (input.recentMessages ?? []) as Array<{ direction: "incoming" | "outgoing"; message: string }>
  );
  const inputResolved: ShadowCompareInput = { ...input, recentMessages: recentForPayload };

  let stockLoad: ShadowStockLoadResult = { rows: [], scope: "none", ragProductIdsTried: [] };
  try {
    stockLoad = await loadStockTableBundle(
      inputResolved.tenantId,
      inputResolved.stockTableProductId ?? null,
      inputResolved.stockTableRagProductIds ?? null
    );
  } catch {
    stockLoad = { rows: [], scope: "none", ragProductIdsTried: [] };
  }
  const stockTable = stockLoad.rows;
  const ragRowCap = Math.max(
    5,
    Math.min(100, Number(process.env.LLM_SHADOW_COMPARE_STOCK_RAG_ROW_LIMIT ?? 30))
  );
  const inventoryNarrowingNote = buildInventoryNarrowingNote({
    scope: stockLoad.scope,
    rowCount: stockTable.length,
    stockTableProductId: inputResolved.stockTableProductId,
    ragProductIdsTried: stockLoad.ragProductIdsTried,
    ragRowCap
  });

  const maxIncoming = readNumericEnv("LLM_SHADOW_COMPARE_MAX_INCOMING_CHARS", 2500);
  const maxRecentMsg = readNumericEnv("LLM_SHADOW_COMPARE_MAX_RECENT_MSG_CHARS", 900);

  const payload: Record<string, unknown> = {
    schemaVersion: JOB_SCHEMA_VERSION,
    kind: "waseller.shadow_compare.v1",
    tenantId: inputResolved.tenantId,
    leadId: inputResolved.leadId,
    incomingText: clampStr(inputResolved.incomingText, maxIncoming),
    interpretation: slimInterpretationForCrewHttp(buildRichInterpretationForShadowCompare(inputResolved)),
    baselineDecision: slimBaselineForCrewHttp(inputResolved.baselineDecision)
  };
  const phone = String(inputResolved.phone ?? "").trim();
  if (phone) payload.phone = phone;
  if (inputResolved.correlationId.trim()) payload.correlationId = inputResolved.correlationId;
  if (inputResolved.messageId.trim()) payload.messageId = inputResolved.messageId;
  if (
    inputResolved.conversationId !== undefined &&
    inputResolved.conversationId !== null &&
    String(inputResolved.conversationId).trim()
  ) {
    payload.conversationId = inputResolved.conversationId;
  }
  const recent = inputResolved.recentMessages?.filter((m) => m.message?.trim()) ?? [];
  if (recent.length > 0) {
    payload.recentMessages = recent.slice(-8).map((m) => ({
      direction: m.direction,
      message: clampStr(m.message, maxRecentMsg)
    }));
  }
  if (stockTable.length > 0) {
    payload.stockTable = slimStockRowsForCrewHttp(stockTable);
  }
  payload.inventoryNarrowingNote = inventoryNarrowingNote;
  const crewSlug = toCrewBusinessProfileSlug(String(inputResolved.tenantBusinessCategory ?? ""));
  if (crewSlug) {
    payload.businessProfileSlug = crewSlug;
  }
  if (inputResolved.tenantBrief && crewTenantBriefHasSignal(inputResolved.tenantBrief)) {
    const slimBrief = slimCrewTenantBriefForHttp(inputResolved.tenantBrief);
    payload.tenantBrief = slimBrief;
    const commercialLines = buildTenantCommercialContextFromBrief(slimBrief);
    const maxCommercial = readNumericEnv("LLM_SHADOW_COMPARE_MAX_TENANT_COMMERCIAL_CONTEXT_CHARS", 1400);
    if (commercialLines.trim().length > 0) {
      payload.tenantCommercialContext = clampStr(commercialLines, maxCommercial);
    }
  }

  const stage = (inputResolved.conversationStage ??
    inputResolved.interpretation.conversationStage) as ConversationStageV1 | undefined;
  if (stage && String(stage).trim()) {
    payload.etapa = clampStr(String(stage), 500);
  }

  if (inputResolved.activeOffer && activeOfferHasSignal(inputResolved.activeOffer)) {
    payload.activeOffer = slimActiveOfferForCrewRoot(inputResolved.activeOffer);
  }

  const maxMemLines = Math.max(1, Math.min(40, Number(process.env.LLM_SHADOW_COMPARE_MAX_MEMORY_FACT_LINES ?? 40)));
  const maxMemLineChars = Math.max(80, Math.min(400, Number(process.env.LLM_SHADOW_COMPARE_MAX_MEMORY_FACT_LINE_CHARS ?? 400)));
  if (inputResolved.memoryFacts && Object.keys(inputResolved.memoryFacts).length > 0) {
    const lines = memoryFactsRecordToStringArray(inputResolved.memoryFacts, maxMemLines, maxMemLineChars);
    if (lines.length > 0) payload.memoryFacts = lines;
  }

  const publicCatalog = await loadPublicCatalogFieldsForCrewPayload(inputResolved.tenantId);
  if (publicCatalog) {
    payload.publicCatalogSlug = publicCatalog.publicCatalogSlug;
    payload.publicCatalogBaseUrl = publicCatalog.publicCatalogBaseUrl;
  }

  const tenantRuntimeContext = await loadCrewTenantRuntimeContextForCrewPayload(inputResolved.tenantId);
  if (tenantRuntimeContext) {
    payload.tenantRuntimeContext = tenantRuntimeContext;
  }

  return payload;
}

/**
 * POST único a `LLM_SHADOW_COMPARE_URL`. No persiste trazas; usalo y luego `persistShadowCompareTelemetry`
 * o la traza `crew_primary` en `tryWasellerCrewPrimaryReplacement`.
 */
export async function executeShadowCompareRequest(
  input: ShadowCompareInput
): Promise<ShadowCompareHttpExecution | null> {
  const url = String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim();
  if (!url) return null;

  const outboundBody = await assembleShadowCompareOutboundBody(input);
  const timeoutMs = Math.max(
    1000,
    Math.min(120_000, Number(process.env.LLM_SHADOW_COMPARE_TIMEOUT_MS ?? 30_000))
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const shadowSecret = readShadowCompareSecret();
  const authorizationSent = shadowSecret.length > 0;
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
      return {
        outboundBody,
        httpStatus: res.status,
        httpOk: false,
        merged: null,
        parseOk: false,
        jsonInvalid: true,
        rawSnippet: raw.slice(0, 800)
      };
    }
    const parsed = parseShadowCompareHttpResponse(json);
    if (!parsed.ok) {
      return {
        outboundBody,
        httpStatus: res.status,
        httpOk: res.ok,
        merged: null,
        parseOk: false,
        parseError: parsed.error,
        issues: parsed.issues,
        jsonInvalid: false
      };
    }
    const merged = mergeCrewCandidateIntoLlmDecision(input.baselineDecision, parsed.value.candidateDecision);
    const httpOk = res.ok;
    return {
      outboundBody,
      httpStatus: res.status,
      httpOk,
      merged: merged && httpOk ? merged : null,
      candidateDecision: parsed.value.candidateDecision ?? null,
      candidateInterpretation: parsed.value.candidateInterpretation,
      parseOk: true,
      jsonInvalid: false
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      outboundBody,
      httpStatus: 0,
      httpOk: false,
      merged: null,
      parseOk: false,
      jsonInvalid: false,
      networkError: message
    };
  } finally {
    clearTimeout(timer);
  }
}

async function persistCrewPrimaryTrace(
  input: ShadowCompareInput,
  exec: ShadowCompareHttpExecution,
  url: string,
  timeoutMs: number,
  authorizationSent: boolean
): Promise<void> {
  const persistCrew = async (response: Record<string, unknown>, error?: string) => {
    try {
      await prisma.llmTrace.create({
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
            body: exec.outboundBody
          },
          response,
          promptTokens: null,
          completionTokens: null,
          latencyMs: null,
          handoffRequired: false,
          error: error ?? null
        }
      });
    } catch {
      // noop
    }
  };

  if (exec.networkError) {
    await persistCrew(
      { aborted: exec.networkError.includes("abort"), detail: exec.networkError },
      exec.networkError
    );
    return;
  }
  if (exec.jsonInvalid) {
    await persistCrew({ httpStatus: exec.httpStatus, rawSnippet: exec.rawSnippet }, "invalid_json_body");
    return;
  }
  if (!exec.parseOk) {
    await persistCrew(
      {
        httpStatus: exec.httpStatus,
        issues: exec.issues ?? []
      },
      exec.parseError
    );
    return;
  }
  if (!exec.merged || !exec.httpOk) {
    await persistCrew(
      {
        httpStatus: exec.httpStatus,
        httpOk: exec.httpOk,
        candidateDecision: exec.candidateDecision ?? null,
        skipped: exec.merged ? false : "no_mergeable_candidate"
      },
      !exec.httpOk ? `http_${exec.httpStatus}` : "no_mergeable_candidate"
    );
    return;
  }
  await persistCrew({
    httpStatus: exec.httpStatus,
    httpOk: true,
    candidateDecision: exec.candidateDecision ?? null,
    applied: true
  });
}

/**
 * Persiste `traceKind: "shadow_compare"` (misma forma que el log histórico).
 */
export async function persistShadowCompareTelemetry(
  input: ShadowCompareInput,
  exec: ShadowCompareHttpExecution
): Promise<void> {
  const url = String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim();
  const timeoutMs = Math.max(
    1000,
    Math.min(120_000, Number(process.env.LLM_SHADOW_COMPARE_TIMEOUT_MS ?? 30_000))
  );
  const shadowSecret = readShadowCompareSecret();
  const authorizationSent = shadowSecret.length > 0;

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
      // noop
    }
  };

  if (exec.networkError) {
    await persist(
      {
        error: exec.networkError,
        response: { aborted: exec.networkError.includes("abort") }
      },
      exec.outboundBody
    );
    return;
  }
  if (exec.jsonInvalid) {
    await persist(
      {
        httpStatus: exec.httpStatus,
        error: "invalid_json_body",
        response: { rawSnippet: exec.rawSnippet ?? "" }
      },
      exec.outboundBody
    );
    return;
  }
  if (!exec.parseOk) {
    await persist(
      {
        httpStatus: exec.httpStatus,
        error: exec.parseError,
        response: { issues: exec.issues ?? [] }
      },
      exec.outboundBody
    );
    return;
  }

  const candidate = exec.candidateDecision;
  const diff =
    candidate != null
      ? summarizeDecisionDiff(input.baselineDecision, candidate)
      : { skipped: true as const, reason: "no_candidateDecision" };

  await persist(
    {
      httpStatus: exec.httpStatus,
      response: {
        httpOk: exec.httpOk,
        candidateDecision: candidate ?? null,
        candidateInterpretation: exec.candidateInterpretation ?? null,
        diff,
        shadowCustomerApplied: Boolean(exec.merged && exec.httpOk)
      }
    },
    exec.outboundBody
  );
}

export type CrewPrimaryReplacementResult = {
  decision: LlmDecisionV1;
  outboundBody: Record<string, unknown>;
  candidateInterpretation?: Partial<ConversationInterpretationV1>;
};

/**
 * Una sola llamada a waseller-crew: si responde con `candidateDecision.draftReply` válido, reemplaza la decisión
 * interna (OpenAI/self-hosted) **antes** del verificador y guardrails. Requiere `LLM_SHADOW_COMPARE_URL`.
 * Quien llama debe acotar con `isWasellerCrewConversationDelegationActiveForTenant` / PRIMARY / SOLE para no POSTear
 * cuando no corresponde. No lanza hacia arriba.
 */
export async function tryWasellerCrewPrimaryReplacement(
  input: ShadowCompareInput
): Promise<CrewPrimaryReplacementResult | null> {
  const url = String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim();
  if (!url) return null;

  const timeoutMs = Math.max(
    1000,
    Math.min(120_000, Number(process.env.LLM_SHADOW_COMPARE_TIMEOUT_MS ?? 30_000))
  );
  const shadowSecret = readShadowCompareSecret();
  const authorizationSent = shadowSecret.length > 0;

  const exec = await executeShadowCompareRequest(input);
  if (!exec) return null;

  await persistCrewPrimaryTrace(input, exec, url, timeoutMs, authorizationSent);

  if (!exec.merged || !exec.httpOk) return null;
  return {
    decision: exec.merged,
    outboundBody: exec.outboundBody,
    candidateInterpretation: exec.candidateInterpretation
  };
}

/**
 * Si `LLM_SHADOW_COMPARE_URL` está definida, envía el baseline a un servicio externo (p. ej. CrewAI)
 * y persiste el resultado en `LlmTrace` con `traceKind: "shadow_compare"`.
 * No lanza: errores de red o de persistencia se ignoran para no afectar el camino principal.
 */
export async function logShadowExternalCompareIfConfigured(input: ShadowCompareInput): Promise<void> {
  if (!String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim()) return;
  if (wasellerCrewDelegatesConversation()) {
    // `tryWasellerCrewPrimaryReplacement` u orquestación crew ya hizo POST al mismo endpoint con el mismo `correlationId`.
    return;
  }
  try {
    const exec = await executeShadowCompareRequest(input);
    if (!exec) return;
    await persistShadowCompareTelemetry(input, exec);
  } catch {
    // noop
  }
}
