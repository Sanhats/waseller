"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./modules/app.module");
const tenant_header_middleware_1 = require("./common/tenant/tenant-header.middleware");
const pino_http_middleware_1 = require("./common/logging/pino-http.middleware");
const auth_middleware_1 = require("./common/auth/auth.middleware");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bufferLogs: true });
    app.enableCors();
    app.use(pino_http_middleware_1.pinoHttpMiddleware);
    app.use(tenant_header_middleware_1.tenantHeaderMiddleware);
    app.use(auth_middleware_1.authMiddleware);
    app.setGlobalPrefix("api");
    await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
