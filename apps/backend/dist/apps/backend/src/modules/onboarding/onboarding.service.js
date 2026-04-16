"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnboardingService = void 0;
const common_1 = require("@nestjs/common");
const src_1 = require("../../../../../packages/db/src");
const shared_1 = require("@waseller/shared");
const mercado_pago_service_1 = require("../mercado-pago/mercado-pago.service");
const ops_service_1 = require("../ops/ops.service");
let OnboardingService = class OnboardingService {
    mercadoPagoService;
    opsService;
    constructor(mercadoPagoService, opsService) {
        this.mercadoPagoService = mercadoPagoService;
        this.opsService = opsService;
    }
    whatsappServiceUrl = (0, shared_1.getWhatsappServiceBaseUrl)() ?? "";
    normalizeWhatsappNumber(value) {
        const normalized = String(value ?? "").trim().replace(/[^\d]/g, "");
        return /^\d{8,18}$/.test(normalized) ? normalized : null;
    }
    async listSessions() {
        if (!this.whatsappServiceUrl)
            return [];
        try {
            const response = await fetch(`${this.whatsappServiceUrl}/sessions`, { cache: "no-store" });
            if (!response.ok)
                return [];
            return (await response.json());
        }
        catch {
            return [];
        }
    }
    async getTenantWhatsappNumber(tenantId) {
        const tenant = await src_1.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { whatsappNumber: true }
        });
        return tenant?.whatsappNumber ?? null;
    }
    async getWhatsappState(tenantId) {
        const [tenantWhatsappNumber, sessions] = await Promise.all([
            this.getTenantWhatsappNumber(tenantId),
            this.listSessions()
        ]);
        const tenantSessions = sessions.filter((item) => item.tenantId === tenantId);
        const active = tenantSessions.find((item) => item.status === "connected") ??
            tenantSessions.find((item) => item.status === "qr_required") ??
            tenantSessions.find((item) => item.status === "connecting") ??
            tenantSessions[0];
        if (!active) {
            return {
                tenantWhatsappNumber,
                sessionStatus: "not_connected",
                qrAvailable: false
            };
        }
        return {
            tenantWhatsappNumber: active.whatsappNumber ?? tenantWhatsappNumber,
            sessionStatus: active.status,
            qrAvailable: active.status === "qr_required",
            lastConnectedAt: active.lastConnectedAt,
            retries: active.retries,
            lastError: active.lastError
        };
    }
    async connectWhatsapp(tenantId, inputWhatsappNumber) {
        const tenantWhatsappNumberStored = await this.getTenantWhatsappNumber(tenantId);
        const tenantWhatsappNumber = this.normalizeWhatsappNumber(tenantWhatsappNumberStored) ?? this.normalizeWhatsappNumber(inputWhatsappNumber);
        if (!tenantWhatsappNumber) {
            throw new common_1.BadRequestException("Falta configurar el número de WhatsApp del tenant. Cargalo en onboarding para continuar.");
        }
        if (!tenantWhatsappNumberStored) {
            const whatsappTaken = await src_1.prisma.tenant.findFirst({
                where: { whatsappNumber: tenantWhatsappNumber, NOT: { id: tenantId } },
                select: { id: true }
            });
            if (whatsappTaken) {
                throw new common_1.ConflictException("Ese número de WhatsApp ya está registrado en otra cuenta. No se puede reutilizar el mismo número para dos negocios.");
            }
            await src_1.prisma.tenant.update({
                where: { id: tenantId },
                data: { whatsappNumber: tenantWhatsappNumber }
            });
        }
        if (!this.whatsappServiceUrl) {
            throw new common_1.BadGatewayException("Falta WHATSAPP_SERVICE_URL (o WHATSAPP_API_URL): la URL pública del servicio WhatsApp. Configurala en el entorno del API.");
        }
        let response;
        try {
            response = await fetch(`${this.whatsappServiceUrl}/sessions/connect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    whatsappNumber: tenantWhatsappNumber
                })
            });
        }
        catch {
            throw new common_1.BadGatewayException("No se pudo conectar con el servicio de WhatsApp.");
        }
        if (!response.ok) {
            const detail = await response.text();
            throw new common_1.BadGatewayException(detail?.trim() || "El servicio de WhatsApp devolvió un error al intentar conectar.");
        }
        return this.getWhatsappState(tenantId);
    }
    async getWhatsappQrPng(tenantId) {
        const state = await this.getWhatsappState(tenantId);
        if (!state.tenantWhatsappNumber)
            return null;
        if (!state.qrAvailable && state.sessionStatus !== "qr_required")
            return null;
        if (!this.whatsappServiceUrl)
            return null;
        const params = new URLSearchParams({
            tenantId,
            whatsappNumber: state.tenantWhatsappNumber
        });
        const response = await fetch(`${this.whatsappServiceUrl}/sessions/qr.png?${params.toString()}`, {
            cache: "no-store"
        });
        if (!response.ok)
            return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        return buffer;
    }
    async getStatus(tenantId) {
        const [productsCount, whatsapp, mercadoPago, tenantKnowledge] = await Promise.all([
            src_1.prisma.product.count({ where: { tenantId } }),
            this.getWhatsappState(tenantId),
            this.mercadoPagoService.getStatus(tenantId),
            this.opsService.getTenantKnowledge(tenantId)
        ]);
        const tenantName = tenantKnowledge.tenantName;
        const whatsappConnected = whatsapp.sessionStatus === "connected";
        const mercadoPagoConnected = mercadoPago.status === "connected";
        const businessProfileSaved = tenantKnowledge.persisted;
        const catalogReady = productsCount >= 3;
        const steps = [
            {
                key: "connect_whatsapp",
                title: "Vincular WhatsApp",
                description: "Conectá la sesión del negocio para recibir y enviar mensajes.",
                completed: whatsappConnected,
                href: "/",
                metric: whatsappConnected ? "Listo" : "Pendiente"
            },
            {
                key: "connect_mercadopago",
                title: "Conectar Mercado Pago",
                description: "Vinculá la cuenta para generar links de pago por conversación.",
                completed: mercadoPagoConnected,
                href: "/",
                metric: mercadoPagoConnected ? "Listo" : "Pendiente"
            },
            {
                key: "configure_business",
                title: "Contexto de la tienda",
                description: "Rubro, medios de pago y variantes del catálogo (envíos se acuerdan por WhatsApp).",
                completed: businessProfileSaved,
                href: "/",
                metric: businessProfileSaved ? "Guardado" : "Pendiente"
            },
            {
                key: "create_catalog",
                title: "Cargar productos",
                description: "Creá al menos 3 productos en el catálogo para operar ventas.",
                completed: catalogReady,
                href: "/stock",
                metric: `${productsCount}/3 productos`
            }
        ];
        const completedCount = steps.filter((step) => step.completed).length;
        const completionPercent = Math.round((completedCount / steps.length) * 100);
        const allCompleted = completedCount === steps.length;
        return {
            generatedAt: new Date().toISOString(),
            tenantName,
            allCompleted,
            completionPercent,
            steps,
            whatsapp,
            mercadoPago
        };
    }
};
exports.OnboardingService = OnboardingService;
exports.OnboardingService = OnboardingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mercado_pago_service_1.MercadoPagoService,
        ops_service_1.OpsService])
], OnboardingService);
