"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRailwayRuntime = isRailwayRuntime;
exports.getWhatsappServiceBaseUrl = getWhatsappServiceBaseUrl;
exports.requireWhatsappServiceBaseUrl = requireWhatsappServiceBaseUrl;
/**
 * Base URL del servicio HTTP de WhatsApp (sin barra final).
 * En Railway los workers no resuelven el hostname `whatsapp` de Docker Compose:
 * hay que definir WHATSAPP_SERVICE_URL o WHATSAPP_API_URL con la URL HTTPS pública del servicio.
 */
function isRailwayRuntime() {
    return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}
function getWhatsappServiceBaseUrl() {
    const raw = (process.env.WHATSAPP_SERVICE_URL || process.env.WHATSAPP_API_URL || "")
        .trim()
        .replace(/\/$/, "");
    if (raw)
        return raw;
    if (isRailwayRuntime())
        return null;
    return "http://whatsapp:3100";
}
function requireWhatsappServiceBaseUrl() {
    const url = getWhatsappServiceBaseUrl();
    if (!url) {
        throw new Error("[waseller] Falta WHATSAPP_SERVICE_URL (o WHATSAPP_API_URL): URL pública del servicio WhatsApp en Railway, sin barra final. Ejemplo: https://tu-wa.up.railway.app");
    }
    return url;
}
