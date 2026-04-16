"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MercadoPagoPaymentService = void 0;
const node_crypto_1 = require("node:crypto");
const src_1 = require("../../../../packages/db/src");
const src_2 = require("../../../../packages/shared/src");
class MercadoPagoPaymentService {
    get clientId() {
        return process.env.MERCADO_PAGO_CLIENT_ID ?? "";
    }
    get clientSecret() {
        return process.env.MERCADO_PAGO_CLIENT_SECRET ?? "";
    }
    get apiBaseUrl() {
        return process.env.MERCADO_PAGO_API_BASE_URL ?? "https://api.mercadopago.com";
    }
    get webhookUrl() {
        const explicit = process.env.MERCADO_PAGO_WEBHOOK_URL ?? "";
        if (explicit)
            return explicit;
        const publicBase = process.env.PUBLIC_API_BASE_URL ?? "";
        return publicBase ? `${publicBase.replace(/\/$/, "")}/api/payments/mercadopago/webhook` : "";
    }
    async loadIntegration(tenantId) {
        const row = await src_1.prisma.tenantPaymentIntegration.findFirst({
            where: { tenantId, provider: "mercadopago" }
        });
        if (!row)
            return null;
        return {
            id: row.id,
            tenantId: row.tenantId,
            status: row.status,
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
    async upsertIntegration(tenantId, payload) {
        const accessTokenEncrypted = payload.accessToken ? (0, src_2.encryptIntegrationSecret)(payload.accessToken) : null;
        const refreshTokenEncrypted = payload.refreshToken ? (0, src_2.encryptIntegrationSecret)(payload.refreshToken) : null;
        const metadataValue = payload.metadata === null || payload.metadata === undefined
            ? undefined
            : payload.metadata;
        await src_1.prisma.tenantPaymentIntegration.upsert({
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
                metadata: metadataValue,
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
                metadata: metadataValue === undefined ? undefined : metadataValue,
            },
        });
    }
    async requestOauthToken(body) {
        const response = await fetch(`${this.apiBaseUrl}/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            throw new Error(await response.text());
        }
        return (await response.json());
    }
    async ensureAccessToken(integration) {
        const accessToken = integration.accessTokenEncrypted
            ? (0, src_2.decryptIntegrationSecret)(integration.accessTokenEncrypted)
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
            refresh_token: (0, src_2.decryptIntegrationSecret)(integration.refreshTokenEncrypted)
        });
        const nextExpiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : expiresAt;
        await this.upsertIntegration(integration.tenantId, {
            status: "connected",
            externalAccountId: String(token.user_id ?? integration.externalAccountId ?? ""),
            externalAccountLabel: String(token.user_id ?? integration.externalAccountLabel ?? integration.externalAccountId ?? ""),
            accessToken: token.access_token,
            refreshToken: token.refresh_token ?? (0, src_2.decryptIntegrationSecret)(integration.refreshTokenEncrypted),
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
    async createPaymentLink(input) {
        const integration = await this.loadIntegration(input.tenantId);
        if (!integration || integration.status !== "connected") {
            throw new Error("No hay una cuenta de Mercado Pago conectada para este tenant.");
        }
        const accessToken = await this.ensureAccessToken(integration);
        const externalReference = `ws-${input.tenantId}-${input.leadId}-${(0, node_crypto_1.randomUUID)()}`;
        const preferencePayload = {
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
        const preference = (await preferenceResponse.json());
        const attemptRows = (await src_1.prisma.$queryRaw `
      insert into public.payment_attempts (
        tenant_id,
        integration_id,
        lead_id,
        conversation_id,
        product_variant_id,
        provider,
        status,
        amount,
        currency,
        title,
        external_reference,
        external_preference_id,
        checkout_url,
        sandbox_checkout_url,
        payment_link_sent_at,
        metadata,
        created_at,
        updated_at
      )
      values (
        cast(${input.tenantId} as uuid),
        cast(${integration.id} as uuid),
        cast(${input.leadId} as uuid),
        cast(${input.conversationId ?? null} as uuid),
        cast(${input.productVariantId} as uuid),
        'mercadopago'::payment_provider,
        'draft'::payment_attempt_status,
        ${Number(input.amount)},
        'ARS',
        ${input.title},
        ${externalReference},
        ${preference.id ?? null},
        ${preference.init_point ?? null},
        ${preference.sandbox_init_point ?? null},
        null,
        ${JSON.stringify(input.metadata ?? {})}::jsonb,
        now(),
        now()
      )
      returning id
    `);
        const paymentAttemptId = attemptRows[0]?.id ?? (0, node_crypto_1.randomUUID)();
        return {
            checkoutUrl: preference.init_point ?? preference.sandbox_init_point ?? "",
            paymentAttemptId
        };
    }
}
exports.MercadoPagoPaymentService = MercadoPagoPaymentService;
