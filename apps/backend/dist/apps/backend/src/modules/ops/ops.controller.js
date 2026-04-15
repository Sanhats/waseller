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
exports.OpsController = void 0;
const common_1 = require("@nestjs/common");
const require_role_1 = require("../../common/auth/require-role");
const ops_service_1 = require("./ops.service");
let OpsController = class OpsController {
    opsService;
    constructor(opsService) {
        this.opsService = opsService;
    }
    async queues(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.getQueuesOverview();
    }
    async funnel(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        const value = String(req.query.range ?? "7d").toLowerCase();
        const range = value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "7d";
        return this.opsService.getFunnelMetrics(req.tenantId, range);
    }
    async playbooks(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.getPlaybooks(req.tenantId);
    }
    async templates(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.getResponseTemplates(req.tenantId);
    }
    async updateTemplates(req, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.saveResponseTemplates(req.tenantId, body.templates ?? []);
    }
    async tenantKnowledge(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.getTenantKnowledge(req.tenantId);
    }
    async tenantKnowledgePresets(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.getTenantKnowledgePresets();
    }
    async updateTenantKnowledge(req, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.updateTenantKnowledge(req.tenantId, body ?? {});
    }
    async updatePlaybooks(req, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.savePlaybooks(req.tenantId, body.playbooks ?? []);
    }
    async tenantSettings(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.getTenantLlmSettings(req.tenantId);
    }
    async updateTenantSettings(req, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.updateTenantLlmSettings(req.tenantId, body ?? {});
    }
    async quality(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        const value = String(req.query.range ?? "7d").toLowerCase();
        const range = value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "7d";
        return this.opsService.getQualityMetrics(req.tenantId, range);
    }
    async playbookReport(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        const value = String(req.query.range ?? "7d").toLowerCase();
        const range = value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "7d";
        return this.opsService.getPlaybookVariantReport(req.tenantId, range);
    }
    async submitFeedback(req, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.opsService.createFeedback(req.tenantId, req.auth?.sub, body);
    }
    async evalDataset(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.getEvalDatasetSnapshot(req.tenantId);
    }
    async evalDatasetExport(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        const value = String(req.query.split ?? "").toLowerCase();
        const split = value === "train" || value === "val" || value === "test" || value === "holdout" ? value : undefined;
        return this.opsService.exportEvalDataset(req.tenantId, split);
    }
    async createEvalDatasetItem(req, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.createEvalDatasetItem(req.tenantId, body);
    }
    async updateEvalDatasetItem(req, itemId, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.updateEvalDatasetItem(req.tenantId, itemId, body);
    }
    async promoteFromFeedback(req, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin"]);
        return this.opsService.promoteEvalDatasetFromFeedback(req.tenantId, body ?? {});
    }
};
exports.OpsController = OpsController;
__decorate([
    (0, common_1.Get)("queues"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "queues", null);
__decorate([
    (0, common_1.Get)("funnel"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "funnel", null);
__decorate([
    (0, common_1.Get)("playbooks"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "playbooks", null);
__decorate([
    (0, common_1.Get)("templates"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "templates", null);
__decorate([
    (0, common_1.Put)("templates"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "updateTemplates", null);
__decorate([
    (0, common_1.Get)("tenant-knowledge"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "tenantKnowledge", null);
__decorate([
    (0, common_1.Get)("tenant-knowledge/presets"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "tenantKnowledgePresets", null);
__decorate([
    (0, common_1.Put)("tenant-knowledge"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "updateTenantKnowledge", null);
__decorate([
    (0, common_1.Put)("playbooks"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "updatePlaybooks", null);
__decorate([
    (0, common_1.Get)("tenant-settings"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "tenantSettings", null);
__decorate([
    (0, common_1.Put)("tenant-settings"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "updateTenantSettings", null);
__decorate([
    (0, common_1.Get)("quality"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "quality", null);
__decorate([
    (0, common_1.Get)("playbook-report"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "playbookReport", null);
__decorate([
    (0, common_1.Post)("feedback"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "submitFeedback", null);
__decorate([
    (0, common_1.Get)("eval-dataset"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "evalDataset", null);
__decorate([
    (0, common_1.Get)("eval-dataset/export"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "evalDatasetExport", null);
__decorate([
    (0, common_1.Post)("eval-dataset"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "createEvalDatasetItem", null);
__decorate([
    (0, common_1.Put)("eval-dataset/:itemId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("itemId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "updateEvalDatasetItem", null);
__decorate([
    (0, common_1.Post)("eval-dataset/from-feedback"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "promoteFromFeedback", null);
exports.OpsController = OpsController = __decorate([
    (0, common_1.Controller)("ops"),
    __metadata("design:paramtypes", [ops_service_1.OpsService])
], OpsController);
