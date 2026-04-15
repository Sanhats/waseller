import { createHmac } from "node:crypto";
import { AuthTokenPayload } from "../../../../../packages/shared/src";

const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET ?? "dev-secret-change-me";
const TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 8);

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

const signRaw = (headerPart: string, payloadPart: string): string =>
  toBase64Url(createHmac("sha256", TOKEN_SECRET).update(`${headerPart}.${payloadPart}`).digest());

export const createAuthToken = (
  payload: Omit<AuthTokenPayload, "exp">
): { token: string; exp: number } => {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const fullPayload: AuthTokenPayload = { ...payload, exp };
  const headerPart = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadPart = toBase64Url(JSON.stringify(fullPayload));
  const signature = signRaw(headerPart, payloadPart);
  return { token: `${headerPart}.${payloadPart}.${signature}`, exp };
};

export const verifyAuthToken = (token: string): AuthTokenPayload | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts;
  const expected = signRaw(headerPart, payloadPart);
  if (expected !== signature) return null;

  try {
    const payload = JSON.parse(fromBase64Url(payloadPart)) as AuthTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
};
