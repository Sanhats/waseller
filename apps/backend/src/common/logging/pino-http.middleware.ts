import pinoHttp from "pino-http";

export const pinoHttpMiddleware = pinoHttp({
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
