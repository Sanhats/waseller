"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyMercadoPagoWebhookSignature = exports.verifyMercadoPagoState = exports.signMercadoPagoState = exports.decryptIntegrationSecret = exports.encryptIntegrationSecret = void 0;
const node_crypto_1 = require("node:crypto");
const ALGO = "aes-256-gcm";
const toBase64Url = (input) => Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
const fromBase64Url = (input) => {
    const restored = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = restored + "=".repeat((4 - (restored.length % 4 || 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8");
};
const buildEncryptionKey = () => {
    const raw = process.env.PAYMENT_SECRET_KEY ??
        process.env.MERCADO_PAGO_SECRET_KEY ??
        process.env.AUTH_TOKEN_SECRET ??
        "dev-secret-change-me";
    return (0, node_crypto_1.createHash)("sha256").update(raw).digest();
};
const buildStateKey = () => process.env.MERCADO_PAGO_STATE_SECRET ??
    process.env.PAYMENT_SECRET_KEY ??
    process.env.AUTH_TOKEN_SECRET ??
    "dev-secret-change-me";
const encryptIntegrationSecret = (plain) => {
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)(ALGO, buildEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
};
exports.encryptIntegrationSecret = encryptIntegrationSecret;
const decryptIntegrationSecret = (payload) => {
    const [ivHex, tagHex, contentHex] = String(payload ?? "").split(".");
    const decipher = (0, node_crypto_1.createDecipheriv)(ALGO, buildEncryptionKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(contentHex, "hex")),
        decipher.final()
    ]);
    return decrypted.toString("utf8");
};
exports.decryptIntegrationSecret = decryptIntegrationSecret;
const signMercadoPagoState = (payload) => {
    const serialized = toBase64Url(JSON.stringify(payload));
    const signature = toBase64Url((0, node_crypto_1.createHmac)("sha256", buildStateKey()).update(serialized).digest());
    return `${serialized}.${signature}`;
};
exports.signMercadoPagoState = signMercadoPagoState;
const verifyMercadoPagoState = (state) => {
    const [payloadPart, signaturePart] = String(state ?? "").split(".");
    if (!payloadPart || !signaturePart)
        return null;
    const expected = toBase64Url((0, node_crypto_1.createHmac)("sha256", buildStateKey()).update(payloadPart).digest());
    if (expected !== signaturePart)
        return null;
    try {
        return JSON.parse(fromBase64Url(payloadPart));
    }
    catch {
        return null;
    }
};
exports.verifyMercadoPagoState = verifyMercadoPagoState;
const parseSignatureHeader = (header) => {
    const parts = String(header ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const values = Object.fromEntries(parts.map((part) => {
        const [key, value] = part.split("=");
        return [String(key ?? "").trim(), String(value ?? "").trim()];
    }));
    if (!values.ts || !values.v1)
        return null;
    return { ts: values.ts, v1: values.v1 };
};
const verifyMercadoPagoWebhookSignature = (input) => {
    const parsed = parseSignatureHeader(input.signatureHeader ?? "");
    const resourceId = String(input.resourceId ?? "").trim();
    const requestId = String(input.requestId ?? "").trim();
    if (!parsed || !resourceId || !requestId)
        return false;
    const manifests = [
        `id=${resourceId}&request-id=${requestId}&ts=${parsed.ts}`,
        `id:${resourceId};request-id:${requestId};ts:${parsed.ts};`
    ];
    return manifests.some((manifest) => {
        const computed = (0, node_crypto_1.createHmac)("sha256", input.secret).update(manifest).digest("hex");
        return computed.toLowerCase() === parsed.v1.toLowerCase();
    });
};
exports.verifyMercadoPagoWebhookSignature = verifyMercadoPagoWebhookSignature;
