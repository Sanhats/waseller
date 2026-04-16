/**
 * Base URL del servicio HTTP de WhatsApp (sin barra final).
 * En Railway los workers no resuelven el hostname `whatsapp` de Docker Compose:
 * hay que definir WHATSAPP_SERVICE_URL o WHATSAPP_API_URL con la URL HTTPS pública del servicio.
 */
export declare function isRailwayRuntime(): boolean;
export declare function getWhatsappServiceBaseUrl(): string | null;
export declare function requireWhatsappServiceBaseUrl(): string;
