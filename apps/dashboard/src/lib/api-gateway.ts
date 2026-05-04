import { HttpException } from "@nestjs/common";
import { NextRequest, NextResponse } from "next/server";
import { authTokenEnvFromProcess, verifyAuthToken } from "@waseller/api-core";
import { TENANT_HEADER, type AuthTokenPayload, type LeadStatus } from "@waseller/shared";
import type { IncomingMessageDto } from "../../../backend/src/modules/messages/receiver.dto";
import { requireRole } from "../../../backend/src/common/auth/require-role";
import { getBackendServices } from "./backend-services";

function jsonMessage(status: number, message: string): NextResponse {
  return NextResponse.json({ message }, { status });
}

export function httpExceptionToResponse(e: unknown): NextResponse {
  if (e instanceof HttpException) {
    const status = e.getStatus();
    const res = e.getResponse();
    const message =
      typeof res === "string"
        ? res
        : typeof res === "object" && res !== null && "message" in res
          ? String((res as { message: unknown }).message)
          : e.message;
    const text = Array.isArray(message) ? message.join(", ") : String(message);
    return NextResponse.json({ message: text }, { status });
  }
  console.error(e);
  return NextResponse.json({ message: "Error interno" }, { status: 500 });
}

type ApiCtx = { tenantId: string; auth?: AuthTokenPayload };

function joinPath(parts: string[]): string {
  return `/${parts.join("/")}`;
}

async function resolveAuth(
  req: NextRequest,
  parts: string[],
  method: string
): Promise<ApiCtx | NextResponse> {
  const path = joinPath(parts);

  if (path === "/integrations/mercadopago/callback" && method === "GET") {
    return { tenantId: "" };
  }
  if (path === "/payments/mercadopago/webhook" && (method === "POST" || method === "GET" || method === "HEAD")) {
    return { tenantId: "" };
  }
  if (path === "/messages/incoming" && method === "POST") {
    const tenantId = req.headers.get(TENANT_HEADER)?.trim();
    if (!tenantId) {
      return jsonMessage(400, "Missing x-tenant-id header");
    }
    return { tenantId };
  }
  /** Storefront público: el tenantId se resuelve dentro del handler vía `slug`, no por header. */
  if (path.startsWith("/public/") || path === "/public") {
    return { tenantId: "" };
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return jsonMessage(401, "Missing Bearer token");
  }
  const token = header.slice("Bearer ".length).trim();
  const payload = verifyAuthToken(authTokenEnvFromProcess(process.env), token);
  if (!payload) {
    return jsonMessage(401, "Invalid or expired token");
  }

  const headerTenant = req.headers.get(TENANT_HEADER)?.trim();
  if (headerTenant && headerTenant !== payload.tenantId) {
    return jsonMessage(403, "Token tenant mismatch");
  }
  const tenantId = headerTenant || payload.tenantId;
  return { tenantId, auth: payload };
}

export async function dispatchApi(
  req: NextRequest,
  method: string,
  slug: string[]
): Promise<NextResponse> {
  const parts = slug.length ? slug : [];
  const url = new URL(req.url);
  const s = getBackendServices();

  try {
    const authz = await resolveAuth(req, parts, method);
    if (authz instanceof NextResponse) return authz;
    const { tenantId, auth } = authz;

    const path = joinPath(parts);

    /* -------- Mercado Pago públicos -------- */
    if (path === "/integrations/mercadopago/callback" && method === "GET") {
      const html = await s.mercadoPago.handleCallback({
        code: String(url.searchParams.get("code") ?? ""),
        state: String(url.searchParams.get("state") ?? ""),
        error: String(url.searchParams.get("error") ?? ""),
        error_description: String(url.searchParams.get("error_description") ?? "")
      });
      return new NextResponse(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    if (path === "/payments/mercadopago/webhook" && (method === "GET" || method === "HEAD")) {
      /** Mercado Pago suele validar la URL con GET/HEAD; antes respondíamos 401 sin Bearer. */
      if (method === "HEAD") return new NextResponse(null, { status: 200 });
      return NextResponse.json({ ok: true });
    }

    if (path === "/payments/mercadopago/webhook" && method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
      const query: Record<string, unknown> = {};
      url.searchParams.forEach((v, k) => {
        query[k] = v;
      });
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
      const result = await s.mercadoPago.handleWebhook({ query, body, headers });
      return NextResponse.json(result);
    }

    if (path === "/messages/incoming" && method === "POST") {
      const body = (await req.json()) as IncomingMessageDto;
      const jobId = await s.messages.enqueueIncoming(tenantId, body);
      return NextResponse.json({ status: "queued", jobId });
    }

    /* -------- Dashboard -------- */
    if (path === "/dashboard/summary" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      const data = await s.dashboard.getSummary(tenantId);
      return NextResponse.json(data);
    }

    /* -------- Leads -------- */
    if (path === "/leads" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      const data = await s.leads.listByTenant(
        tenantId,
        url.searchParams.get("includeClosed") === "true" || url.searchParams.get("includeClosed") === "1",
        url.searchParams.get("includeArchived") === "true" || url.searchParams.get("includeArchived") === "1",
        url.searchParams.get("includeHiddenFromInbox") === "true" ||
          url.searchParams.get("includeHiddenFromInbox") === "1",
        url.searchParams.get("includeOrphanConversations") === "true" ||
          url.searchParams.get("includeOrphanConversations") === "1"
      );
      return NextResponse.json(data);
    }

    const hideInbox = /^\/leads\/([^/]+)\/hide-from-inbox$/.exec(path);
    if (hideInbox && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const result = await s.leads.hideFromInbox(tenantId, hideInbox[1]);
      if (!result) return jsonMessage(404, "Lead no encontrado");
      return NextResponse.json(result);
    }
    const restoreInbox = /^\/leads\/([^/]+)\/restore-to-inbox$/.exec(path);
    if (restoreInbox && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const result = await s.leads.restoreToInbox(tenantId, restoreInbox[1]);
      if (!result) return jsonMessage(404, "Lead no encontrado");
      return NextResponse.json(result);
    }
    const patchStatus = /^\/leads\/([^/]+)\/status$/.exec(path);
    if (patchStatus && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = (await req.json()) as { status: LeadStatus };
      const data = await s.leads.markAs(tenantId, patchStatus[1], body.status);
      if (body.status === "vendido") {
        void enqueueConversationIndexingByLead(tenantId, patchStatus[1]).catch((e) =>
          console.error("[indexer-trigger] failed", e)
        );
      }
      return NextResponse.json(data);
    }
    const markCobrado = /^\/leads\/([^/]+)\/mark-cobrado$/.exec(path);
    if (markCobrado && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const data = await s.leads.markAs(tenantId, markCobrado[1], "vendido");
      void enqueueConversationIndexingByLead(tenantId, markCobrado[1]).catch((e) =>
        console.error("[indexer-trigger] failed", e)
      );
      return NextResponse.json(data);
    }
    const markDesp = /^\/leads\/([^/]+)\/mark-despachado$/.exec(path);
    if (markDesp && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const data = await s.leads.markAs(tenantId, markDesp[1], "caliente");
      return NextResponse.json(data);
    }
    const releaseRes = /^\/leads\/([^/]+)\/release-reservation$/.exec(path);
    if (releaseRes && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const data = await s.leads.releaseReservation(tenantId, releaseRes[1]);
      return NextResponse.json(data);
    }

    /* -------- Categories -------- */
    if (path === "/categories" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      return NextResponse.json(await s.categories.listForTenant(tenantId));
    }
    if (path === "/categories" && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = await req.json();
      return NextResponse.json(await s.categories.create(tenantId, body as never));
    }
    const categoryById = /^\/categories\/([^/]+)$/.exec(path);
    if (categoryById && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = await req.json();
      return NextResponse.json(await s.categories.update(tenantId, categoryById[1], body as never));
    }
    if (categoryById && method === "DELETE") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await s.categories.remove(tenantId, categoryById[1]));
    }

    /* -------- Products -------- */
    if (path === "/products/facet-options" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      const categoryId = url.searchParams.get("categoryId")?.trim() || undefined;
      return NextResponse.json(await s.products.listVariantFacetDistinctValues(tenantId, { categoryId }));
    }
    if (path === "/products" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      const categoryId = url.searchParams.get("categoryId")?.trim() || undefined;
      const q = url.searchParams.get("q")?.trim() || undefined;
      const talle = url.searchParams.get("talle")?.trim() || undefined;
      const color = url.searchParams.get("color")?.trim() || undefined;
      const marca = url.searchParams.get("marca")?.trim() || undefined;
      return NextResponse.json(
        await s.products.listByTenant(tenantId, { categoryId, q, talle, color, marca }),
      );
    }
    if (path === "/products" && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      let body: unknown = {};
      try {
        body = await req.json();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return jsonMessage(
          400,
          `No se pudo leer el payload del producto. Si estás subiendo muchas fotos, probá con menos imágenes o con menor tamaño. Detalle: ${msg}`
        );
      }
      return NextResponse.json(await s.products.createProduct(tenantId, body as never));
    }
    if (path === "/products/movements" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return NextResponse.json(await s.products.listMovements(tenantId, Number.isFinite(limit) ? limit : 100));
    }
    const adjustVar = /^\/products\/variants\/([^/]+)\/adjust$/.exec(path);
    if (adjustVar && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = await req.json();
      return NextResponse.json(await s.products.adjustStock(tenantId, adjustVar[1], body as never));
    }
    const patchVariant = /^\/products\/variants\/([^/]+)$/.exec(path);
    if (patchVariant && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = await req.json();
      return NextResponse.json(await s.products.updateVariant(tenantId, patchVariant[1], body as never));
    }
    const addVariant = /^\/products\/([^/]+)\/variants$/.exec(path);
    if (addVariant && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = await req.json();
      const created = await s.products.addVariant(tenantId, addVariant[1], body as never);
      if (!created) return jsonMessage(404, "Producto no encontrado");
      return NextResponse.json(created);
    }
    const patchProduct = /^\/products\/([^/]+)$/.exec(path);
    if (patchProduct && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = await req.json();
      return NextResponse.json(await s.products.updateProduct(tenantId, patchProduct[1], body as never));
    }

    /* -------- Conversations (rutas largas antes que GET :phone) -------- */
    const convState = /^\/conversations\/([^/]+)\/state$/.exec(path);
    if (convState && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      return NextResponse.json(await s.conversations.getState(tenantId, convState[1]));
    }
    const convPay = /^\/conversations\/([^/]+)\/payment-links$/.exec(path);
    if (convPay && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      return NextResponse.json(await s.conversations.listPaymentReviews(tenantId, convPay[1]));
    }
    const convReply = /^\/conversations\/([^/]+)\/reply$/.exec(path);
    if (convReply && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = (await req.json()) as { message: string };
      const result = await s.conversations.manualReply(tenantId, convReply[1], body.message);
      // Best-effort: capturamos el delta sugerencia↔envío para el loop de aprendizaje.
      // No bloquea la respuesta si falla.
      void captureSuggestionOutcome(tenantId, convReply[1], body.message).catch((e) => {
        console.error("[suggestion-outcome] capture failed", e);
      });
      return NextResponse.json(result);
    }
    const convPrep = /^\/conversations\/([^/]+)\/payment-links\/prepare$/.exec(path);
    if (convPrep && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await s.conversations.prepareDraftPaymentLink(tenantId, convPrep[1]));
    }
    const convSend = /^\/conversations\/([^/]+)\/payment-links\/([^/]+)\/send$/.exec(path);
    if (convSend && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(
        await s.conversations.sendPreparedPaymentLink(tenantId, convSend[1], convSend[2])
      );
    }
    const convResolve = /^\/conversations\/([^/]+)\/resolve$/.exec(path);
    if (convResolve && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await s.conversations.resolveChat(tenantId, convResolve[1]));
    }
    const convReopen = /^\/conversations\/([^/]+)\/reopen$/.exec(path);
    if (convReopen && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await s.conversations.reopenChat(tenantId, convReopen[1]));
    }
    const convClose = /^\/conversations\/([^/]+)\/close-lead$/.exec(path);
    if (convClose && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await s.conversations.closeLead(tenantId, convClose[1]));
    }
    const convArch = /^\/conversations\/([^/]+)\/archive$/.exec(path);
    if (convArch && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await s.conversations.archiveFromInbox(tenantId, convArch[1]));
    }
    const convUnarch = /^\/conversations\/([^/]+)\/unarchive$/.exec(path);
    if (convUnarch && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await s.conversations.unarchiveFromInbox(tenantId, convUnarch[1]));
    }
    const convHand = /^\/conversations\/([^/]+)\/handoff$/.exec(path);
    if (convHand && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = (await req.json()) as { reason?: string };
      return NextResponse.json(await s.conversations.handoffAssistive(tenantId, convHand[1], body.reason ?? ""));
    }
    const convSuggestion = /^\/conversations\/([^/]+)\/suggestion$/.exec(path);
    if (convSuggestion && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      return NextResponse.json(await getOrEnqueueSuggestion(tenantId, convSuggestion[1]));
    }
    const convSuggestionRegen = /^\/conversations\/([^/]+)\/suggestion\/regenerate$/.exec(path);
    if (convSuggestionRegen && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await regenerateSuggestion(tenantId, convSuggestionRegen[1]));
    }
    const convSuggestionUsed = /^\/conversations\/([^/]+)\/suggestion\/([^/]+)\/use$/.exec(path);
    if (convSuggestionUsed && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await markSuggestionUsed(tenantId, convSuggestionUsed[2]));
    }
    const convMsgs = /^\/conversations\/([^/]+)$/.exec(path);
    if (convMsgs && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      return NextResponse.json(await s.conversations.listMessages(tenantId, convMsgs[1]));
    }

    /* -------- Onboarding -------- */
    if (path === "/onboarding/status" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      return NextResponse.json(await s.onboarding.getStatus(tenantId));
    }
    if (path === "/onboarding/whatsapp/session" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      return NextResponse.json(await s.onboarding.getWhatsappState(tenantId));
    }
    if (path === "/onboarding/whatsapp/connect" && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = (await req.json().catch(() => ({}))) as { whatsappNumber?: string };
      return NextResponse.json(await s.onboarding.connectWhatsapp(tenantId, body?.whatsappNumber));
    }
    if (path === "/onboarding/whatsapp/disconnect" && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      return NextResponse.json(await s.onboarding.disconnectWhatsapp(tenantId));
    }
    if (path === "/onboarding/whatsapp/qr.png" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      const png = await s.onboarding.getWhatsappQrPng(tenantId);
      if (!png) return jsonMessage(404, "QR no disponible");
      return new NextResponse(Buffer.from(png), {
        status: 200,
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" }
      });
    }

    /* -------- Mercado Pago (auth) -------- */
    if (path === "/integrations/mercadopago/connect-url" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await s.mercadoPago.getConnectUrl(tenantId));
    }
    if (path === "/integrations/mercadopago/status" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      return NextResponse.json(await s.mercadoPago.getStatus(tenantId));
    }
    if (path === "/integrations/mercadopago/disconnect" && method === "POST") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await s.mercadoPago.disconnect(tenantId));
    }

    /* -------- Ops -------- */
    if (path === "/ops/rag/stats" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await getRagStats(tenantId));
    }
    if (path === "/ops/rag/backfill" && method === "POST") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await backfillRagFromVendidoLeads(tenantId));
    }
    if (path === "/ops/rag/generate-synthetic" && method === "POST") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json().catch(() => ({}))) as {
        count?: number;
        segments?: string[];
      };
      return NextResponse.json(
        await enqueueSyntheticGeneration(tenantId, body.count ?? 40, body.segments ?? [])
      );
    }
    if (path === "/ops/rag/clear-synthetic" && method === "POST") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await clearSyntheticTurns(tenantId));
    }
    if (path === "/ops/rag/synthetic-progress" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await getSyntheticProgress(tenantId));
    }
    if (path === "/ops/style-profile" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await loadStyleProfile(tenantId));
    }
    if (path === "/ops/whatsapp-import/preview" && method === "POST") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json()) as { content?: string };
      return NextResponse.json(await previewWhatsappImport(body.content ?? ""));
    }
    if (path === "/ops/whatsapp-import" && method === "POST") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json()) as {
        content?: string;
        sellerSpeaker?: string;
        contactPhone?: string;
      };
      return NextResponse.json(
        await importWhatsappExport(tenantId, body.content ?? "", body.sellerSpeaker ?? "", body.contactPhone ?? "")
      );
    }
    if (path === "/ops/style-profile/recompute" && method === "POST") {
      requireRole(auth?.role, ["admin"]);
      await enqueueStyleProfileRecompute(tenantId);
      return NextResponse.json({ ok: true, status: "enqueued" });
    }
    if (path === "/ops/copilot-quality" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      const value = String(url.searchParams.get("range") ?? "7d").toLowerCase();
      const days = value === "today" ? 1 : value === "30d" ? 30 : value === "all" ? 3650 : 7;
      return NextResponse.json(await getCopilotQualityMetrics(tenantId, days));
    }
    if (path === "/ops/queues" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await s.ops.getQueuesOverview());
    }
    if (path === "/ops/funnel" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      const value = String(url.searchParams.get("range") ?? "7d").toLowerCase();
      const range =
        value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "7d";
      return NextResponse.json(await s.ops.getFunnelMetrics(tenantId, range));
    }
    if (path === "/ops/playbooks" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await s.ops.getPlaybooks(tenantId));
    }
    if (path === "/ops/templates" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await s.ops.getResponseTemplates(tenantId));
    }
    if (path === "/ops/templates" && method === "PUT") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json()) as { templates: Array<{ key: string; template: string; isActive?: boolean }> };
      return NextResponse.json(await s.ops.saveResponseTemplates(tenantId, body.templates ?? []));
    }
    if (path === "/ops/tenant-knowledge" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await s.ops.getTenantKnowledge(tenantId));
    }
    if (path === "/ops/tenant-knowledge/presets" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await s.ops.getTenantKnowledgePresets());
    }
    if (path === "/ops/tenant-knowledge" && method === "PUT") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json()) as {
        knowledge?: Record<string, unknown>;
        presetCategory?:
          | "general"
          | "indumentaria_calzado"
          | "electronica"
          | "hogar_deco"
          | "belleza_salud"
          | "repuestos_lubricentro";
      };
      return NextResponse.json(await s.ops.updateTenantKnowledge(tenantId, body ?? {}));
    }
    if (path === "/ops/playbooks" && method === "PUT") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json()) as {
        playbooks: Array<{
          intent: string;
          variant: string;
          template: string;
          weight?: number;
          isActive?: boolean;
        }>;
      };
      return NextResponse.json(await s.ops.savePlaybooks(tenantId, body.playbooks ?? []));
    }
    if (path === "/ops/tenant-settings" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await s.ops.getTenantLlmSettings(tenantId));
    }
    if (path === "/ops/tenant-settings" && method === "PUT") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json()) as Record<string, unknown>;
      return NextResponse.json(await s.ops.updateTenantLlmSettings(tenantId, body ?? {}));
    }
    if (path === "/ops/quality" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      const value = String(url.searchParams.get("range") ?? "7d").toLowerCase();
      const range =
        value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "7d";
      return NextResponse.json(await s.ops.getQualityMetrics(tenantId, range));
    }
    if (path === "/ops/playbook-report" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      const value = String(url.searchParams.get("range") ?? "7d").toLowerCase();
      const range =
        value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "7d";
      return NextResponse.json(await s.ops.getPlaybookVariantReport(tenantId, range));
    }
    if (path === "/ops/feedback" && method === "POST") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const body = (await req.json()) as {
        targetType: "message" | "llm_trace" | "lead" | "conversation" | "bot_response_event";
        targetId: string;
        rating?: number;
        label?: string;
        comment?: string;
      };
      return NextResponse.json(await s.ops.createFeedback(tenantId, auth?.sub, body));
    }
    if (path === "/ops/eval-dataset/export" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      const value = String(url.searchParams.get("split") ?? "").toLowerCase();
      const split =
        value === "train" || value === "val" || value === "test" || value === "holdout" ? value : undefined;
      return NextResponse.json(await s.ops.exportEvalDataset(tenantId, split));
    }
    if (path === "/ops/eval-dataset" && method === "GET") {
      requireRole(auth?.role, ["admin"]);
      return NextResponse.json(await s.ops.getEvalDatasetSnapshot(tenantId));
    }
    if (path === "/ops/eval-dataset" && method === "POST") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json()) as {
        name: string;
        slug?: string;
        split?: "train" | "val" | "test" | "holdout";
        tags?: string[];
        input: unknown;
        reference: unknown;
        isActive?: boolean;
      };
      return NextResponse.json(await s.ops.createEvalDatasetItem(tenantId, body));
    }
    const evalPut = /^\/ops\/eval-dataset\/([^/]+)$/.exec(path);
    if (evalPut && method === "PUT") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json()) as Record<string, unknown>;
      return NextResponse.json(await s.ops.updateEvalDatasetItem(tenantId, evalPut[1], body));
    }
    if (path === "/ops/eval-dataset/from-feedback" && method === "POST") {
      requireRole(auth?.role, ["admin"]);
      const body = (await req.json().catch(() => ({}))) as {
        limit?: number;
        split?: "train" | "val" | "test" | "holdout";
        label?: string;
      };
      return NextResponse.json(await s.ops.promoteEvalDatasetFromFeedback(tenantId, body ?? {}));
    }

    /* -------- Tienda Config -------- */
    if (path === "/tienda-config" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      return NextResponse.json(await s.tiendaConfig.getConfig(tenantId));
    }
    if (path === "/tienda-config" && method === "PUT") {
      requireRole(auth?.role, ["admin"]);
      const body = await req.json();
      return NextResponse.json(await s.tiendaConfig.upsertConfig(tenantId, body));
    }

    /* -------- Orders (admin) -------- */
    if (path === "/orders" && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      const statusParam = String(url.searchParams.get("status") ?? "all").trim();
      const allowedStatus = new Set([
        "all",
        "pending_payment",
        "paid",
        "failed",
        "cancelled",
        "expired",
        "fulfilled",
        "refunded"
      ]);
      const status = allowedStatus.has(statusParam) ? statusParam : "all";
      const search = url.searchParams.get("search")?.trim() || undefined;
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const data = await s.orders.listOrdersByTenant(tenantId, {
        status: status as never,
        search,
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0
      });
      return NextResponse.json(data);
    }
    const orderById = /^\/orders\/([^/]+)$/.exec(path);
    if (orderById && method === "GET") {
      requireRole(auth?.role, ["admin", "vendedor", "viewer"]);
      const detail = await s.orders.getOrderDetail(tenantId, orderById[1]);
      if (!detail) return jsonMessage(404, "Order no encontrada");
      return NextResponse.json(detail);
    }
    const orderFulfill = /^\/orders\/([^/]+)\/fulfill$/.exec(path);
    if (orderFulfill && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const ok = await s.orders.markOrderFulfilled(tenantId, orderFulfill[1]);
      return NextResponse.json({ ok });
    }
    const orderCancel = /^\/orders\/([^/]+)\/cancel$/.exec(path);
    if (orderCancel && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const ok = await s.orders.markOrderUnpaid(tenantId, orderCancel[1], "cancelled");
      if (!ok) return jsonMessage(409, "Solo se puede cancelar una Order pendiente de pago");
      return NextResponse.json({ ok });
    }

    /* -------- Storefront público (sin JWT) -------- */
    if (path === "/public/store" && method === "GET") {
      return handlePublicStore(url);
    }
    if (path === "/public/categories" && method === "GET") {
      return handlePublicCategories(url, s);
    }
    if (path === "/public/products" && method === "GET") {
      return handlePublicProducts(url, s);
    }
    const publicProductDetail = /^\/public\/products\/([^/]+)$/.exec(path);
    if (publicProductDetail && method === "GET") {
      return handlePublicProductDetail(publicProductDetail[1], url, s);
    }
    if (path === "/public/facets" && method === "GET") {
      return handlePublicFacets(url, s);
    }
    if (path === "/public/checkout" && method === "POST") {
      const result = await handlePublicCheckout(req, url, s);
      return result;
    }
    const publicOrder = /^\/public\/orders\/([^/]+)\/status$/.exec(path);
    if (publicOrder && method === "GET") {
      const result = await handlePublicOrderStatus(publicOrder[1], url, s);
      return result;
    }

    return jsonMessage(404, "Not found");
  } catch (e) {
    return httpExceptionToResponse(e);
  }
}

const SUGGESTION_FRESH_WINDOW_MS = Number(process.env.SUGGESTION_FRESH_WINDOW_MS ?? 10 * 60 * 1000);

async function findConversationByPhone(tenantId: string, phone: string) {
  const { prisma } = await import("@waseller/db");
  return prisma.conversation.findFirst({
    where: { tenantId, phone },
    orderBy: { updatedAt: "desc" },
    select: { id: true, leadId: true }
  });
}

async function loadLatestSuggestion(conversationId: string) {
  const { prisma } = await import("@waseller/db");
  return prisma.conversationSuggestion.findFirst({
    where: { conversationId, status: { in: ["fresh", "stale", "used"] } },
    orderBy: { generatedAt: "desc" }
  });
}

async function enqueueSuggestionJob(args: {
  tenantId: string;
  conversationId: string;
  leadId?: string | null;
  phone: string;
  trigger: "manual_regen" | "conversation_open";
}) {
  const { suggestionGenerationQueue, buildStableDedupeKey, JOB_SCHEMA_VERSION, buildCorrelationId } =
    await import("@waseller/queue");
  const dedupeKey = buildStableDedupeKey(
    "suggestion",
    args.tenantId,
    args.phone,
    args.trigger,
    String(Date.now())
  );
  await suggestionGenerationQueue.add(
    `suggestion-${args.trigger}`,
    {
      schemaVersion: JOB_SCHEMA_VERSION,
      correlationId: buildCorrelationId(),
      dedupeKey,
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      leadId: args.leadId ?? null,
      phone: args.phone,
      triggerMessageId: null,
      trigger: args.trigger
    },
    { jobId: `suggestion_${dedupeKey}` }
  );
}

async function getOrEnqueueSuggestion(tenantId: string, phone: string) {
  const conversation = await findConversationByPhone(tenantId, phone);
  if (!conversation) return { suggestion: null, status: "no_conversation" as const };

  const latest = await loadLatestSuggestion(conversation.id);
  const isFresh =
    latest?.status === "fresh" &&
    Date.now() - new Date(latest.generatedAt).getTime() < SUGGESTION_FRESH_WINDOW_MS;

  if (!isFresh) {
    await enqueueSuggestionJob({
      tenantId,
      conversationId: conversation.id,
      leadId: conversation.leadId,
      phone,
      trigger: "conversation_open"
    });
  }

  return {
    suggestion: latest,
    status: isFresh ? ("fresh" as const) : ("regenerating" as const)
  };
}

async function regenerateSuggestion(tenantId: string, phone: string) {
  const conversation = await findConversationByPhone(tenantId, phone);
  if (!conversation) return { ok: false, reason: "no_conversation" };
  await enqueueSuggestionJob({
    tenantId,
    conversationId: conversation.id,
    leadId: conversation.leadId,
    phone,
    trigger: "manual_regen"
  });
  return { ok: true, status: "regenerating" as const };
}

async function markSuggestionUsed(tenantId: string, suggestionId: string) {
  const { prisma } = await import("@waseller/db");
  const updated = await prisma.conversationSuggestion.updateMany({
    where: { id: suggestionId, tenantId },
    data: { status: "used", usedAt: new Date() }
  });
  return { ok: updated.count > 0 };
}

/** Levenshtein simple — para mensajes <= ~500 chars. O(n*m) memoria; alcanza para nuestro uso. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenDiff(draft: string, sent: string): { added: number; removed: number } {
  const draftBag = new Map<string, number>();
  for (const t of tokenize(draft)) draftBag.set(t, (draftBag.get(t) ?? 0) + 1);
  const sentBag = new Map<string, number>();
  for (const t of tokenize(sent)) sentBag.set(t, (sentBag.get(t) ?? 0) + 1);
  let added = 0;
  let removed = 0;
  for (const [tok, c] of sentBag) added += Math.max(0, c - (draftBag.get(tok) ?? 0));
  for (const [tok, c] of draftBag) removed += Math.max(0, c - (sentBag.get(tok) ?? 0));
  return { added, removed };
}

async function enqueueConversationIndexingByLead(tenantId: string, leadId: string) {
  const { prisma } = await import("@waseller/db");
  const conv = await prisma.conversation.findFirst({
    where: { tenantId, leadId },
    select: { id: true }
  });
  if (!conv) return { ok: false, reason: "no_conversation" };
  const { conversationIndexingQueue } = await import("@waseller/queue");
  await conversationIndexingQueue.add(
    "index-conversation",
    { tenantId, conversationId: conv.id },
    { jobId: `index_conv_${conv.id}` }
  );
  return { ok: true };
}

async function enqueueSyntheticGeneration(
  tenantId: string,
  count: number,
  segments: string[]
) {
  const VALID = new Set(["mujer", "hombre", "unisex", "ninos"]);
  const targets = (segments.length > 0 ? segments : Array.from(VALID)).filter((s) => VALID.has(s));
  if (targets.length === 0) {
    return { ok: false, reason: "no_valid_segments" };
  }
  const safeCount = Math.max(1, Math.min(500, Math.floor(count)));
  const { syntheticConversationGenQueue } = await import("@waseller/queue");
  let enqueued = 0;
  for (let i = 0; i < safeCount; i++) {
    const segment = targets[i % targets.length];
    await syntheticConversationGenQueue.add(
      "synthetic",
      { tenantId, segment },
      {
        // Sin jobId estable — cada generación debe ser independiente.
        attempts: 2
      }
    );
    enqueued++;
  }
  return { ok: true, enqueued, segments: targets };
}

async function getSyntheticProgress(tenantId: string) {
  const { syntheticConversationGenQueue } = await import("@waseller/queue");
  const { prisma } = await import("@waseller/db");

  /** BullMQ job counts globales (no filtrables por tenant). En la práctica solo un tenant
   *  corre generación a la vez; para el panel sirve. */
  const counts = await syntheticConversationGenQueue.getJobCounts(
    "active",
    "waiting",
    "delayed",
    "completed",
    "failed",
    "paused"
  );

  /** Inserciones del tenant en los últimos 10 min — esto sí es per-tenant. */
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentInsertedTurns = await prisma.conversationTurnExample.count({
    where: {
      tenantId,
      source: "synthetic",
      indexedAt: { gte: tenMinAgo }
    }
  });

  /** Últimas 6 conversaciones sintéticas indexadas: muestra qué se está generando. */
  const lastConversationsRaw = (await (prisma as any).$queryRawUnsafe(
    `SELECT conversation_id, segment, scenario, MIN(indexed_at) as started_at, COUNT(*)::int as turn_count
     FROM conversation_turn_examples
     WHERE tenant_id = $1::uuid AND source = 'synthetic' AND indexed_at >= $2
     GROUP BY conversation_id, segment, scenario
     ORDER BY started_at DESC
     LIMIT 6`,
    tenantId,
    tenMinAgo
  )) as Array<{
    conversation_id: string;
    segment: string | null;
    scenario: string | null;
    started_at: Date;
    turn_count: number;
  }>;

  return {
    queue: {
      active: Number(counts.active ?? 0),
      waiting: Number(counts.waiting ?? 0),
      delayed: Number(counts.delayed ?? 0),
      completed: Number(counts.completed ?? 0),
      failed: Number(counts.failed ?? 0),
      paused: Number(counts.paused ?? 0)
    },
    recentInsertedTurns,
    lastConversations: lastConversationsRaw.map((r) => ({
      conversationId: r.conversation_id,
      segment: r.segment,
      scenario: r.scenario,
      startedAt: r.started_at.toISOString(),
      turnCount: r.turn_count
    }))
  };
}

async function clearSyntheticTurns(tenantId: string) {
  const { prisma } = await import("@waseller/db");
  const deleted = await (prisma as any).$executeRawUnsafe(
    `DELETE FROM conversation_turn_examples WHERE tenant_id = $1::uuid AND source = 'synthetic'`,
    tenantId
  );
  return { ok: true, deleted: Number(deleted) };
}

async function getRagStats(tenantId: string) {
  const { prisma } = await import("@waseller/db");
  const rows = (await (prisma as any).$queryRawUnsafe(
    `SELECT
       COUNT(*)::int AS total_examples,
       COUNT(DISTINCT conversation_id)::int AS conversations,
       COUNT(DISTINCT product_name) FILTER (WHERE product_name IS NOT NULL)::int AS products,
       MAX(indexed_at) AS last_indexed_at,
       COUNT(*) FILTER (WHERE source = 'real')::int AS real_count,
       COUNT(*) FILTER (WHERE source = 'imported')::int AS imported_count,
       COUNT(*) FILTER (WHERE source = 'synthetic')::int AS synthetic_count
     FROM conversation_turn_examples
     WHERE tenant_id = $1::uuid`,
    tenantId
  )) as Array<{
    total_examples: number;
    conversations: number;
    products: number;
    last_indexed_at: Date | null;
    real_count: number;
    imported_count: number;
    synthetic_count: number;
  }>;
  const stats = rows[0] ?? {
    total_examples: 0,
    conversations: 0,
    products: 0,
    last_indexed_at: null,
    real_count: 0,
    imported_count: 0,
    synthetic_count: 0
  };

  const segmentRows = (await (prisma as any).$queryRawUnsafe(
    `SELECT segment, COUNT(*)::int AS c
     FROM conversation_turn_examples
     WHERE tenant_id = $1::uuid AND segment IS NOT NULL
     GROUP BY segment`,
    tenantId
  )) as Array<{ segment: string; c: number }>;

  const vendidoLeads = await prisma.lead.count({
    where: { tenantId, status: "vendido" }
  });

  return {
    totalExamples: stats.total_examples,
    indexedConversations: stats.conversations,
    productsCovered: stats.products,
    lastIndexedAt: stats.last_indexed_at ? new Date(stats.last_indexed_at).toISOString() : null,
    vendidoLeads,
    bySource: {
      real: stats.real_count,
      imported: stats.imported_count,
      synthetic: stats.synthetic_count
    },
    bySegment: segmentRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.segment] = r.c;
      return acc;
    }, {})
  };
}

async function backfillRagFromVendidoLeads(tenantId: string) {
  const { prisma } = await import("@waseller/db");
  const { conversationIndexingQueue } = await import("@waseller/queue");
  const leads = await prisma.lead.findMany({
    where: { tenantId, status: "vendido" },
    select: { id: true, conversation: { select: { id: true } } }
  });
  let enqueued = 0;
  for (const lead of leads) {
    const conversationId = lead.conversation?.id;
    if (!conversationId) continue;
    await conversationIndexingQueue.add(
      "index-conversation",
      { tenantId, conversationId },
      { jobId: `index_conv_${conversationId}` }
    );
    enqueued++;
  }
  return { ok: true, enqueued, totalVendidoLeads: leads.length };
}

async function previewWhatsappImport(content: string) {
  if (!content || content.length < 20) {
    return { ok: false, reason: "empty_content" };
  }
  const { parseWhatsappExport } = await import("./whatsapp-parser");
  const parsed = parseWhatsappExport(content);
  return {
    ok: true,
    totalMessages: parsed.messages.length,
    speakers: parsed.speakers
  };
}

async function importWhatsappExport(
  tenantId: string,
  content: string,
  sellerSpeaker: string,
  contactPhone: string
) {
  if (!content || !sellerSpeaker) {
    return { ok: false, reason: "missing_input" };
  }
  const { parseWhatsappExport } = await import("./whatsapp-parser");
  const { prisma } = await import("@waseller/db");
  const parsed = parseWhatsappExport(content);
  const phone = (contactPhone || "").replace(/[^\d]/g, "") || `imported-${Date.now().toString(36)}`;
  const importTag = `wa_import_${Date.now().toString(36)}`;

  let inserted = 0;
  for (const msg of parsed.messages) {
    if (!msg.text || msg.text.length < 2) continue;
    const direction = msg.speaker === sellerSpeaker ? "outgoing" : "incoming";
    try {
      await prisma.message.create({
        data: {
          tenantId,
          phone,
          message: msg.text,
          direction,
          correlationId: importTag,
          createdAt: msg.timestamp ? new Date(msg.timestamp) : undefined
        }
      });
      inserted++;
    } catch {
      // Best-effort: si una fila falla (timestamp inválido, etc.), continuamos.
    }
  }

  // Disparamos recompute del style profile para que tome los nuevos mensajes.
  try {
    await enqueueStyleProfileRecompute(tenantId);
  } catch (e) {
    console.error("[whatsapp-import] no se pudo encolar recompute", e);
  }

  return {
    ok: true,
    inserted,
    totalParsed: parsed.messages.length,
    sellerSpeaker,
    contactPhone: phone,
    importTag
  };
}

async function loadStyleProfile(tenantId: string) {
  const { prisma } = await import("@waseller/db");
  const row = await prisma.tenantStyleProfile.findUnique({ where: { tenantId } });
  if (!row) return { profile: null };
  return {
    profile: {
      avgLength: row.avgLength,
      emojiDensity: row.emojiDensity,
      formality: row.formality,
      topGreetings: row.topGreetings,
      topClosings: row.topClosings,
      topEmojis: row.topEmojis,
      catchphrases: row.catchphrases,
      usesAbbreviations: row.usesAbbreviations,
      sampleCount: row.sampleCount,
      computedAt: row.computedAt
    }
  };
}

async function enqueueStyleProfileRecompute(tenantId: string) {
  const { styleProfileRecomputeQueue } = await import("@waseller/queue");
  await styleProfileRecomputeQueue.add(
    "recompute",
    { tenantId },
    { jobId: `style-profile-${tenantId}` }
  );
}

async function getCopilotQualityMetrics(tenantId: string, days: number) {
  const { prisma } = await import("@waseller/db");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const outcomes = await prisma.suggestionOutcome.findMany({
    where: { tenantId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      draftWasOffered: true,
      usedAsIs: true,
      editDistance: true,
      tokensAdded: true,
      tokensRemoved: true,
      draftReply: true,
      sentMessage: true,
      createdAt: true
    },
    take: 5000
  });

  type OutcomeRow = (typeof outcomes)[number];
  const total = outcomes.length;
  const withDraft = outcomes.filter((o: OutcomeRow) => o.draftWasOffered);
  const withDraftCount = withDraft.length;
  const usedAsIsCount = withDraft.filter((o: OutcomeRow) => o.usedAsIs).length;

  const editDistances = withDraft
    .map((o: OutcomeRow) => o.editDistance)
    .sort((a: number, b: number) => a - b);
  const median = editDistances.length
    ? editDistances[Math.floor(editDistances.length / 2)]
    : 0;
  const avg = editDistances.length
    ? Math.round(editDistances.reduce((s: number, x: number) => s + x, 0) / editDistances.length)
    : 0;

  const totalTokensAdded = withDraft.reduce((s: number, o: OutcomeRow) => s + o.tokensAdded, 0);
  const totalTokensRemoved = withDraft.reduce((s: number, o: OutcomeRow) => s + o.tokensRemoved, 0);

  const recentSamples = outcomes.slice(0, 20).map((o: OutcomeRow) => ({
    draftReply: o.draftReply,
    sentMessage: o.sentMessage,
    editDistance: o.editDistance,
    usedAsIs: o.usedAsIs,
    draftWasOffered: o.draftWasOffered,
    createdAt: o.createdAt.toISOString()
  }));

  return {
    range: { days, since: since.toISOString() },
    totals: {
      replies: total,
      withDraftOffered: withDraftCount,
      usedAsIs: usedAsIsCount
    },
    rates: {
      draftCoverage: total > 0 ? withDraftCount / total : 0,
      acceptanceAsIs: withDraftCount > 0 ? usedAsIsCount / withDraftCount : 0
    },
    edits: {
      avgEditDistance: avg,
      medianEditDistance: median,
      totalTokensAdded,
      totalTokensRemoved
    },
    recentSamples
  };
}

async function captureSuggestionOutcome(
  tenantId: string,
  phone: string,
  sentMessage: string
): Promise<void> {
  const { prisma } = await import("@waseller/db");
  const conversation = await prisma.conversation.findFirst({
    where: { tenantId, phone },
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });
  if (!conversation) return;

  /** La sugerencia "activa" puede estar en estado fresh (sin clic) o used (clickeó "Usar borrador"). */
  const suggestion = await prisma.conversationSuggestion.findFirst({
    where: { conversationId: conversation.id, status: { in: ["fresh", "used"] } },
    orderBy: { generatedAt: "desc" }
  });

  const draft = suggestion?.draftReply ?? "";
  const draftWasOffered = Boolean(suggestion?.draftReply);
  const editDistance = draftWasOffered ? levenshtein(draft, sentMessage) : 0;
  const usedAsIs = draftWasOffered && draft.trim() === sentMessage.trim();
  const { added, removed } = draftWasOffered
    ? tokenDiff(draft, sentMessage)
    : { added: tokenize(sentMessage).length, removed: 0 };

  await prisma.suggestionOutcome.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      suggestionId: suggestion?.id ?? null,
      draftReply: suggestion?.draftReply ?? null,
      sentMessage,
      draftWasOffered,
      usedAsIs,
      editDistance,
      tokensAdded: added,
      tokensRemoved: removed
    }
  });
}

/** Resuelve el origin público del storefront para armar back_urls absolutas de Mercado Pago.
 * Orden de precedencia (de más específico a menos):
 *   1) `tenantStorefrontBaseUrl` — campo `tenants.storefront_base_url` (multi-dominio por cliente)
 *   2) `PUBLIC_STOREFRONT_BASE_URL` — env global (single-tenant o monorepo del dashboard)
 *   3) header `x-forwarded-host` (Vercel) o `request.url` (último recurso)
 *
 * Sin (1) o (2), si tenés varios clientes en distintos dominios, MP redirige al dominio del request
 * actual (o sea, al dashboard) en vez del storefront del cliente — y rompe la UX. */
function resolveStorefrontOrigin(
  req: NextRequest,
  url: URL,
  tenantStorefrontBaseUrl?: string | null
): string {
  const tenantOverride = String(tenantStorefrontBaseUrl ?? "").trim().replace(/\/$/, "");
  if (tenantOverride) return tenantOverride;
  const explicit = String(process.env.PUBLIC_STOREFRONT_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) {
    return `${forwardedProto || url.protocol.replace(":", "")}://${forwardedHost}`;
  }
  return url.origin;
}

async function handlePublicCheckout(
  req: NextRequest,
  url: URL,
  s: ReturnType<typeof getBackendServices>
): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as {
    slug?: string;
    items?: Array<{ variantId?: string; quantity?: number }>;
    buyer?: { name?: string; email?: string; phone?: string; notes?: string };
  };
  const slug = String(body.slug ?? "").trim();
  if (!slug) return NextResponse.json({ message: "Falta el slug de la tienda." }, { status: 400 });

  const { prisma } = await import("@waseller/db");
  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { id: true, name: true, storefrontBaseUrl: true }
  });
  if (!tenant) return NextResponse.json({ message: "Tienda no encontrada." }, { status: 404 });

  const items = (body.items ?? []).map((it) => ({
    variantId: String(it?.variantId ?? "").trim(),
    quantity: Number(it?.quantity ?? 0)
  }));
  const buyer = {
    name: String(body.buyer?.name ?? "").trim(),
    email: String(body.buyer?.email ?? "").trim(),
    phone: String(body.buyer?.phone ?? "").trim(),
    notes: body.buyer?.notes ? String(body.buyer.notes) : undefined
  };

  const created = await s.orders.createPendingOrder({
    tenantId: tenant.id,
    items,
    buyer,
    metadata: { slug, source: "storefront" }
  });

  const origin = resolveStorefrontOrigin(req, url, tenant.storefrontBaseUrl);
  const orderId = created.order.id;
  const backUrls = {
    success: `${origin}/tienda/${slug}/checkout/exito?order_id=${orderId}`,
    failure: `${origin}/tienda/${slug}/checkout/fracaso?order_id=${orderId}`,
    pending: `${origin}/tienda/${slug}/checkout/pendiente?order_id=${orderId}`
  };

  let preference: { checkoutUrl: string; paymentAttemptId: string; preferenceId: string };
  try {
    preference = await s.mercadoPago.createOrderCheckoutPreference({
      tenantId: tenant.id,
      orderId,
      externalReference: created.order.externalReference,
      items: created.items.map((it) => ({
        title: `${it.productName} (${it.variantSku})`,
        quantity: it.quantity,
        unitPrice: it.unitPrice
      })),
      payer: {
        name: buyer.name,
        email: buyer.email,
        phone: buyer.phone
      },
      backUrls,
      metadata: { slug }
    });
  } catch (e) {
    /** Si MP falla, liberamos el stock reservado para no dejar la orden colgada. */
    await s.orders.markOrderUnpaid(tenant.id, orderId, "failed").catch(() => undefined);
    throw e;
  }

  /** Encolamos expiración con delay = TTL para liberar stock si MP no confirma.
   * IMPORTANTE: el cliente ioredis está configurado con maxRetriesPerRequest=null (BullMQ lo exige) → si Redis
   * no es alcanzable el comando NUNCA falla, se cuelga indefinido. Por eso usamos Promise.race con timeout duro
   * de 5s. Sin TTL la reserva quedaría infinita, así que abortamos la compra con 503. */
  try {
    const { orderReservationExpiryQueue } = await import("@waseller/queue");
    const expiresAt = created.order.expiresAt ? new Date(created.order.expiresAt).getTime() : Date.now() + 15 * 60 * 1000;
    const delay = Math.max(1000, expiresAt - Date.now());
    await Promise.race([
      orderReservationExpiryQueue.add(
        "order-expiry",
        { tenantId: tenant.id, orderId },
        { jobId: `order_expiry_${orderId}`, delay }
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis enqueue timeout (5s)")), 5000)
      ),
    ]);
  } catch (e) {
    console.error("[checkout] no se pudo encolar expiración, abortando para no reservar stock indefinidamente:", e);
    await s.orders.markOrderUnpaid(tenant.id, orderId, "failed").catch(() => undefined);
    return NextResponse.json(
      {
        message:
          "No pudimos iniciar tu compra (cola de expiración no disponible). Verificá REDIS_URL en producción.",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    orderId,
    externalReference: created.order.externalReference,
    checkoutUrl: preference.checkoutUrl,
    totalAmount: created.order.totalAmount,
    currency: created.order.currency
  });
}

async function handlePublicOrderStatus(
  orderId: string,
  url: URL,
  s: ReturnType<typeof getBackendServices>
): Promise<NextResponse> {
  const slug = String(url.searchParams.get("slug") ?? "").trim();
  if (!slug) return NextResponse.json({ message: "Falta slug." }, { status: 400 });
  const tenantId = await resolveTenantIdBySlug(slug);
  if (!tenantId) return NextResponse.json({ message: "Tienda no encontrada." }, { status: 404 });
  const result = await s.orders.getOrderById(tenantId, orderId);
  if (!result) return NextResponse.json({ message: "Order no encontrada." }, { status: 404 });
  /** Solo exponemos status + monto (no los datos del comprador) para evitar fishing por enumeración. */
  return NextResponse.json({
    orderId: result.order.id,
    status: result.order.status,
    totalAmount: result.order.totalAmount,
    currency: result.order.currency,
    paidAt: result.order.paidAt,
    expiresAt: result.order.expiresAt,
    itemCount: result.items.reduce((acc, it) => acc + it.quantity, 0)
  });
}

/* ─── Helpers compartidos por handlers públicos ─────────────────── */

/** Lookup mínimo de tenant por slug. Centralizado para evitar re-importar prisma en cada handler. */
async function resolveTenantIdBySlug(slug: string): Promise<string | null> {
  const { prisma } = await import("@waseller/db");
  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: { id: true }
  });
  return tenant?.id ?? null;
}

function readSlug(url: URL): string {
  return String(url.searchParams.get("slug") ?? "").trim();
}

/* ─── GETs públicos para storefronts externos ────────────────────── */

/** Datos del tenant + storeConfig normalizado. Lo necesita el storefront para pintar marca, hero, contacto, etc. */
async function handlePublicStore(url: URL): Promise<NextResponse> {
  const slug = readSlug(url);
  if (!slug) return NextResponse.json({ message: "Falta slug." }, { status: 400 });
  const { prisma } = await import("@waseller/db");
  const tenant = await prisma.tenant.findUnique({
    where: { publicCatalogSlug: slug },
    select: {
      id: true,
      name: true,
      publicCatalogSlug: true,
      storefrontBaseUrl: true,
      storeConfig: { select: { config: true, updatedAt: true } }
    }
  });
  if (!tenant) return NextResponse.json({ message: "Tienda no encontrada." }, { status: 404 });
  const { normalizeStoreConfig } = await import("@waseller/shared");
  const config = normalizeStoreConfig(tenant.storeConfig?.config ?? {});
  return NextResponse.json({
    tenantId: tenant.id,
    name: tenant.name,
    slug: tenant.publicCatalogSlug,
    storefrontBaseUrl: tenant.storefrontBaseUrl,
    config,
    configUpdatedAt: tenant.storeConfig?.updatedAt
      ? new Date(tenant.storeConfig.updatedAt).toISOString()
      : null
  });
}

/** Árbol de categorías activas para armar menús/filtros. */
async function handlePublicCategories(
  url: URL,
  _s: ReturnType<typeof getBackendServices>
): Promise<NextResponse> {
  const slug = readSlug(url);
  if (!slug) return NextResponse.json({ message: "Falta slug." }, { status: 400 });
  const tenantId = await resolveTenantIdBySlug(slug);
  if (!tenantId) return NextResponse.json({ message: "Tienda no encontrada." }, { status: 404 });
  const { prisma } = await import("@waseller/db");
  const rows = await prisma.category.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, parentId: true, name: true, slug: true, sortOrder: true }
  });
  return NextResponse.json({ categories: rows });
}

/** Catálogo: mismo shape que listPublicCatalogByTenant + filtros. Devuelve agrupado por producto. */
async function handlePublicProducts(
  url: URL,
  s: ReturnType<typeof getBackendServices>
): Promise<NextResponse> {
  const slug = readSlug(url);
  if (!slug) return NextResponse.json({ message: "Falta slug." }, { status: 400 });
  const tenantId = await resolveTenantIdBySlug(slug);
  if (!tenantId) return NextResponse.json({ message: "Tienda no encontrada." }, { status: 404 });
  const rows = await s.products.listPublicCatalogByTenant(tenantId, {
    categoryId: url.searchParams.get("categoryId")?.trim() || undefined,
    q: url.searchParams.get("q")?.trim() || undefined,
    talle: url.searchParams.get("talle")?.trim() || undefined,
    color: url.searchParams.get("color")?.trim() || undefined,
    marca: url.searchParams.get("marca")?.trim() || undefined
  });
  return NextResponse.json({ variants: rows });
}

/** Detalle de producto: variantes + categorías. Para la página de producto del storefront. */
async function handlePublicProductDetail(
  productId: string,
  url: URL,
  s: ReturnType<typeof getBackendServices>
): Promise<NextResponse> {
  const slug = readSlug(url);
  if (!slug) return NextResponse.json({ message: "Falta slug." }, { status: 400 });
  const tenantId = await resolveTenantIdBySlug(slug);
  if (!tenantId) return NextResponse.json({ message: "Tienda no encontrada." }, { status: 404 });
  const result = await s.products.getPublicProductDetailsByTenant(tenantId, productId);
  if (!result.variants.length) {
    return NextResponse.json({ message: "Producto no encontrado." }, { status: 404 });
  }
  return NextResponse.json(result);
}

/** Valores distintos de talle/color/marca para armar selects de filtros. */
async function handlePublicFacets(
  url: URL,
  s: ReturnType<typeof getBackendServices>
): Promise<NextResponse> {
  const slug = readSlug(url);
  if (!slug) return NextResponse.json({ message: "Falta slug." }, { status: 400 });
  const tenantId = await resolveTenantIdBySlug(slug);
  if (!tenantId) return NextResponse.json({ message: "Tienda no encontrada." }, { status: 404 });
  const facets = await s.products.listVariantFacetDistinctValues(tenantId, {
    categoryId: url.searchParams.get("categoryId")?.trim() || undefined,
    publicCatalog: true
  });
  return NextResponse.json(facets);
}
