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
      return NextResponse.json(data);
    }
    const markCobrado = /^\/leads\/([^/]+)\/mark-cobrado$/.exec(path);
    if (markCobrado && method === "PATCH") {
      requireRole(auth?.role, ["admin", "vendedor"]);
      const data = await s.leads.markAs(tenantId, markCobrado[1], "vendido");
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
      return NextResponse.json(await s.conversations.manualReply(tenantId, convReply[1], body.message));
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

    return jsonMessage(404, "Not found");
  } catch (e) {
    return httpExceptionToResponse(e);
  }
}
