import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";
import { tenantHeaderMiddleware } from "./common/tenant/tenant-header.middleware";
import { pinoHttpMiddleware } from "./common/logging/pino-http.middleware";
import { authMiddleware } from "./common/auth/auth.middleware";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors();
  app.use(pinoHttpMiddleware);
  app.use(tenantHeaderMiddleware);
  app.use(authMiddleware);
  app.setGlobalPrefix("api");
  await app.listen(Number(process.env.PORT ?? 3000));
}

bootstrap();
