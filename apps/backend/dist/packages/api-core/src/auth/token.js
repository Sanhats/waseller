"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAuthToken = exports.createAuthToken = exports.authTokenEnvFromProcess = void 0;
const node_crypto_1 = require("node:crypto");
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
const authTokenEnvFromProcess = (env) => ({
    AUTH_TOKEN_SECRET: env.AUTH_TOKEN_SECRET ?? "dev-secret-change-me",
    AUTH_TOKEN_TTL_SECONDS: Number(env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 8)
});
exports.authTokenEnvFromProcess = authTokenEnvFromProcess;
const signRaw = (secret, headerPart, payloadPart) => toBase64Url((0, node_crypto_1.createHmac)("sha256", secret).update(`${headerPart}.${payloadPart}`).digest());
const createAuthToken = (tokenEnv, payload) => {
    const exp = Math.floor(Date.now() / 1000) + tokenEnv.AUTH_TOKEN_TTL_SECONDS;
    const fullPayload = { ...payload, exp };
    const headerPart = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payloadPart = toBase64Url(JSON.stringify(fullPayload));
    const signature = signRaw(tokenEnv.AUTH_TOKEN_SECRET, headerPart, payloadPart);
    return { token: `${headerPart}.${payloadPart}.${signature}`, exp };
};
exports.createAuthToken = createAuthToken;
const verifyAuthToken = (tokenEnv, token) => {
    const parts = token.split(".");
    if (parts.length !== 3)
        return null;
    const [headerPart, payloadPart, signature] = parts;
    const expected = signRaw(tokenEnv.AUTH_TOKEN_SECRET, headerPart, payloadPart);
    if (expected !== signature)
        return null;
    try {
        const payload = JSON.parse(fromBase64Url(payloadPart));
        if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000))
            return null;
        return payload;
    }
    catch {
        return null;
    }
};
exports.verifyAuthToken = verifyAuthToken;
