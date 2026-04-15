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
exports.ConversationsController = void 0;
const common_1 = require("@nestjs/common");
const require_role_1 = require("../../common/auth/require-role");
const conversations_service_1 = require("./conversations.service");
let ConversationsController = class ConversationsController {
    conversationsService;
    constructor(conversationsService) {
        this.conversationsService = conversationsService;
    }
    async getConversation(req, phone) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        return this.conversationsService.listMessages(req.tenantId, phone);
    }
    async getConversationState(req, phone) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        return this.conversationsService.getState(req.tenantId, phone);
    }
    async getPaymentLinks(req, phone) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        return this.conversationsService.listPaymentReviews(req.tenantId, phone);
    }
    async manualReply(req, phone, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.conversationsService.manualReply(req.tenantId, phone, body.message);
    }
    async preparePaymentDraft(req, phone) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.conversationsService.prepareDraftPaymentLink(req.tenantId, phone);
    }
    async sendPaymentLink(req, phone, attemptId) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.conversationsService.sendPreparedPaymentLink(req.tenantId, phone, attemptId);
    }
    async resolveChat(req, phone) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.conversationsService.resolveChat(req.tenantId, phone);
    }
    async reopenChat(req, phone) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.conversationsService.reopenChat(req.tenantId, phone);
    }
    async closeLead(req, phone) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.conversationsService.closeLead(req.tenantId, phone);
    }
    /** Oculta el contacto del listado de conversaciones (no borra mensajes ni el lead). */
    async archiveFromInbox(req, phone) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.conversationsService.archiveFromInbox(req.tenantId, phone);
    }
    async unarchiveFromInbox(req, phone) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.conversationsService.unarchiveFromInbox(req.tenantId, phone);
    }
    async handoffAssistive(req, phone, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.conversationsService.handoffAssistive(req.tenantId, phone, body.reason ?? "");
    }
};
exports.ConversationsController = ConversationsController;
__decorate([
    (0, common_1.Get)(":phone"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "getConversation", null);
__decorate([
    (0, common_1.Get)(":phone/state"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "getConversationState", null);
__decorate([
    (0, common_1.Get)(":phone/payment-links"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "getPaymentLinks", null);
__decorate([
    (0, common_1.Post)(":phone/reply"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "manualReply", null);
__decorate([
    (0, common_1.Post)(":phone/payment-links/prepare"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "preparePaymentDraft", null);
__decorate([
    (0, common_1.Post)(":phone/payment-links/:attemptId/send"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __param(2, (0, common_1.Param)("attemptId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "sendPaymentLink", null);
__decorate([
    (0, common_1.Post)(":phone/resolve"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "resolveChat", null);
__decorate([
    (0, common_1.Post)(":phone/reopen"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "reopenChat", null);
__decorate([
    (0, common_1.Post)(":phone/close-lead"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "closeLead", null);
__decorate([
    (0, common_1.Post)(":phone/archive"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "archiveFromInbox", null);
__decorate([
    (0, common_1.Post)(":phone/unarchive"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "unarchiveFromInbox", null);
__decorate([
    (0, common_1.Post)(":phone/handoff"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("phone")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ConversationsController.prototype, "handoffAssistive", null);
exports.ConversationsController = ConversationsController = __decorate([
    (0, common_1.Controller)("conversations"),
    __metadata("design:paramtypes", [conversations_service_1.ConversationsService])
], ConversationsController);
