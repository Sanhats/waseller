import { BadRequestException, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../../../../packages/db/src";
import {
  JOB_SCHEMA_VERSION,
  buildCorrelationId,
  buildStableDedupeKey,
  outgoingQueue
} from "../../../../../packages/queue/src";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  signMercadoPagoState,
  verifyMercadoPagoState,
  verifyMercadoPagoWebhookSignature
} from "../../../../../packages/shared/src";
import { LeadsService } from "../leads/leads.service";
import { OrdersService } from "../orders/orders.service";

type MercadoPagoIntegrationRow = {
  id: string;
  tenantId: string;
  provider: string;
  status: "disconnected" | "connected" | "expired" | "error";
  externalAccountId?: string | null;
  externalAccountLabel?: string | null;
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  publicKey?: string | null;
  tokenType?: string | null;
  scope?: string | null;
  expiresAt?: Date | string | null;
  connectedAt?: Date | string | null;
  lastError?: string | null;
  metadata?: unknown;
};

type MercadoPagoOauthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  public_key?: string;
  scope?: string;
  user_id?: number | string;
  expires_in?: number;
  live_mode?: boolean;
};

type MercadoPagoPaymentResponse = {
  id: number | string;
  status: string;
  external_reference?: string | null;
  date_approved?: string | null;
  order?: { id?: string | number | null } | null;
  metadata?: Record<string, unknown> | null;
};

type MercadoPagoStatusResponse = {
  provider: "mercadopago";
  configured: boolean;
  status: "disconnected" | "connected" | "expired" | "error";
  accountId: string | null;
  accountLabel: string | null;
  publicKey: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
};

type SignedOAuthState = {
  tenantId: string;
  exp: number;
  nonce: string;
};

const buildPaymentStatusMessage = (status: string, productName: string): string | null => {
  if (status === "approved") {
    return `Recibimos el pago de ${productName}. Ya quedó confirmado y seguimos por este medio con la entrega.`;
  }
  if (status === "pending") {
    return `Tu pago de ${productName} quedó registrado como pendiente. Apenas se acredite te confirmamos por este medio.`;
  }
  if (status === "rejected" || status === "cancelled") {
    return `Vimos un inconveniente con el pago de ${productName}. Si querés, te generamos un nuevo link o seguimos con otra forma de pago.`;
  }
  return null;
};

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);

  constructor(
    private readonly leadsService: LeadsService,
    private readonly ordersService: OrdersService
  ) {}

  private get clientId(): string {
    return process.env.MERCADO_PAGO_CLIENT_ID ?? "";
  }

  private get clientSecret(): string {
    return process.env.MERCADO_PAGO_CLIENT_SECRET ?? "";
  }

  /** Base pública del API (mismo host que ngrok expone hacia el backend). */
  private get publicApiBaseUrl(): string {
    return String(process.env.PUBLIC_API_BASE_URL ?? "").trim().replace(/\/$/, "");
  }

  /**
   * OAuth redirect: `MERCADO_PAGO_REDIRECT_URI` si está definida; si no, se arma desde `PUBLIC_API_BASE_URL`
   * para no duplicar el host cada vez que cambia ngrok.
   */
  private get redirectUri(): string {
    const explicit = String(process.env.MERCADO_PAGO_REDIRECT_URI ?? "").trim();
    if (explicit) return explicit;
    const base = this.publicApiBaseUrl;
    if (!base) return "";
    return `${base}/api/integrations/mercadopago/callback`;
  }

  private get apiBaseUrl(): string {
    return process.env.MERCADO_PAGO_API_BASE_URL ?? "https://api.mercadopago.com";
  }

  private get authBaseUrl(): string {
    return process.env.MERCADO_PAGO_AUTH_BASE_URL ?? "https://auth.mercadopago.com/authorization";
  }

  private get oauthScope(): string {
    return process.env.MERCADO_PAGO_OAUTH_SCOPE ?? "offline_access";
  }

  private get webhookSecret(): string {
    return process.env.MERCADO_PAGO_WEBHOOK_SECRET ?? "";
  }

  private ensureConfigured(): void {
    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new BadRequestException(
        "Falta configurar MERCADO_PAGO_CLIENT_ID, MERCADO_PAGO_CLIENT_SECRET, y MERCADO_PAGO_REDIRECT_URI o PUBLIC_API_BASE_URL (se usa .../api/integrations/mercadopago/callback)."
      );
    }
  }

  private buildPopupHtml(options: { ok: boolean; tenantId?: string; message: string }): string {
    const payload = JSON.stringify({
      source: "mercadopago-oauth",
      ok: options.ok,
      tenantId: options.tenantId ?? null,
      message: options.message
    });
    return `<!doctype html><html><head><meta charset="utf-8"><title>Mercado Pago</title></head><body><script>
      (function () {
        const payload = ${payload};
        if (window.opener) {
          window.opener.postMessage(payload, "*");
          window.close();
          return;
        }
        document.body.innerText = payload.message;
      })();
    </script></body></html>`;
  }

  private mapTenantPaymentRow(row: {
    id: string;
    tenantId: string;
    provider: string;
    status: string;
    externalAccountId: string | null;
    externalAccountLabel: string | null;
    accessTokenEncrypted: string | null;
    refreshTokenEncrypted: string | null;
    publicKey: string | null;
    tokenType: string | null;
    scope: string | null;
    expiresAt: Date | null;
    connectedAt: Date | null;
    lastError: string | null;
    metadata: unknown;
  }): MercadoPagoIntegrationRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      status: row.status as MercadoPagoIntegrationRow["status"],
      externalAccountId: row.externalAccountId,
      externalAccountLabel: row.externalAccountLabel,
      accessTokenEncrypted: row.accessTokenEncrypted,
      refreshTokenEncrypted: row.refreshTokenEncrypted,
      publicKey: row.publicKey,
      tokenType: row.tokenType,
      scope: row.scope,
      expiresAt: row.expiresAt,
      connectedAt: row.connectedAt,
      lastError: row.lastError,
      metadata: row.metadata
    };
  }

  private async loadIntegrationByTenant(tenantId: string): Promise<MercadoPagoIntegrationRow | null> {
    const row = await prisma.tenantPaymentIntegration.findFirst({
      where: { tenantId, provider: "mercadopago" }
    });
    return row ? this.mapTenantPaymentRow(row) : null;
  }

  private async loadIntegrationByExternalAccount(externalAccountId: string): Promise<MercadoPagoIntegrationRow | null> {
    const row = await prisma.tenantPaymentIntegration.findFirst({
      where: { provider: "mercadopago", externalAccountId }
    });
    return row ? this.mapTenantPaymentRow(row) : null;
  }

  private async upsertIntegration(
    tenantId: string,
    payload: {
      status: "disconnected" | "connected" | "expired" | "error";
      externalAccountId?: string | null;
      externalAccountLabel?: string | null;
      accessToken?: string | null;
      refreshToken?: string | null;
      publicKey?: string | null;
      tokenType?: string | null;
      scope?: string | null;
      expiresAt?: Date | null;
      connectedAt?: Date | null;
      lastError?: string | null;
      metadata?: Record<string, unknown> | null;
    }
  ): Promise<void> {
    const accessTokenEncrypted = payload.accessToken ? encryptIntegrationSecret(payload.accessToken) : null;
    const refreshTokenEncrypted = payload.refreshToken ? encryptIntegrationSecret(payload.refreshToken) : null;
    const metadataValue =
      payload.metadata === null || payload.metadata === undefined
        ? undefined
        : (payload.metadata as object);

    await prisma.tenantPaymentIntegration.upsert({
      where: {
        tenantId_provider: { tenantId, provider: "mercadopago" },
      },
      create: {
        tenantId,
        provider: "mercadopago",
        status: payload.status,
        externalAccountId: payload.externalAccountId ?? undefined,
        externalAccountLabel: payload.externalAccountLabel ?? undefined,
        accessTokenEncrypted: accessTokenEncrypted ?? undefined,
        refreshTokenEncrypted: refreshTokenEncrypted ?? undefined,
        publicKey: payload.publicKey ?? undefined,
        tokenType: payload.tokenType ?? undefined,
        scope: payload.scope ?? undefined,
        expiresAt: payload.expiresAt ?? undefined,
        connectedAt: payload.connectedAt ?? undefined,
        lastError: payload.lastError ?? undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: metadataValue as any,
      },
      update: {
        status: payload.status,
        externalAccountId: payload.externalAccountId ?? null,
        externalAccountLabel: payload.externalAccountLabel ?? null,
        accessTokenEncrypted: accessTokenEncrypted ?? null,
        refreshTokenEncrypted: refreshTokenEncrypted ?? null,
        publicKey: payload.publicKey ?? null,
        tokenType: payload.tokenType ?? null,
        scope: payload.scope ?? null,
        expiresAt: payload.expiresAt ?? null,
        connectedAt: payload.connectedAt ?? null,
        lastError: payload.lastError ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: metadataValue === undefined ? undefined : (metadataValue as any),
      },
    });
  }

  /**
   * Persiste estado de integración sin propagar errores a la respuesta HTTP del callback OAuth
   * (evita 500 si la BD falla tras un error ya manejado).
   */
  private async persistIntegrationBestEffort(
    tenantId: string,
    payload: {
      status: "disconnected" | "connected" | "expired" | "error";
      externalAccountId?: string | null;
      externalAccountLabel?: string | null;
      accessToken?: string | null;
      refreshToken?: string | null;
      publicKey?: string | null;
      tokenType?: string | null;
      scope?: string | null;
      expiresAt?: Date | null;
      connectedAt?: Date | null;
      lastError?: string | null;
      metadata?: Record<string, unknown> | null;
    }
  ): Promise<boolean> {
    try {
      await this.upsertIntegration(tenantId, payload);
      return true;
    } catch (error) {
      this.logger.error(
        `No se pudo persistir tenant_payment_integrations (tenant=${tenantId}): ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  private async requestOauthToken(body: Record<string, unknown>): Promise<MercadoPagoOauthTokenResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
    const response = await fetch(`${this.apiBaseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: params.toString()
    });
    const rawText = await response.text();
    if (!response.ok) {
      this.logger.warn(`Mercado Pago POST /oauth/token → ${response.status}: ${rawText.slice(0, 2000)}`);
      throw new InternalServerErrorException(rawText || `Mercado Pago oauth/token responded with ${response.status}`);
    }
    try {
      return JSON.parse(rawText) as MercadoPagoOauthTokenResponse;
    } catch {
      this.logger.error(`Mercado Pago oauth/token devolvió cuerpo no JSON: ${rawText.slice(0, 500)}`);
      throw new InternalServerErrorException("Mercado Pago oauth/token devolvió una respuesta inválida.");
    }
  }

  private async refreshIfNeeded(row: MercadoPagoIntegrationRow): Promise<{
    accessToken: string;
    row: MercadoPagoIntegrationRow;
  }> {
    const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;
    const accessToken = row.accessTokenEncrypted ? decryptIntegrationSecret(row.accessTokenEncrypted) : "";
    if (accessToken && (!expiresAt || expiresAt.getTime() > Date.now() + 5 * 60 * 1000)) {
      return { accessToken, row };
    }
    if (!row.refreshTokenEncrypted) {
      await this.upsertIntegration(row.tenantId, {
        status: "expired",
        externalAccountId: row.externalAccountId ?? null,
        externalAccountLabel: row.externalAccountLabel ?? null,
        publicKey: row.publicKey ?? null,
        tokenType: row.tokenType ?? null,
        scope: row.scope ?? null,
        expiresAt,
        connectedAt: row.connectedAt ? new Date(row.connectedAt) : null,
        lastError: "Access token vencido y sin refresh token.",
        metadata: (row.metadata as Record<string, unknown> | null) ?? null
      });
      throw new BadRequestException("La conexión de Mercado Pago venció. Reconectá la cuenta.");
    }
    const refreshed = await this.requestOauthToken({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptIntegrationSecret(row.refreshTokenEncrypted)
    });
    const nextExpiresAt = refreshed.expires_in
      ? new Date(Date.now() + Number(refreshed.expires_in) * 1000)
      : expiresAt;
    await this.upsertIntegration(row.tenantId, {
      status: "connected",
      externalAccountId: String(refreshed.user_id ?? row.externalAccountId ?? ""),
      externalAccountLabel: String(refreshed.user_id ?? row.externalAccountLabel ?? row.externalAccountId ?? ""),
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? decryptIntegrationSecret(row.refreshTokenEncrypted),
      publicKey: refreshed.public_key ?? row.publicKey ?? null,
      tokenType: refreshed.token_type ?? row.tokenType ?? null,
      scope: refreshed.scope ?? row.scope ?? null,
      expiresAt: nextExpiresAt,
      connectedAt: row.connectedAt ? new Date(row.connectedAt) : new Date(),
      lastError: null,
      metadata: { liveMode: refreshed.live_mode ?? true }
    });
    const nextRow = await this.loadIntegrationByTenant(row.tenantId);
    return {
      accessToken: refreshed.access_token,
      row: nextRow ?? row
    };
  }

  async getConnectUrl(tenantId: string): Promise<{ url: string }> {
    this.ensureConfigured();
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true }
    });
    if (!tenant) throw new BadRequestException("Tenant no encontrado.");
    const state = signMercadoPagoState({
      tenantId,
      exp: Date.now() + 10 * 60 * 1000,
      nonce: randomUUID()
    } satisfies SignedOAuthState);
    const url = new URL(this.authBaseUrl);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("state", state);
    if (this.oauthScope) url.searchParams.set("scope", this.oauthScope);
    return { url: url.toString() };
  }

  async getStatus(tenantId: string): Promise<MercadoPagoStatusResponse> {
    const globallyConfigured = Boolean(this.clientId && this.clientSecret && this.redirectUri);
    const row = await this.loadIntegrationByTenant(tenantId);
    if (!row) {
      return {
        provider: "mercadopago",
        configured: false,
        status: "disconnected",
        accountId: null,
        accountLabel: null,
        publicKey: null,
        connectedAt: null,
        expiresAt: null,
        lastError: globallyConfigured
          ? null
          : "Falta configurar MERCADO_PAGO_CLIENT_ID, MERCADO_PAGO_CLIENT_SECRET y MERCADO_PAGO_REDIRECT_URI o PUBLIC_API_BASE_URL."
      };
    }
    let effective = row;
    if (row.status === "connected") {
      try {
        effective = (await this.refreshIfNeeded(row)).row;
      } catch {
        effective = (await this.loadIntegrationByTenant(tenantId)) ?? row;
      }
    }
    return {
      provider: "mercadopago",
      configured: Boolean(effective.accessTokenEncrypted || effective.refreshTokenEncrypted || effective.connectedAt),
      status: effective.status,
      accountId: effective.externalAccountId ?? null,
      accountLabel: effective.externalAccountLabel ?? null,
      publicKey: effective.publicKey ?? null,
      connectedAt: effective.connectedAt ? new Date(effective.connectedAt).toISOString() : null,
      expiresAt: effective.expiresAt ? new Date(effective.expiresAt).toISOString() : null,
      lastError: effective.lastError ?? null
    };
  }

  async disconnect(tenantId: string): Promise<{ disconnected: boolean }> {
    await this.upsertIntegration(tenantId, {
      status: "disconnected",
      externalAccountId: null,
      externalAccountLabel: null,
      accessToken: null,
      refreshToken: null,
      publicKey: null,
      tokenType: null,
      scope: null,
      expiresAt: null,
      connectedAt: null,
      lastError: null,
      metadata: null
    });
    return { disconnected: true };
  }

  async handleCallback(query: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }): Promise<string> {
    try {
      this.ensureConfigured();
      const signedState = verifyMercadoPagoState<SignedOAuthState>(String(query.state ?? ""));
      if (!signedState?.tenantId || !signedState.exp || signedState.exp < Date.now()) {
        return this.buildPopupHtml({ ok: false, message: "No pudimos validar la conexión con Mercado Pago." });
      }
      if (query.error) {
        await this.persistIntegrationBestEffort(signedState.tenantId, {
          status: "error",
          externalAccountId: null,
          externalAccountLabel: null,
          accessToken: null,
          refreshToken: null,
          publicKey: null,
          tokenType: null,
          scope: null,
          expiresAt: null,
          connectedAt: null,
          lastError: String(query.error_description ?? query.error),
          metadata: null
        });
        return this.buildPopupHtml({
          ok: false,
          tenantId: signedState.tenantId,
          message: "Mercado Pago canceló o rechazó la vinculación."
        });
      }
      if (!query.code) {
        return this.buildPopupHtml({
          ok: false,
          tenantId: signedState.tenantId,
          message: "Mercado Pago no devolvió el código de autorización."
        });
      }
      try {
        const token = await this.requestOauthToken({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "authorization_code",
          code: query.code,
          redirect_uri: this.redirectUri
        });
        const expiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null;
        const accountId = String(token.user_id ?? "");
        const saved = await this.persistIntegrationBestEffort(signedState.tenantId, {
          status: "connected",
          externalAccountId: accountId || null,
          externalAccountLabel: accountId || null,
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? null,
          publicKey: token.public_key ?? null,
          tokenType: token.token_type ?? null,
          scope: token.scope ?? null,
          expiresAt,
          connectedAt: new Date(),
          lastError: null,
          metadata: { liveMode: token.live_mode ?? true }
        });
        if (!saved) {
          return this.buildPopupHtml({
            ok: false,
            tenantId: signedState.tenantId,
            message:
              "Mercado Pago autorizó la app, pero no pudimos guardar las credenciales en el servidor. Revisá la base de datos o los logs."
          });
        }
        return this.buildPopupHtml({
          ok: true,
          tenantId: signedState.tenantId,
          message: "Cuenta de Mercado Pago conectada correctamente."
        });
      } catch (error) {
        const lastError =
          error instanceof Error ? error.message : "No se pudo completar OAuth.";
        await this.persistIntegrationBestEffort(signedState.tenantId, {
          status: "error",
          externalAccountId: null,
          externalAccountLabel: null,
          accessToken: null,
          refreshToken: null,
          publicKey: null,
          tokenType: null,
          scope: null,
          expiresAt: null,
          connectedAt: null,
          lastError,
          metadata: null
        });
        return this.buildPopupHtml({
          ok: false,
          tenantId: signedState.tenantId,
          message: "No se pudo completar la conexión con Mercado Pago."
        });
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        return this.buildPopupHtml({ ok: false, message: error.message });
      }
      this.logger.error(
        `handleCallback inesperado: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
      );
      return this.buildPopupHtml({
        ok: false,
        message: "Ocurrió un error inesperado al procesar la respuesta de Mercado Pago."
      });
    }
  }

  private mapPaymentStatus(status: string): "pending" | "approved" | "rejected" | "cancelled" | "error" {
    const normalized = String(status ?? "").trim().toLowerCase();
    if (normalized === "approved") return "approved";
    if (normalized === "cancelled" || normalized === "cancelled_by_user") return "cancelled";
    if (normalized === "rejected" || normalized === "refunded" || normalized === "charged_back") return "rejected";
    if (normalized === "pending" || normalized === "in_process" || normalized === "in_mediation") return "pending";
    return "error";
  }

  private async fetchPayment(resourceId: string, accessToken: string): Promise<MercadoPagoPaymentResponse> {
    const response = await fetch(`${this.apiBaseUrl}/v1/payments/${resourceId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });
    if (!response.ok) {
      throw new InternalServerErrorException(await response.text());
    }
    return (await response.json()) as MercadoPagoPaymentResponse;
  }

  private async notifyPaymentStatus(input: {
    tenantId: string;
    leadId?: string | null;
    phone?: string | null;
    productName: string;
    status: string;
    paymentId: string;
  }): Promise<void> {
    const message = buildPaymentStatusMessage(input.status, input.productName);
    if (!message) return;
    let phone = String(input.phone ?? "").trim();
    if (!phone && input.leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: input.leadId },
        select: { phone: true }
      });
      phone = String(lead?.phone ?? "").trim();
    }
    if (!phone) return;
    const dedupeKey = buildStableDedupeKey(
      "mercadopago-webhook",
      input.tenantId,
      input.leadId,
      input.paymentId,
      input.status
    );
    await outgoingQueue.add(
      "payment-status-auto-v1",
      {
        schemaVersion: JOB_SCHEMA_VERSION,
        correlationId: buildCorrelationId(),
        dedupeKey,
        tenantId: input.tenantId,
        phone,
        message,
        metadata: {
          source: "bot",
          nextBestAction: input.status === "approved" ? "close_lead" : "follow_up_payment"
        }
      },
      {
        jobId: `payment_status_${dedupeKey}`
      }
    );
  }

  async handleWebhook(input: {
    query: Record<string, unknown>;
    body: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<{ received: boolean; status: string }> {
    const resourceId =
      String(
        (input.body?.data as { id?: string | number } | undefined)?.id ??
          input.query.id ??
          input.query["data.id"] ??
          ""
      ).trim();
    const externalAccountId = String(input.body?.user_id ?? input.query.user_id ?? "").trim();
    if (!resourceId || !externalAccountId) return { received: true, status: "ignored" };
    if (this.webhookSecret) {
      const signatureHeader = Array.isArray(input.headers["x-signature"])
        ? input.headers["x-signature"][0]
        : input.headers["x-signature"];
      const requestId = Array.isArray(input.headers["x-request-id"])
        ? input.headers["x-request-id"][0]
        : input.headers["x-request-id"];
      const valid = verifyMercadoPagoWebhookSignature({
        secret: this.webhookSecret,
        signatureHeader,
        requestId,
        resourceId
      });
      if (!valid) {
        throw new BadRequestException("Firma de webhook inválida.");
      }
    }
    const integration = await this.loadIntegrationByExternalAccount(externalAccountId);
    if (!integration) return { received: true, status: "ignored" };
    const { accessToken } = await this.refreshIfNeeded(integration);
    const payment = await this.fetchPayment(resourceId, accessToken);
    const externalReference = String(payment.external_reference ?? "").trim();
    const rows = (await (prisma as any).$queryRaw`
      select
        id,
        lead_id as "leadId",
        order_id as "orderId",
        status::text as "status",
        title,
        metadata
      from public.payment_attempts
      where provider = 'mercadopago'::payment_provider
        and (
          external_reference = ${externalReference}
          or external_payment_id = ${String(payment.id)}
          or external_preference_id = ${String(payment.order?.id ?? "")}
        )
      order by created_at desc
      limit 1
    `) as Array<{ id: string; leadId?: string | null; orderId?: string | null; status: string; title?: string | null; metadata?: unknown }>;
    const attempt = rows[0] ?? null;
    if (!attempt) return { received: true, status: "ignored" };
    const mappedStatus = this.mapPaymentStatus(payment.status);
    const previousStatus = String(attempt.status ?? "").trim().toLowerCase();
    await (prisma as any).$executeRaw`
      update public.payment_attempts
      set
        status = ${mappedStatus}::payment_attempt_status,
        external_payment_id = ${String(payment.id)},
        last_webhook_at = now(),
        paid_at = ${mappedStatus === "approved" && payment.date_approved ? new Date(payment.date_approved) : null},
        metadata = ${JSON.stringify(payment)}::jsonb,
        updated_at = now()
      where id::text = ${attempt.id}
    `;
    if (mappedStatus === "approved" && attempt.leadId && previousStatus !== "approved") {
      await this.leadsService.markAs(integration.tenantId, attempt.leadId, "vendido");
    }
    /** Si el attempt está vinculado a una Order del storefront, delegamos commit/release. */
    if (attempt.orderId && previousStatus !== mappedStatus) {
      try {
        if (mappedStatus === "approved") {
          await this.ordersService.markOrderPaid(integration.tenantId, attempt.orderId);
        } else if (mappedStatus === "rejected") {
          await this.ordersService.markOrderUnpaid(integration.tenantId, attempt.orderId, "failed");
        } else if (mappedStatus === "cancelled") {
          await this.ordersService.markOrderUnpaid(integration.tenantId, attempt.orderId, "cancelled");
        }
        /** `pending` y `error` no cambian la Order — esperamos otro webhook. */
      } catch (e) {
        this.logger.error(
          `handleWebhook: error actualizando order ${attempt.orderId} a ${mappedStatus}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
    if (previousStatus !== mappedStatus) {
      const paymentMetadata =
        typeof payment.metadata === "object" && payment.metadata !== null
          ? (payment.metadata as Record<string, unknown>)
          : {};
      const attemptMetadata =
        typeof attempt.metadata === "object" && attempt.metadata !== null
          ? (attempt.metadata as Record<string, unknown>)
          : {};
      const productName = String(
        paymentMetadata.product_name ?? attemptMetadata.productName ?? attempt.title ?? "tu compra"
      ).trim();
      const phone = String(paymentMetadata.phone ?? "").trim();
      await this.notifyPaymentStatus({
        tenantId: integration.tenantId,
        leadId: attempt.leadId ?? null,
        phone,
        productName,
        status: mappedStatus,
        paymentId: String(payment.id)
      });
    }
    return { received: true, status: mappedStatus };
  }

  private get checkoutPreferenceWebhookUrl(): string {
    const explicit = process.env.MERCADO_PAGO_WEBHOOK_URL ?? "";
    if (explicit) return explicit;
    const publicBase = process.env.PUBLIC_API_BASE_URL ?? "";
    return publicBase ? `${publicBase.replace(/\/$/, "")}/api/payments/mercadopago/webhook` : "";
  }

  /**
   * Crea preferencia en Mercado Pago y fila `payment_attempts` en estado draft (misma lógica que el worker).
   * Permite generar el link desde el dashboard si el flujo del bot no llegó a crear el borrador.
   */
  async createDraftCheckoutPreference(input: {
    tenantId: string;
    leadId: string;
    phone: string;
    productVariantId: string;
    title: string;
    amount: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ checkoutUrl: string; paymentAttemptId: string }> {
    const integrationRow = await this.loadIntegrationByTenant(input.tenantId);
    if (!integrationRow || integrationRow.status !== "connected") {
      throw new BadRequestException("No hay una cuenta de Mercado Pago conectada para este tenant.");
    }
    const { accessToken } = await this.refreshIfNeeded(integrationRow);
    const externalReference = `ws-${input.tenantId}-${input.leadId}-${randomUUID()}`;
    const preferencePayload: Record<string, unknown> = {
      items: [
        {
          title: input.title,
          quantity: 1,
          currency_id: "ARS",
          unit_price: Number(input.amount)
        }
      ],
      external_reference: externalReference,
      metadata: {
        tenantId: input.tenantId,
        leadId: input.leadId,
        productVariantId: input.productVariantId,
        phone: input.phone,
        ...(input.metadata ?? {})
      }
    };
    const webhook = this.checkoutPreferenceWebhookUrl;
    if (webhook) {
      preferencePayload.notification_url = webhook;
    }
    const preferenceResponse = await fetch(`${this.apiBaseUrl}/checkout/preferences`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preferencePayload)
    });
    if (!preferenceResponse.ok) {
      const errText = await preferenceResponse.text();
      throw new BadRequestException(`Mercado Pago no pudo crear la preferencia: ${errText}`);
    }
    const preference = (await preferenceResponse.json()) as {
      id: string;
      init_point?: string;
      sandbox_init_point?: string;
    };
    const createdAttempt = await prisma.paymentAttempt.create({
      data: {
        tenantId: input.tenantId,
        integrationId: integrationRow.id,
        leadId: input.leadId,
        productVariantId: input.productVariantId,
        provider: "mercadopago",
        status: "draft",
        amount: new Decimal(Number(input.amount)),
        currency: "ARS",
        title: input.title,
        externalReference,
        externalPreferenceId: preference.id ?? null,
        checkoutUrl: preference.init_point ?? null,
        sandboxCheckoutUrl: preference.sandbox_init_point ?? null,
        metadata: (input.metadata ?? {}) as object
      },
      select: { id: true }
    });
    const paymentAttemptId = createdAttempt.id;
    return {
      checkoutUrl: preference.init_point ?? preference.sandbox_init_point ?? "",
      paymentAttemptId
    };
  }

  /**
   * Crea preferencia de Mercado Pago para una Order multi-item del storefront.
   * Persiste un PaymentAttempt vinculado a `orderId` para que el webhook pueda
   * llamar a OrdersService.markOrderPaid()/markOrderUnpaid() al recibir el resultado.
   */
  async createOrderCheckoutPreference(input: {
    tenantId: string;
    orderId: string;
    externalReference: string;
    items: Array<{
      title: string;
      quantity: number;
      unitPrice: number;
      currencyId?: string;
    }>;
    payer: { name: string; email: string; phone?: string };
    backUrls: { success: string; failure: string; pending: string };
    autoReturn?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<{ checkoutUrl: string; paymentAttemptId: string; preferenceId: string }> {
    const integrationRow = await this.loadIntegrationByTenant(input.tenantId);
    if (!integrationRow || integrationRow.status !== "connected") {
      throw new BadRequestException("No hay una cuenta de Mercado Pago conectada para este tenant.");
    }
    const { accessToken } = await this.refreshIfNeeded(integrationRow);

    const totalAmount = input.items.reduce(
      (acc, it) => acc + Number(it.unitPrice) * Number(it.quantity),
      0
    );
    const summaryTitle =
      input.items.length === 1
        ? input.items[0].title
        : `Compra de ${input.items.length} productos`;

    const preferencePayload: Record<string, unknown> = {
      items: input.items.map((it) => ({
        title: it.title,
        quantity: Number(it.quantity),
        currency_id: it.currencyId ?? "ARS",
        unit_price: Number(it.unitPrice)
      })),
      external_reference: input.externalReference,
      payer: {
        name: input.payer.name,
        email: input.payer.email,
        ...(input.payer.phone ? { phone: { number: input.payer.phone } } : {})
      },
      back_urls: {
        success: input.backUrls.success,
        failure: input.backUrls.failure,
        pending: input.backUrls.pending
      },
      ...(input.autoReturn === false ? {} : { auto_return: "approved" }),
      metadata: {
        tenantId: input.tenantId,
        orderId: input.orderId,
        ...(input.metadata ?? {})
      }
    };
    const webhook = this.checkoutPreferenceWebhookUrl;
    if (webhook) {
      preferencePayload.notification_url = webhook;
    }

    const preferenceResponse = await fetch(`${this.apiBaseUrl}/checkout/preferences`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preferencePayload)
    });
    if (!preferenceResponse.ok) {
      const errText = await preferenceResponse.text();
      throw new BadRequestException(`Mercado Pago no pudo crear la preferencia: ${errText}`);
    }
    const preference = (await preferenceResponse.json()) as {
      id: string;
      init_point?: string;
      sandbox_init_point?: string;
    };

    const createdAttempt = await prisma.paymentAttempt.create({
      data: {
        tenantId: input.tenantId,
        integrationId: integrationRow.id,
        orderId: input.orderId,
        provider: "mercadopago",
        status: "link_generated",
        amount: new Decimal(totalAmount),
        currency: "ARS",
        title: summaryTitle,
        externalReference: input.externalReference,
        externalPreferenceId: preference.id ?? null,
        checkoutUrl: preference.init_point ?? null,
        sandboxCheckoutUrl: preference.sandbox_init_point ?? null,
        metadata: (input.metadata ?? {}) as object
      },
      select: { id: true }
    });

    return {
      checkoutUrl: preference.init_point ?? preference.sandbox_init_point ?? "",
      paymentAttemptId: createdAttempt.id,
      preferenceId: preference.id
    };
  }
}
