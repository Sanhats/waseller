import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algo = "aes-256-gcm";

const buildKey = (): Buffer => {
  const raw = process.env.WA_SESSION_SECRET ?? "change-me-in-production";
  return createHash("sha256").update(raw).digest();
};

export const encryptSession = (plain: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algo, buildKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
};

export const decryptSession = (payload: string): string => {
  const [ivHex, tagHex, contentHex] = payload.split(".");
  const decipher = createDecipheriv(algo, buildKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(contentHex, "hex")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
};
