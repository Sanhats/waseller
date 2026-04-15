import { NextFunction, Request, Response } from "express";
import { AuthTokenPayload } from "../../../../../packages/shared/src";
import { verifyAuthToken } from "./token";

const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/register-tenant",
  "/api/messages/incoming",
  "/api/integrations/mercadopago/callback",
  "/api/payments/mercadopago/webhook"
];

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
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
  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  const request = req as Request & { tenantId?: string; auth?: AuthTokenPayload };
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
