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
exports.LeadsController = void 0;
const common_1 = require("@nestjs/common");
const leads_service_1 = require("./leads.service");
const require_role_1 = require("../../common/auth/require-role");
let LeadsController = class LeadsController {
    leadsService;
    constructor(leadsService) {
        this.leadsService = leadsService;
    }
    async list(req, includeClosed, includeArchived, includeHiddenFromInbox) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        return this.leadsService.listByTenant(req.tenantId, includeClosed === "true" || includeClosed === "1", includeArchived === "true" || includeArchived === "1", includeHiddenFromInbox === "true" || includeHiddenFromInbox === "1");
    }
    async hideFromInbox(req, leadId) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        const result = await this.leadsService.hideFromInbox(req.tenantId, leadId);
        if (!result)
            throw new common_1.NotFoundException("Lead no encontrado");
        return result;
    }
    async restoreToInbox(req, leadId) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        const result = await this.leadsService.restoreToInbox(req.tenantId, leadId);
        if (!result)
            throw new common_1.NotFoundException("Lead no encontrado");
        return result;
    }
    async markStatus(req, leadId, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.leadsService.markAs(req.tenantId, leadId, body.status);
    }
    async markCobrado(req, leadId) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.leadsService.markAs(req.tenantId, leadId, "vendido");
    }
    async markDespachado(req, leadId) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.leadsService.markAs(req.tenantId, leadId, "caliente");
    }
    async releaseReservation(req, leadId) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.leadsService.releaseReservation(req.tenantId, leadId);
    }
};
exports.LeadsController = LeadsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("includeClosed")),
    __param(2, (0, common_1.Query)("includeArchived")),
    __param(3, (0, common_1.Query)("includeHiddenFromInbox")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], LeadsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(":leadId/hide-from-inbox"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("leadId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], LeadsController.prototype, "hideFromInbox", null);
__decorate([
    (0, common_1.Post)(":leadId/restore-to-inbox"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("leadId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], LeadsController.prototype, "restoreToInbox", null);
__decorate([
    (0, common_1.Patch)(":leadId/status"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("leadId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], LeadsController.prototype, "markStatus", null);
__decorate([
    (0, common_1.Patch)(":leadId/mark-cobrado"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("leadId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], LeadsController.prototype, "markCobrado", null);
__decorate([
    (0, common_1.Patch)(":leadId/mark-despachado"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("leadId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], LeadsController.prototype, "markDespachado", null);
__decorate([
    (0, common_1.Patch)(":leadId/release-reservation"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("leadId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], LeadsController.prototype, "releaseReservation", null);
exports.LeadsController = LeadsController = __decorate([
    (0, common_1.Controller)("leads"),
    __metadata("design:paramtypes", [leads_service_1.LeadsService])
], LeadsController);
