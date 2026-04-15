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
exports.ProductsController = void 0;
const common_1 = require("@nestjs/common");
const require_role_1 = require("../../common/auth/require-role");
const products_service_1 = require("./products.service");
let ProductsController = class ProductsController {
    productsService;
    constructor(productsService) {
        this.productsService = productsService;
    }
    async list(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        return this.productsService.listByTenant(req.tenantId);
    }
    async create(req, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.productsService.createProduct(req.tenantId, body);
    }
    async addVariant(req, productId, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        const created = await this.productsService.addVariant(req.tenantId, productId, body);
        if (!created)
            throw new common_1.NotFoundException("Producto no encontrado");
        return created;
    }
    async adjust(req, variantId, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.productsService.adjustStock(req.tenantId, variantId, body);
    }
    async patchVariant(req, variantId, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.productsService.updateVariant(req.tenantId, variantId, body);
    }
    async movements(req) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor", "viewer"]);
        const limit = Number(req.query?.limit ?? 100);
        return this.productsService.listMovements(req.tenantId, Number.isFinite(limit) ? limit : 100);
    }
    async patchProduct(req, productId, body) {
        (0, require_role_1.requireRole)(req.auth?.role, ["admin", "vendedor"]);
        return this.productsService.updateProduct(req.tenantId, productId, body);
    }
};
exports.ProductsController = ProductsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "create", null);
__decorate([
    (0, common_1.Post)(":productId/variants"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("productId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "addVariant", null);
__decorate([
    (0, common_1.Patch)("variants/:variantId/adjust"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("variantId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "adjust", null);
__decorate([
    (0, common_1.Patch)("variants/:variantId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("variantId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "patchVariant", null);
__decorate([
    (0, common_1.Get)("movements"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "movements", null);
__decorate([
    (0, common_1.Patch)(":productId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("productId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "patchProduct", null);
exports.ProductsController = ProductsController = __decorate([
    (0, common_1.Controller)("products"),
    __metadata("design:paramtypes", [products_service_1.ProductsService])
], ProductsController);
