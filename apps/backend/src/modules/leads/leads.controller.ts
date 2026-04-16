import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthTokenPayload, LeadStatus } from "../../../../../packages/shared/src";
import { LeadsService } from "./leads.service";
import { requireRole } from "../../common/auth/require-role";

@Controller("leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  async list(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Query("includeClosed") includeClosed?: string,
    @Query("includeArchived") includeArchived?: string,
    @Query("includeHiddenFromInbox") includeHiddenFromInbox?: string,
    @Query("includeOrphanConversations") includeOrphanConversations?: string
  ): Promise<unknown[]> {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.leadsService.listByTenant(
      req.tenantId,
      includeClosed === "true" || includeClosed === "1",
      includeArchived === "true" || includeArchived === "1",
      includeHiddenFromInbox === "true" || includeHiddenFromInbox === "1",
      includeOrphanConversations === "true" || includeOrphanConversations === "1"
    );
  }

  @Post(":leadId/hide-from-inbox")
  async hideFromInbox(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("leadId") leadId: string
  ): Promise<{ ok: true }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    const result = await this.leadsService.hideFromInbox(req.tenantId, leadId);
    if (!result) throw new NotFoundException("Lead no encontrado");
    return result;
  }

  @Post(":leadId/restore-to-inbox")
  async restoreToInbox(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("leadId") leadId: string
  ): Promise<{ ok: true }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    const result = await this.leadsService.restoreToInbox(req.tenantId, leadId);
    if (!result) throw new NotFoundException("Lead no encontrado");
    return result;
  }

  @Patch(":leadId/status")
  async markStatus(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("leadId") leadId: string,
    @Body() body: { status: LeadStatus }
  ): Promise<unknown> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.leadsService.markAs(req.tenantId, leadId, body.status);
  }

  @Patch(":leadId/mark-cobrado")
  async markCobrado(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("leadId") leadId: string
  ): Promise<unknown> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.leadsService.markAs(req.tenantId, leadId, "vendido");
  }

  @Patch(":leadId/mark-despachado")
  async markDespachado(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("leadId") leadId: string
  ): Promise<unknown> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.leadsService.markAs(req.tenantId, leadId, "caliente");
  }

  @Patch(":leadId/release-reservation")
  async releaseReservation(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("leadId") leadId: string
  ): Promise<{ released: boolean }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.leadsService.releaseReservation(req.tenantId, leadId);
  }
}
