"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaileysSessionManager = void 0;
exports.getResolvedWaAuthDir = getResolvedWaAuthDir;
const src_1 = require("../../../../packages/queue/src");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const pino_1 = __importDefault(require("pino"));
let baileysModule;
const getBaileys = async () => {
    if (!baileysModule) {
        baileysModule = (await import("baileys"));
    }
    return baileysModule;
};
const buildSessionKey = (tenantId, whatsappNumber) => `${tenantId}:${whatsappNumber}`;
const normalizeIncomingText = (message) => {
    if (!message)
        return "";
    return (message.conversation ??
        message.extendedTextMessage?.text ??
        message.imageMessage?.caption ??
        message.videoMessage?.caption ??
        message.documentMessage?.caption ??
        "");
};
const normalizePhone = (jid) => {
    if (!jid.endsWith("@s.whatsapp.net"))
        return null;
    const raw = jid.replace("@s.whatsapp.net", "").trim();
    if (!raw)
        return null;
    const onlyDigits = raw.replace(/[^\d]/g, "");
    if (onlyDigits.length < 8)
        return null;
    return onlyDigits;
};
const decodeDataImageUrl = (value) => {
    const match = value.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match?.[1])
        return null;
    try {
        return Buffer.from(match[1], "base64");
    }
    catch {
        return null;
    }
};
/**
 * Directorio donde Baileys persiste credenciales (`useMultiFileAuthState`).
 * - No usar `/tmp` en producción: suele borrarse o no sobrevivir al redeploy.
 * - En Railway: path típico para montar un volumen persistente es `/data/...`.
 * - El servicio WhatsApp debe tener una sola réplica o cada instancia tendrá su propio disco.
 */
function getResolvedWaAuthDir() {
    const explicit = process.env.WA_AUTH_DIR?.trim();
    if (explicit)
        return explicit;
    if (process.env.RAILWAY_ENVIRONMENT)
        return "/data/wa-auth";
    return node_path_1.default.join(process.cwd(), "wa-auth-data");
}
class BaileysSessionManager {
    sessions = new Map();
    logger = (0, pino_1.default)({ level: process.env.LOG_LEVEL ?? "info" });
    maxRetries = Number(process.env.WA_MAX_RETRIES ?? 10);
    authRoot = getResolvedWaAuthDir();
    constructor() {
        node_fs_1.default.mkdirSync(this.authRoot, { recursive: true });
        if (this.authRoot.startsWith("/tmp") || this.authRoot.includes("/var/tmp")) {
            this.logger.warn({ authRoot: this.authRoot }, "WA_AUTH_DIR apunta a /tmp: las sesiones de WhatsApp pueden perderse al reiniciar el contenedor. Usá un directorio persistente y un volumen (p. ej. Railway: mount /data, WA_AUTH_DIR=/data/wa-auth).");
        }
        else if (process.env.RAILWAY_ENVIRONMENT) {
            this.logger.info({ authRoot: this.authRoot }, "Railway: credenciales Baileys en disco (authRoot). Para conservar sesión tras deploy, montá un volumen cuyo mount cubra ese path (p. ej. mount /data y WA_AUTH_DIR=/data/wa-auth). Una sola réplica del servicio WhatsApp; si escalás, cada réplica tiene su propio disco.");
        }
    }
    async connect(input) {
        const baileys = await getBaileys();
        const key = buildSessionKey(input.tenantId, input.whatsappNumber);
        const previous = this.sessions.get(key);
        if (previous?.socket)
            return this.toSnapshot(previous);
        const sessionDir = node_path_1.default.join(this.authRoot, key.replace(/[:/\\]/g, "_"));
        if (previous?.lastError === "401") {
            // 401 = logged out en Baileys/WhatsApp. Limpiamos auth local para forzar QR nuevo.
            node_fs_1.default.rmSync(sessionDir, { recursive: true, force: true });
        }
        node_fs_1.default.mkdirSync(sessionDir, { recursive: true });
        const { state, saveCreds } = await baileys.useMultiFileAuthState(sessionDir);
        const { version } = await baileys.fetchLatestBaileysVersion();
        const record = {
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
            logger: (0, pino_1.default)({ level: "silent" })
        });
        if (!socket)
            throw new Error("Unable to initialize WhatsApp socket");
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
                const shouldReconnect = update.lastDisconnect?.error?.output
                    ?.statusCode !==
                    baileys.DisconnectReason.loggedOut;
                const errorCode = update.lastDisconnect?.error?.output
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
                            node_fs_1.default.rmSync(sessionDir, { recursive: true, force: true });
                        }
                        catch {
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
            if (type !== "notify")
                return;
            for (const msg of messages) {
                if (msg.key?.fromMe)
                    continue;
                const text = normalizeIncomingText(msg.message);
                if (!text)
                    continue;
                const jid = msg.key?.remoteJid ?? "";
                const phone = normalizePhone(jid);
                if (!phone)
                    continue;
                const contactName = typeof msg.pushName === "string" ? msg.pushName.trim() : "";
                const timestamp = new Date().toISOString();
                const externalMessageId = String(msg.key?.id ?? "").trim() || undefined;
                const dedupeKey = (0, src_1.buildStableDedupeKey)(input.tenantId, phone, externalMessageId, text, timestamp);
                try {
                    await src_1.incomingQueue.add("incoming-message-v1", {
                        schemaVersion: src_1.JOB_SCHEMA_VERSION,
                        correlationId: (0, src_1.buildCorrelationId)(),
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
                    }, {
                        // BullMQ custom IDs cannot include ":" in current runtime version.
                        jobId: `incoming_${dedupeKey}`
                    });
                }
                catch (error) {
                    this.logger.error({ tenantId: input.tenantId, phone, externalMessageId, error }, "Failed to enqueue incoming WhatsApp message");
                }
            }
        });
        return this.toSnapshot(record);
    }
    async getProfilePicture(tenantId, phone) {
        const tenantSessions = Array.from(this.sessions.values()).filter((s) => s.tenantId === tenantId);
        const active = tenantSessions.find((s) => s.status === "connected" && s.socket);
        if (!active?.socket)
            throw new Error(`No active WhatsApp session for tenant ${tenantId}`);
        try {
            // @ts-expect-error baileys typing for profilePictureUrl is sometimes missing in generic socket
            const url = await active.socket.profilePictureUrl(`${phone}@s.whatsapp.net`);
            return { url };
        }
        catch {
            return { url: null };
        }
    }
    async sendMessage(tenantId, phone, message, imageUrl) {
        const tenantSessions = Array.from(this.sessions.values()).filter((s) => s.tenantId === tenantId);
        const active = tenantSessions.find((s) => s.status === "connected" && s.socket);
        if (!active?.socket)
            throw new Error(`No active WhatsApp session for tenant ${tenantId}`);
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
    list() {
        return Array.from(this.sessions.values()).map((s) => this.toSnapshot(s));
    }
    getSession(tenantId, whatsappNumber) {
        const key = buildSessionKey(tenantId, whatsappNumber);
        const session = this.sessions.get(key);
        if (!session)
            return null;
        return this.toSnapshot(session);
    }
    toSnapshot(record) {
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
exports.BaileysSessionManager = BaileysSessionManager;
