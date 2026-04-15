import { createHmac } from "node:crypto";
import type { AuthTokenPayload } from "./types";

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

export type AuthTokenEnv = {
  AUTH_TOKEN_SECRET: string;
  AUTH_TOKEN_TTL_SECONDS: number;
};

export const authTokenEnvFromProcess = (env: NodeJS.ProcessEnv): AuthTokenEnv => ({
  AUTH_TOKEN_SECRET: env.AUTH_TOKEN_SECRET ?? "dev-secret-change-me",
  AUTH_TOKEN_TTL_SECONDS: Number(env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 8)
});

const signRaw = (secret: string, headerPart: string, payloadPart: string): string =>
  toBase64Url(createHmac("sha256", secret).update(`${headerPart}.${payloadPart}`).digest());

export const createAuthToken = (
  tokenEnv: AuthTokenEnv,
  payload: Omit<AuthTokenPayload, "exp">
): { token: string; exp: number } => {
  const exp = Math.floor(Date.now() / 1000) + tokenEnv.AUTH_TOKEN_TTL_SECONDS;
  const fullPayload: AuthTokenPayload = { ...payload, exp };
  const headerPart = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadPart = toBase64Url(JSON.stringify(fullPayload));
  const signature = signRaw(tokenEnv.AUTH_TOKEN_SECRET, headerPart, payloadPart);
  return { token: `${headerPart}.${payloadPart}.${signature}`, exp };
};

export const verifyAuthToken = (tokenEnv: AuthTokenEnv, token: string): AuthTokenPayload | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts;
  const expected = signRaw(tokenEnv.AUTH_TOKEN_SECRET, headerPart, payloadPart);
  if (expected !== signature) return null;

  try {
    const payload = JSON.parse(fromBase64Url(payloadPart)) as AuthTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
};
