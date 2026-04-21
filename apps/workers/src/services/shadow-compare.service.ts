import { prisma } from "../../../../packages/db/src";
import {
  JOB_SCHEMA_VERSION,
  parseShadowCompareHttpResponse,
  summarizeDecisionDiff,
  type ConversationInterpretationV1,
  type ConversationReferenceV1,
  type LlmDecisionV1,
  type ShadowCompareCandidateDecision
} from "../../../../packages/queue/src";
import { toCrewBusinessProfileSlug } from "../../../../packages/shared/src/crew-business-profile-slug";

export type ShadowCompareRecentMessageV1 = {
  direction: "incoming" | "outgoing";
  message: string;
};

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

/** Reduce tokens en waseller-crew: truncar textos y quitar campos pesados del JSON HTTP. */
function slimInterpretationForCrewHttp(i: ConversationInterpretationV1): ConversationInterpretationV1 {
  const maxRef = readNumericEnv("LLM_SHADOW_COMPARE_MAX_REFERENCES", 8);
  const maxNotes = readNumericEnv("LLM_SHADOW_COMPARE_MAX_NOTES", 5);
  const maxEntityStr = readNumericEnv("LLM_SHADOW_COMPARE_MAX_ENTITY_VALUE_CHARS", 320);
  const maxMissing = readNumericEnv("LLM_SHADOW_COMPARE_MAX_MISSING_FIELDS", 14);
  const maxEntityKeys = readNumericEnv("LLM_SHADOW_COMPARE_MAX_ENTITY_KEYS", 28);

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

  return {
    ...i,
    entities,
    references,
    notes: i.notes?.slice(0, maxNotes),
    missingFields: (i.missingFields ?? []).slice(0, maxMissing)
  };
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
};

const readShadowCompareSecret = (): string =>
  String(process.env.LLM_SHADOW_COMPARE_SECRET ?? process.env.SHADOW_COMPARE_SECRET ?? "").trim();

const isWasellerCrewPrimaryEnabled = (): boolean =>
  /^(1|true|yes)$/i.test(String(process.env.WASELLER_CREW_PRIMARY ?? "").trim());

function mergeCrewCandidateIntoLlmDecision(
  baseline: LlmDecisionV1,
  candidate: ShadowCompareCandidateDecision | undefined
): LlmDecisionV1 | null {
  if (!candidate) return null;
  const draft = typeof candidate.draftReply === "string" ? candidate.draftReply.trim() : "";
  if (draft.length < 2) return null;
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
    nextAction: candidate.nextAction ?? baseline.nextAction,
    recommendedAction:
      typeof candidate.recommendedAction === "string" && candidate.recommendedAction.trim().length > 0
        ? candidate.recommendedAction.trim()
        : baseline.recommendedAction,
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
  let stockLoad: ShadowStockLoadResult = { rows: [], scope: "none", ragProductIdsTried: [] };
  try {
    stockLoad = await loadStockTableBundle(
      input.tenantId,
      input.stockTableProductId ?? null,
      input.stockTableRagProductIds ?? null
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
    stockTableProductId: input.stockTableProductId,
    ragProductIdsTried: stockLoad.ragProductIdsTried,
    ragRowCap
  });

  const maxIncoming = readNumericEnv("LLM_SHADOW_COMPARE_MAX_INCOMING_CHARS", 2500);
  const maxRecentMsg = readNumericEnv("LLM_SHADOW_COMPARE_MAX_RECENT_MSG_CHARS", 900);

  const payload: Record<string, unknown> = {
    schemaVersion: JOB_SCHEMA_VERSION,
    kind: "waseller.shadow_compare.v1",
    tenantId: input.tenantId,
    leadId: input.leadId,
    incomingText: clampStr(input.incomingText, maxIncoming),
    interpretation: slimInterpretationForCrewHttp(input.interpretation),
    baselineDecision: slimBaselineForCrewHttp(input.baselineDecision)
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
      message: clampStr(m.message, maxRecentMsg)
    }));
  }
  if (stockTable.length > 0) {
    payload.stockTable = slimStockRowsForCrewHttp(stockTable);
  }
  payload.inventoryNarrowingNote = inventoryNarrowingNote;
  const crewSlug = toCrewBusinessProfileSlug(String(input.tenantBusinessCategory ?? ""));
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
export async function tryWasellerCrewPrimaryReplacement(
  input: ShadowCompareInput
): Promise<{ decision: LlmDecisionV1; outboundBody: Record<string, unknown> } | null> {
  if (!isWasellerCrewPrimaryEnabled()) return null;
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
    } catch {
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
    let json: unknown;
    try {
      json = raw ? (JSON.parse(raw) as unknown) : {};
    } catch {
      await persistCrew(
        { httpStatus: res.status, rawSnippet: raw.slice(0, 800) },
        "invalid_json_body"
      );
      return null;
    }
    const parsed = parseShadowCompareHttpResponse(json);
    if (!parsed.ok) {
      await persistCrew(
        {
          httpStatus: res.status,
          issues: parsed.issues ?? []
        },
        parsed.error
      );
      return null;
    }
    const merged = mergeCrewCandidateIntoLlmDecision(input.baselineDecision, parsed.value.candidateDecision);
    if (!merged || !res.ok) {
      await persistCrew(
        {
          httpStatus: res.status,
          httpOk: res.ok,
          candidateDecision: parsed.value.candidateDecision ?? null,
          skipped: merged ? false : "no_mergeable_candidate"
        },
        !res.ok ? `http_${res.status}` : "no_mergeable_candidate"
      );
      return null;
    }
    await persistCrew({
      httpStatus: res.status,
      httpOk: res.ok,
      candidateDecision: parsed.value.candidateDecision ?? null,
      applied: true
    });
    return { decision: merged, outboundBody };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await persistCrew({ aborted: message.includes("abort"), detail: message }, message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Si `LLM_SHADOW_COMPARE_URL` está definida, envía el baseline a un servicio externo (p. ej. CrewAI)
 * y persiste el resultado en `LlmTrace` con `traceKind: "shadow_compare"`.
 * No lanza: errores de red o de persistencia se ignoran para no afectar el camino principal.
 */
export async function logShadowExternalCompareIfConfigured(input: ShadowCompareInput): Promise<void> {
  const url = String(process.env.LLM_SHADOW_COMPARE_URL ?? "").trim();
  if (!url) return;
  if (isWasellerCrewPrimaryEnabled()) {
    // `tryWasellerCrewPrimaryReplacement` ya hizo POST al mismo endpoint con el mismo `correlationId`.
    // Evitar segundo POST y telemetría duplicada en waseller-crew (la traza `crew_primary` en `llm_traces` alcanza).
    return;
  }

  const timeoutMs = Math.max(
    1000,
    Math.min(120_000, Number(process.env.LLM_SHADOW_COMPARE_TIMEOUT_MS ?? 30_000))
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const shadowSecret = readShadowCompareSecret();
  const authorizationSent = shadowSecret.length > 0;

  const outboundBody = await assembleShadowCompareOutboundBody(input);

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
