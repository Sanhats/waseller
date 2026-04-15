"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const src_1 = require("../../../../../packages/db/src");
const api_core_1 = require("@waseller/api-core");
function throwFromAuthError(e) {
    if (e.status === 401)
        throw new common_1.UnauthorizedException(e.message);
    if (e.status === 409)
        throw new common_1.ConflictException(e.message);
    throw new common_1.BadRequestException(e.message);
}
let AuthService = class AuthService {
    async login(email, password, tenantId) {
        const runtime = (0, api_core_1.authRuntimeEnvFromProcess)(process.env);
        const r = await (0, api_core_1.loginUser)(src_1.prisma, runtime, {
            email,
            password,
            tenantId
        });
        if (!r.ok)
            throwFromAuthError(r.error);
        return r.data;
    }
    async registerTenant(input) {
        const runtime = (0, api_core_1.authRuntimeEnvFromProcess)(process.env);
        const r = await (0, api_core_1.registerTenantUser)(src_1.prisma, runtime, input);
        if (!r.ok)
            throwFromAuthError(r.error);
        return r.data;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)()
], AuthService);
