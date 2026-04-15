"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const token_1 = require("./token");
const PUBLIC_PATHS = [
    "/api/auth/login",
    "/api/auth/register-tenant",
    "/api/messages/incoming",
    "/api/integrations/mercadopago/callback",
    "/api/payments/mercadopago/webhook"
];
const authMiddleware = (req, res, next) => {
    if (PUBLIC_PATHS.some((path) => req.path.startsWith(path))) {
        next();
        return;
    }
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        res.status(401).json({ message: "Missing Bearer token" });
        return;
    }
    const token = header.slice("Bearer ".length).trim();
    const payload = (0, token_1.verifyAuthToken)(token);
    if (!payload) {
        res.status(401).json({ message: "Invalid or expired token" });
        return;
    }
    const request = req;
    if (request.tenantId && payload.tenantId !== request.tenantId) {
        res.status(403).json({ message: "Token tenant mismatch" });
        return;
    }
    if (!request.tenantId) {
        request.tenantId = payload.tenantId;
    }
    request.auth = payload;
    next();
};
exports.authMiddleware = authMiddleware;
