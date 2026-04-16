"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadStatusToPriorityTier = exports.OUTGOING_ATTEMPTS = exports.SMART_RETRY_DELAYS_MS = exports.OUTGOING_PRIORITY = void 0;
exports.OUTGOING_PRIORITY = {
    HIGH: 1,
    MEDIUM: 5,
    LOW: 10
};
exports.SMART_RETRY_DELAYS_MS = [1000, 3000, 10000, 30000];
exports.OUTGOING_ATTEMPTS = exports.SMART_RETRY_DELAYS_MS.length + 1;
const leadStatusToPriorityTier = (status) => {
    if (status === "listo_para_cobrar" || status === "vendido")
        return "HIGH";
    if (status === "caliente" || status === "interesado")
        return "MEDIUM";
    return "LOW";
};
exports.leadStatusToPriorityTier = leadStatusToPriorityTier;
