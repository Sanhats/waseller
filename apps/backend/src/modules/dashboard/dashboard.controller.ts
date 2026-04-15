import { Controller, Get, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthTokenPayload } from "../../../../../packages/shared/src";
import { requireRole } from "../../common/auth/require-role";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("summary")
  async summary(@Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }) {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.dashboardService.getSummary(req.tenantId);
  }
}
