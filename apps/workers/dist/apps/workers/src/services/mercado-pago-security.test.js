"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const vitest_1 = require("vitest");
const src_1 = require("../../../../packages/shared/src");
(0, vitest_1.describe)("Mercado Pago security helpers", () => {
    (0, vitest_1.beforeEach)(() => {
        process.env.PAYMENT_SECRET_KEY = "test-payment-secret";
        process.env.MERCADO_PAGO_STATE_SECRET = "test-state-secret";
    });
    (0, vitest_1.it)("firma y valida el state OAuth", () => {
        const state = (0, src_1.signMercadoPagoState)({
            tenantId: "tenant-123",
            exp: Date.now() + 60_000,
            nonce: "nonce-1"
        });
        (0, vitest_1.expect)((0, src_1.verifyMercadoPagoState)(state)).toMatchObject({
            tenantId: "tenant-123",
            nonce: "nonce-1"
        });
    });
    (0, vitest_1.it)("cifra y descifra tokens sensibles", () => {
        const encrypted = (0, src_1.encryptIntegrationSecret)("access-token-xyz");
        (0, vitest_1.expect)(encrypted).not.toContain("access-token-xyz");
        (0, vitest_1.expect)((0, src_1.decryptIntegrationSecret)(encrypted)).toBe("access-token-xyz");
    });
    (0, vitest_1.it)("valida firmas de webhook con el manifiesto documentado", () => {
        const secret = "webhook-secret";
        const ts = "1712707200";
        const resourceId = "123456789";
        const requestId = "req-abc";
        const manifest = `id=${resourceId}&request-id=${requestId}&ts=${ts}`;
        const signature = (0, node_crypto_1.createHmac)("sha256", secret).update(manifest).digest("hex");
        (0, vitest_1.expect)((0, src_1.verifyMercadoPagoWebhookSignature)({
            secret,
            signatureHeader: `ts=${ts},v1=${signature}`,
            requestId,
            resourceId
        })).toBe(true);
    });
});
