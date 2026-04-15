import { NextFunction, Request, Response } from "express";
import { TENANT_HEADER } from "../../../../../packages/shared/src";

const PATHS_REQUIRING_TENANT_HEADER = ["/api/messages/incoming"];

export const tenantHeaderMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const tenantId = req.headers[TENANT_HEADER] as string | undefined;
  if (!tenantId) {
    if (PATHS_REQUIRING_TENANT_HEADER.some((path) => req.path.startsWith(path))) {
      res.status(400).json({ message: "Missing x-tenant-id header" });
      return;
    }
    next();
    return;
  }
  (req as Request & { tenantId: string }).tenantId = tenantId;
  next();
};
