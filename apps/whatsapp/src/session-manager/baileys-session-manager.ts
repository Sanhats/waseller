import {
  JOB_SCHEMA_VERSION,
  buildCorrelationId,
  buildStableDedupeKey,
  incomingQueue
} from "../../../../packages/queue/src";
import path from "node:path";
import fs from "node:fs";
import pino from "pino";

type SessionStatus = "connecting" | "connected" | "disconnected" | "qr_required";

export interface SessionInput {
  tenantId: string;
  whatsappNumber: string;
}

export interface SessionSnapshot {
  key: string;
  tenantId: string;
  whatsappNumber: string;
  status: SessionStatus;
  retries: number;
  lastConnectedAt?: string;
  lastError?: string;
  qr?: string;
}

type SessionRecord = SessionSnapshot & {
  socket?: {
    sendMessage: (
      jid: string,
      payload: { text: string } | { image: Buffer | { url: string }; caption?: string }
    ) => Promise<unknown>;
    ev: {
      on: (event: string, callback: (...args: any[]) => void) => void;
    };
  };
};

let baileysModule:
  | {
      default: (input: Record<string, unknown>) => NonNullable<SessionRecord["socket"]>;
      DisconnectReason: { loggedOut: number };
      fetchLatestBaileysVersion: () => Promise<{ version: number[] }>;
      useMultiFileAuthState: (
        dir: string
      ) => Promise<{ state: Record<string, unknown>; saveCreds: () => Promise<void> }>;
    }
  | undefined;

const getBaileys = async (): Promise<NonNullable<typeof baileysModule>> => {
  if (!baileysModule) {
    baileysModule = (await import("baileys")) as unknown as typeof baileysModule;
  }
  return baileysModule as NonNullable<typeof baileysModule>;
};

const buildSessionKey = (tenantId: string, whatsappNumber: string): string =>
  `${tenantId}:${whatsappNumber}`;

const normalizeIncomingText = (message: Record<string, any> | undefined): string => {
  if (!message) return "";
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    ""
  );
};

const normalizePhone = (jid: string): string | null => {
  if (!jid.endsWith("@s.whatsapp.net")) return null;
  const raw = jid.replace("@s.whatsapp.net", "").trim();
  if (!raw) return null;
  const onlyDigits = raw.replace(/[^\d]/g, "");
  if (onlyDigits.length < 8) return null;
  return onlyDigits;
};

const decodeDataImageUrl = (value: string): Buffer | null => {
  const match = value.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match?.[1]) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
};

export class BaileysSessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  private readonly maxRetries = Number(process.env.WA_MAX_RETRIES ?? 10);
  private readonly authRoot = process.env.WA_AUTH_DIR ?? "/tmp/wa-auth";

  constructor() {
    fs.mkdirSync(this.authRoot, { recursive: true });
  }

  async connect(input: SessionInput): Promise<SessionSnapshot> {
    const baileys = await getBaileys();
    const key = buildSessionKey(input.tenantId, input.whatsappNumber);
    const previous = this.sessions.get(key);
    if (previous?.socket) return this.toSnapshot(previous);

    const sessionDir = path.join(this.authRoot, key.replace(/[:/\\]/g, "_"));
    if (previous?.lastError === "401") {
      // 401 = logged out en Baileys/WhatsApp. Limpiamos auth local para forzar QR nuevo.
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await baileys.useMultiFileAuthState(sessionDir);
    const { version } = await baileys.fetchLatestBaileysVersion();

    const record: SessionRecord = {
      key,
      tenantId: input.tenantId,
      whatsappNumber: input.whatsappNumber,
      status: "connecting",
      retries: previous?.retries ?? 0
    };
    this.sessions.set(key, record);

    const socket = baileys.default({
      auth: state,
      version,
      printQRInTerminal: false,
      logger: pino({ level: "silent" })
    });
    if (!socket) throw new Error("Unable to initialize WhatsApp socket");
    record.socket = socket;

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update) => {
      if (update.qr) {
        record.qr = update.qr;
        record.status = "qr_required";
      }

      if (update.connection === "open") {
        record.status = "connected";
        record.lastConnectedAt = new Date().toISOString();
        record.retries = 0;
        record.lastError = undefined;
        record.qr = undefined;
      }

      if (update.connection === "close") {
        const shouldReconnect =
          (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
            ?.statusCode !==
          baileys.DisconnectReason.loggedOut;
        const errorCode =
          (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
            ?.statusCode;

        record.lastError = String(errorCode ?? "unknown");
        if (!shouldReconnect) {
          record.status = "disconnected";
          record.socket = undefined;
          this.logger.warn({ key, errorCode }, "WhatsApp session logged out");

          // Si WhatsApp invalida sesión (401), limpiamos auth local y relanzamos conexión
          // para que el sistema vuelva a QR_REQUIRED automáticamente sin segundo clic.
          if (errorCode === baileys.DisconnectReason.loggedOut) {
            try {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            } catch {
              // Ignorar fallos de cleanup para no romper reconexión.
            }
            record.retries = 0;
            await this.connect({
              tenantId: input.tenantId,
              whatsappNumber: input.whatsappNumber
            });
          }
          return;
        }

        record.retries += 1;
        record.status = "connecting";
        record.socket = undefined;
        if (record.retries > this.maxRetries) {
          record.status = "disconnected";
          this.logger.error({ key }, "Max retries reached for WhatsApp session");
          return;
        }

        await this.connect({
          tenantId: input.tenantId,
          whatsappNumber: input.whatsappNumber
        });
      }
    });

    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (msg.key?.fromMe) continue;
        const text = normalizeIncomingText(msg.message as Record<string, any> | undefined);
        if (!text) continue;

        const jid = msg.key?.remoteJid ?? "";
        const phone = normalizePhone(jid);
        if (!phone) continue;
        const contactName = typeof msg.pushName === "string" ? msg.pushName.trim() : "";

        const timestamp = new Date().toISOString();
        const externalMessageId = String(msg.key?.id ?? "").trim() || undefined;
        const dedupeKey = buildStableDedupeKey(
          input.tenantId,
          phone,
          externalMessageId,
          text,
          timestamp
        );
        try {
          await incomingQueue.add(
            "incoming-message-v1",
            {
              schemaVersion: JOB_SCHEMA_VERSION,
              correlationId: buildCorrelationId(),
              dedupeKey,
              tenantId: input.tenantId,
              payload: {
                phone,
                name: contactName || undefined,
                message: text,
                timestamp,
                externalMessageId,
                source: "whatsapp"
              },
              createdAt: new Date().toISOString()
            },
            {
              // BullMQ custom IDs cannot include ":" in current runtime version.
              jobId: `incoming_${dedupeKey}`
            }
          );
        } catch (error) {
          this.logger.error(
            { tenantId: input.tenantId, phone, externalMessageId, error },
            "Failed to enqueue incoming WhatsApp message"
          );
        }
      }
    });

    return this.toSnapshot(record);
  }

  async getProfilePicture(tenantId: string, phone: string): Promise<{ url: string | null }> {
    const tenantSessions = Array.from(this.sessions.values()).filter((s) => s.tenantId === tenantId);
    const active = tenantSessions.find((s) => s.status === "connected" && s.socket);
    if (!active?.socket) throw new Error(`No active WhatsApp session for tenant ${tenantId}`);

    try {
      // @ts-expect-error baileys typing for profilePictureUrl is sometimes missing in generic socket
      const url = await active.socket.profilePictureUrl(`${phone}@s.whatsapp.net`);
      return { url };
    } catch {
      return { url: null };
    }
  }

  async sendMessage(
    tenantId: string,
    phone: string,
    message: string,
    imageUrl?: string
  ): Promise<{ ack: boolean }> {
    const tenantSessions = Array.from(this.sessions.values()).filter((s) => s.tenantId === tenantId);
    const active = tenantSessions.find((s) => s.status === "connected" && s.socket);
    if (!active?.socket) throw new Error(`No active WhatsApp session for tenant ${tenantId}`);

    if (imageUrl && imageUrl.trim()) {
      const trimmed = imageUrl.trim();
      const base64Image = decodeDataImageUrl(trimmed);
      if (base64Image) {
        await active.socket.sendMessage(`${phone}@s.whatsapp.net`, {
          image: base64Image,
          caption: message
        });
        return { ack: true };
      }
      if (/^https?:\/\//i.test(trimmed)) {
        await active.socket.sendMessage(`${phone}@s.whatsapp.net`, {
          image: { url: trimmed },
          caption: message
        });
        return { ack: true };
      }
    }

    await active.socket.sendMessage(`${phone}@s.whatsapp.net`, { text: message });
    return { ack: true };
  }

  list(): SessionSnapshot[] {
    return Array.from(this.sessions.values()).map((s) => this.toSnapshot(s));
  }

  getSession(tenantId: string, whatsappNumber: string): SessionSnapshot | null {
    const key = buildSessionKey(tenantId, whatsappNumber);
    const session = this.sessions.get(key);
    if (!session) return null;
    return this.toSnapshot(session);
  }

  private toSnapshot(record: SessionRecord): SessionSnapshot {
    return {
      key: record.key,
      tenantId: record.tenantId,
      whatsappNumber: record.whatsappNumber,
      status: record.status,
      retries: record.retries,
      lastConnectedAt: record.lastConnectedAt,
      lastError: record.lastError,
      qr: record.qr
    };
  }
}
