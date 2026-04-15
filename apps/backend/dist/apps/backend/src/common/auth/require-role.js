"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = void 0;
const common_1 = require("@nestjs/common");
const requireRole = (role, allowed) => {
    if (!role || !allowed.includes(role)) {
        throw new common_1.ForbiddenException("No tienes permisos para esta operación");
    }
};
exports.requireRole = requireRole;
