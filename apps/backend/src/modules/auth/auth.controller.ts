import { Body, Controller, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(
    @Req() req: Request & { tenantId?: string },
    @Body() body: { email: string; password: string; tenantId?: string }
  ): Promise<{ tenantId: string; token: string; expiresAt: string; role: string; email: string }> {
    return this.authService.login(body.email, body.password, body.tenantId ?? req.tenantId);
  }

  @Post("register-tenant")
  async registerTenant(
    @Body() body: { tenantName: string; whatsappNumber: string; email: string; password: string }
  ): Promise<{ tenantId: string; token: string; expiresAt: string; role: string; email: string }> {
    return this.authService.registerTenant(body);
  }
}
