import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  signMercadoPagoState,
  verifyMercadoPagoState,
  verifyMercadoPagoWebhookSignature
} from "../../../../packages/shared/src";

describe("Mercado Pago security helpers", () => {
  beforeEach(() => {
    process.env.PAYMENT_SECRET_KEY = "test-payment-secret";
    process.env.MERCADO_PAGO_STATE_SECRET = "test-state-secret";
  });

  it("firma y valida el state OAuth", () => {
    const state = signMercadoPagoState({
      tenantId: "tenant-123",
      exp: Date.now() + 60_000,
      nonce: "nonce-1"
    });
    expect(
      verifyMercadoPagoState<{ tenantId: string; exp: number; nonce: string }>(state)
    ).toMatchObject({
      tenantId: "tenant-123",
      nonce: "nonce-1"
    });
  });

  it("cifra y descifra tokens sensibles", () => {
    const encrypted = encryptIntegrationSecret("access-token-xyz");
    expect(encrypted).not.toContain("access-token-xyz");
    expect(decryptIntegrationSecret(encrypted)).toBe("access-token-xyz");
  });

  it("valida firmas de webhook con el manifiesto documentado", () => {
    const secret = "webhook-secret";
    const ts = "1712707200";
    const resourceId = "123456789";
    const requestId = "req-abc";
    const manifest = `id=${resourceId}&request-id=${requestId}&ts=${ts}`;
    const signature = createHmac("sha256", secret).update(manifest).digest("hex");

    expect(
      verifyMercadoPagoWebhookSignature({
        secret,
        signatureHeader: `ts=${ts},v1=${signature}`,
        requestId,
        resourceId
      })
    ).toBe(true);
  });
});
