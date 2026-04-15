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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MercadoPagoController = void 0;
const common_1 = require("@nestjs/common");
const require_role_1 = require("../../common/auth/require-role");
const mercado_pago_service_1 = require("./mercado-pago.service");
let MercadoPagoController = class MercadoPagoController {
    mercadoPagoService;
    constructor(mercadoPagoService) {
        this.mercadoPagoService = mercadoPagoService;
    }
    async connectUrl(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.mercadoPagoService.getConnectUrl(req.tenantId);
    }
    async status(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        return this.mercadoPagoService.getStatus(req.tenantId);
    }
    async disconnect(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.mercadoPagoService.disconnect(req.tenantId);
    }
    async callback(req, res) {
        const html = await this.mercadoPagoService.handleCallback({
            code: String(req.query.code ?? ""),
            state: String(req.query.state ?? ""),
            error: String(req.query.error ?? ""),
            error_description: String(req.query.error_description ?? "")
        });
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(html);
    }
    async webhook(req, res) {
        const result = await this.mercadoPagoService.handleWebhook({
            query: req.query,
            body: (req.body ?? {}),
            headers: req.headers
        });
        res.status(200).json(result);
    }
};
exports.MercadoPagoController = MercadoPagoController;
__decorate([
    (0, common_1.Get)("integrations/mercadopago/connect-url"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MercadoPagoController.prototype, "connectUrl", null);
__decorate([
    (0, common_1.Get)("integrations/mercadopago/status"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MercadoPagoController.prototype, "status", null);
__decorate([
    (0, common_1.Post)("integrations/mercadopago/disconnect"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MercadoPagoController.prototype, "disconnect", null);
__decorate([
    (0, common_1.Get)("integrations/mercadopago/callback"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MercadoPagoController.prototype, "callback", null);
__decorate([
    (0, common_1.Post)("payments/mercadopago/webhook"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MercadoPagoController.prototype, "webhook", null);
exports.MercadoPagoController = MercadoPagoController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [mercado_pago_service_1.MercadoPagoService])
], MercadoPagoController);
