import { decryptSession, encryptSession } from "./session-encryption";
type SessionKey = string;

export interface SessionConfig {
  tenantId: string;
  whatsappNumber: string;
}

interface SessionState {
  key: SessionKey;
  connectedAt: string;
  retries: number;
  status: "connecting" | "connected" | "disconnected";
  encryptedSession: string;
}

export class WhatsAppSessionManager {
  private readonly sessions = new Map<SessionKey, SessionState>();
  private readonly maxRetries = 10;

  upsertSession(config: SessionConfig): SessionState {
    const key = `${config.tenantId}:${config.whatsappNumber}`;
    const existing = this.sessions.get(key);
    const nextState: SessionState = {
      key,
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
      retries: existing?.retries ?? 0,
      status: "connected",
      encryptedSession: encryptSession(JSON.stringify({ key, updatedAt: new Date().toISOString() }))
    };
    this.sessions.set(key, nextState);
    return nextState;
  }

  markDisconnected(config: SessionConfig): SessionState | null {
    const key = `${config.tenantId}:${config.whatsappNumber}`;
    const current = this.sessions.get(key);
    if (!current) return null;

    const retries = Math.min(current.retries + 1, this.maxRetries);
    const nextState: SessionState = {
      ...current,
      retries,
      status: retries >= this.maxRetries ? "disconnected" : "connecting"
    };
    this.sessions.set(key, nextState);
    return nextState;
  }

  removeSession(config: SessionConfig): boolean {
    return this.sessions.delete(`${config.tenantId}:${config.whatsappNumber}`);
  }

  getSnapshot(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  readSession(config: SessionConfig): string | null {
    const state = this.sessions.get(`${config.tenantId}:${config.whatsappNumber}`);
    if (!state) return null;
    return decryptSession(state.encryptedSession);
  }
}
