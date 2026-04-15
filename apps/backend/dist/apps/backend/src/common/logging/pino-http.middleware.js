"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pinoHttpMiddleware = void 0;
const pino_http_1 = __importDefault(require("pino-http"));
exports.pinoHttpMiddleware = (0, pino_http_1.default)({
    level: process.env.LOG_LEVEL ?? "info",
    base: undefined,
    redact: ["req.headers.authorization"],
    serializers: {
        req(req) {
            return {
                method: req.method,
                url: req.url,
                tenantId: req.headers["x-tenant-id"]
            };
        }
    }
});
