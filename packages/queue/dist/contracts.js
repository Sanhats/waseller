"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCorrelationId = exports.buildStableDedupeKey = exports.JOB_SCHEMA_VERSION = void 0;
const node_crypto_1 = require("node:crypto");
exports.JOB_SCHEMA_VERSION = 1;
const buildStableDedupeKey = (...parts) => {
    const normalized = parts
        .map((part) => String(part ?? "").trim())
        .filter((part) => part.length > 0)
        .join("|");
    return (0, node_crypto_1.createHash)("sha256").update(normalized).digest("hex");
};
exports.buildStableDedupeKey = buildStableDedupeKey;
const buildCorrelationId = () => (0, node_crypto_1.randomUUID)();
exports.buildCorrelationId = buildCorrelationId;
