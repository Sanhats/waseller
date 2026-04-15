"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptSession = exports.encryptSession = void 0;
const node_crypto_1 = require("node:crypto");
const algo = "aes-256-gcm";
const buildKey = () => {
    const raw = process.env.WA_SESSION_SECRET ?? "change-me-in-production";
    return (0, node_crypto_1.createHash)("sha256").update(raw).digest();
};
const encryptSession = (plain) => {
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)(algo, buildKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
};
exports.encryptSession = encryptSession;
const decryptSession = (payload) => {
    const [ivHex, tagHex, contentHex] = payload.split(".");
    const decipher = (0, node_crypto_1.createDecipheriv)(algo, buildKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(contentHex, "hex")),
        decipher.final()
    ]);
    return decrypted.toString("utf8");
};
exports.decryptSession = decryptSession;
