"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantHeaderMiddleware = void 0;
const src_1 = require("../../../../../packages/shared/src");
const PATHS_REQUIRING_TENANT_HEADER = ["/api/messages/incoming"];
const tenantHeaderMiddleware = (req, res, next) => {
    const tenantId = req.headers[src_1.TENANT_HEADER];
    if (!tenantId) {
        if (PATHS_REQUIRING_TENANT_HEADER.some((path) => req.path.startsWith(path))) {
            res.status(400).json({ message: "Missing x-tenant-id header" });
            return;
        }
        next();
        return;
    }
    req.tenantId = tenantId;
    next();
};
exports.tenantHeaderMiddleware = tenantHeaderMiddleware;
