import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

const toBase64Url = (input: Buffer | string): string =>
  Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const fromBase64Url = (input: string): string => {
  const restored = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = restored + "=".repeat((4 - (restored.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
};

const buildEncryptionKey = (): Buffer => {
  const raw =
    process.env.PAYMENT_SECRET_KEY ??
    process.env.MERCADO_PAGO_SECRET_KEY ??
    process.env.AUTH_TOKEN_SECRET ??
    "dev-secret-change-me";
  return createHash("sha256").update(raw).digest();
};

const buildStateKey = (): string =>
  process.env.MERCADO_PAGO_STATE_SECRET ??
  process.env.PAYMENT_SECRET_KEY ??
  process.env.AUTH_TOKEN_SECRET ??
  "dev-secret-change-me";

export const encryptIntegrationSecret = (plain: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, buildEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
};

export const decryptIntegrationSecret = (payload: string): string => {
  const [ivHex, tagHex, contentHex] = String(payload ?? "").split(".");
  const decipher = createDecipheriv(ALGO, buildEncryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(contentHex, "hex")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
};

export const signMercadoPagoState = (payload: Record<string, unknown>): string => {
  const serialized = toBase64Url(JSON.stringify(payload));
  const signature = toBase64Url(createHmac("sha256", buildStateKey()).update(serialized).digest());
  return `${serialized}.${signature}`;
};

export const verifyMercadoPagoState = <T extends Record<string, unknown>>(state: string): T | null => {
  const [payloadPart, signaturePart] = String(state ?? "").split(".");
  if (!payloadPart || !signaturePart) return null;
  const expected = toBase64Url(createHmac("sha256", buildStateKey()).update(payloadPart).digest());
  if (expected !== signaturePart) return null;
  try {
    return JSON.parse(fromBase64Url(payloadPart)) as T;
  } catch {
    return null;
  }
};

const parseSignatureHeader = (header: string): { ts: string; v1: string } | null => {
  const parts = String(header ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const values = Object.fromEntries(
    parts.map((part) => {
      const [key, value] = part.split("=");
      return [String(key ?? "").trim(), String(value ?? "").trim()];
    })
  );
  if (!values.ts || !values.v1) return null;
  return { ts: values.ts, v1: values.v1 };
};

export const verifyMercadoPagoWebhookSignature = (input: {
  secret: string;
  signatureHeader?: string | null;
  requestId?: string | null;
  resourceId?: string | null;
}): boolean => {
  const parsed = parseSignatureHeader(input.signatureHeader ?? "");
  const resourceId = String(input.resourceId ?? "").trim();
  const requestId = String(input.requestId ?? "").trim();
  if (!parsed || !resourceId || !requestId) return false;
  const manifests = [
    `id=${resourceId}&request-id=${requestId}&ts=${parsed.ts}`,
    `id:${resourceId};request-id:${requestId};ts:${parsed.ts};`
  ];
  return manifests.some((manifest) => {
    const computed = createHmac("sha256", input.secret).update(manifest).digest("hex");
    return computed.toLowerCase() === parsed.v1.toLowerCase();
  });
};
