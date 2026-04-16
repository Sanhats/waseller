import { randomUUID } from "node:crypto";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../../../packages/db/src";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "../../../../packages/shared/src";

type IntegrationRow = {
  id: string;
  tenantId: string;
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

type CreatePreferenceResponse = {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
};

export class MercadoPagoPaymentService {
  private get clientId(): string {
    return process.env.MERCADO_PAGO_CLIENT_ID ?? "";
  }

  private get clientSecret(): string {
    return process.env.MERCADO_PAGO_CLIENT_SECRET ?? "";
  }

  private get apiBaseUrl(): string {
    return process.env.MERCADO_PAGO_API_BASE_URL ?? "https://api.mercadopago.com";
  }

  private get webhookUrl(): string {
    const explicit = process.env.MERCADO_PAGO_WEBHOOK_URL ?? "";
    if (explicit) return explicit;
    const publicBase = process.env.PUBLIC_API_BASE_URL ?? "";
    return publicBase ? `${publicBase.replace(/\/$/, "")}/api/payments/mercadopago/webhook` : "";
  }

  private async loadIntegration(tenantId: string): Promise<IntegrationRow | null> {
    const row = await prisma.tenantPaymentIntegration.findFirst({
      where: { tenantId, provider: "mercadopago" }
    });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      status: row.status as IntegrationRow["status"],
      externalAccountId: row.externalAccountId,
      externalAccountLabel: row.externalAccountLabel,
      accessTokenEncrypted: row.accessTokenEncrypted,
      refreshTokenEncrypted: row.refreshTokenEncrypted,
      publicKey: row.publicKey,
      tokenType: row.tokenType,
      scope: row.scope,
      expiresAt: row.expiresAt,
      connectedAt: row.connectedAt,
      lastError: row.lastError
    };
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

  private async requestOauthToken(body: Record<string, unknown>): Promise<MercadoPagoOauthTokenResponse> {
    const response = await fetch(`${this.apiBaseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as MercadoPagoOauthTokenResponse;
  }

  private async ensureAccessToken(integration: IntegrationRow): Promise<string> {
    const accessToken = integration.accessTokenEncrypted
      ? decryptIntegrationSecret(integration.accessTokenEncrypted)
      : "";
    const expiresAt = integration.expiresAt ? new Date(integration.expiresAt) : null;
    if (accessToken && (!expiresAt || expiresAt.getTime() > Date.now() + 5 * 60 * 1000)) {
      return accessToken;
    }
    if (!integration.refreshTokenEncrypted || !this.clientId || !this.clientSecret) {
      throw new Error("La conexión de Mercado Pago venció. Reconectá la cuenta en Operación.");
    }
    const token = await this.requestOauthToken({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptIntegrationSecret(integration.refreshTokenEncrypted)
    });
    const nextExpiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : expiresAt;
    await this.upsertIntegration(integration.tenantId, {
      status: "connected",
      externalAccountId: String(token.user_id ?? integration.externalAccountId ?? ""),
      externalAccountLabel: String(token.user_id ?? integration.externalAccountLabel ?? integration.externalAccountId ?? ""),
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? decryptIntegrationSecret(integration.refreshTokenEncrypted),
      publicKey: token.public_key ?? integration.publicKey ?? null,
      tokenType: token.token_type ?? integration.tokenType ?? null,
      scope: token.scope ?? integration.scope ?? null,
      expiresAt: nextExpiresAt,
      connectedAt: integration.connectedAt ? new Date(integration.connectedAt) : new Date(),
      lastError: null,
      metadata: { liveMode: token.live_mode ?? true }
    });
    return token.access_token;
  }

  async createPaymentLink(input: {
    tenantId: string;
    leadId: string;
    phone: string;
    productVariantId: string;
    title: string;
    amount: number;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ checkoutUrl: string; paymentAttemptId: string }> {
    const integration = await this.loadIntegration(input.tenantId);
    if (!integration || integration.status !== "connected") {
      throw new Error("No hay una cuenta de Mercado Pago conectada para este tenant.");
    }
    const accessToken = await this.ensureAccessToken(integration);
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
    // Sin URL pública no hay webhooks; igual podemos generar el checkout y el borrador para revisión manual.
    if (this.webhookUrl) {
      preferencePayload.notification_url = this.webhookUrl;
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
      throw new Error(await preferenceResponse.text());
    }
    const preference = (await preferenceResponse.json()) as CreatePreferenceResponse;
    const createdAttempt = await prisma.paymentAttempt.create({
      data: {
        tenantId: input.tenantId,
        integrationId: integration.id,
        leadId: input.leadId,
        conversationId: input.conversationId ?? undefined,
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
}
