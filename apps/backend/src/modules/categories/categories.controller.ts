import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthTokenPayload } from "../../../../../packages/shared/src";
import { requireRole } from "../../common/auth/require-role";
import { CategoriesService } from "./categories.service";

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async list(@Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }) {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.categoriesService.listForTenant(req.tenantId);
  }

  @Post()
  async create(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body()
    body: {
      name: string;
      parentId?: string | null;
      slug?: string;
      sortOrder?: number;
      isActive?: boolean;
    }
  ) {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.categoriesService.create(req.tenantId, body);
  }

  @Patch(":id")
  async patch(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      parentId?: string | null;
      slug?: string;
      sortOrder?: number;
      isActive?: boolean;
    }
  ) {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.categoriesService.update(req.tenantId, id, body);
  }

  @Delete(":id")
  async del(@Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }, @Param("id") id: string) {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.categoriesService.remove(req.tenantId, id);
  }
}
