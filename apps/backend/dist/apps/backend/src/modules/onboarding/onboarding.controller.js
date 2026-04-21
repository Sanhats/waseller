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
exports.OnboardingController = void 0;
const common_1 = require("@nestjs/common");
const require_role_1 = require("../../common/auth/require-role");
const onboarding_service_1 = require("./onboarding.service");
let OnboardingController = class OnboardingController {
    onboardingService;
    constructor(onboardingService) {
        this.onboardingService = onboardingService;
    }
    async status(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        return this.onboardingService.getStatus(req.tenantId);
    }
    async whatsappSession(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        return this.onboardingService.getWhatsappState(req.tenantId);
    }
    async whatsappConnect(req, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.onboardingService.connectWhatsapp(req.tenantId, body?.whatsappNumber);
    }
    async whatsappDisconnect(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.onboardingService.disconnectWhatsapp(req.tenantId);
    }
    async whatsappQr(req, res) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        const png = await this.onboardingService.getWhatsappQrPng(req.tenantId);
        if (!png) {
            res.status(404).json({ message: "QR no disponible" });
            return;
        }
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        res.send(png);
    }
};
exports.OnboardingController = OnboardingController;
__decorate([
    (0, common_1.Get)("status"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OnboardingController.prototype, "status", null);
__decorate([
    (0, common_1.Get)("whatsapp/session"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OnboardingController.prototype, "whatsappSession", null);
__decorate([
    (0, common_1.Post)("whatsapp/connect"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OnboardingController.prototype, "whatsappConnect", null);
__decorate([
    (0, common_1.Post)("whatsapp/disconnect"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OnboardingController.prototype, "whatsappDisconnect", null);
__decorate([
    (0, common_1.Get)("whatsapp/qr.png"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OnboardingController.prototype, "whatsappQr", null);
exports.OnboardingController = OnboardingController = __decorate([
    (0, common_1.Controller)("onboarding"),
    __metadata("design:paramtypes", [onboarding_service_1.OnboardingService])
], OnboardingController);
