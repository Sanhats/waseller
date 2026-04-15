"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppSessionManager = void 0;
const session_encryption_1 = require("./session-encryption");
class WhatsAppSessionManager {
    sessions = new Map();
    maxRetries = 10;
    upsertSession(config) {
        const key = `${config.tenantId}:${config.whatsappNumber}`;
        const existing = this.sessions.get(key);
        const nextState = {
            key,
            connectedAt: existing?.connectedAt ?? new Date().toISOString(),
            retries: existing?.retries ?? 0,
            status: "connected",
            encryptedSession: (0, session_encryption_1.encryptSession)(JSON.stringify({ key, updatedAt: new Date().toISOString() }))
        };
        this.sessions.set(key, nextState);
        return nextState;
    }
    markDisconnected(config) {
        const key = `${config.tenantId}:${config.whatsappNumber}`;
        const current = this.sessions.get(key);
        if (!current)
            return null;
        const retries = Math.min(current.retries + 1, this.maxRetries);
        const nextState = {
            ...current,
            retries,
            status: retries >= this.maxRetries ? "disconnected" : "connecting"
        };
        this.sessions.set(key, nextState);
        return nextState;
    }
    removeSession(config) {
        return this.sessions.delete(`${config.tenantId}:${config.whatsappNumber}`);
    }
    getSnapshot() {
        return Array.from(this.sessions.values());
    }
    readSession(config) {
        const state = this.sessions.get(`${config.tenantId}:${config.whatsappNumber}`);
        if (!state)
            return null;
        return (0, session_encryption_1.decryptSession)(state.encryptedSession);
    }
}
exports.WhatsAppSessionManager = WhatsAppSessionManager;
