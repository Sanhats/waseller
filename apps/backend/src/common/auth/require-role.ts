import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "../../../../../packages/shared/src";

export const requireRole = (role: UserRole | undefined, allowed: UserRole[]): void => {
  if (!role || !allowed.includes(role)) {
    throw new ForbiddenException("No tienes permisos para esta operación");
  }
};
