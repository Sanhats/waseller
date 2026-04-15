import { Controller, Get, Post, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";
import { AuthTokenPayload } from "../../../../../packages/shared/src";
import { requireRole } from "../../common/auth/require-role";
import { MercadoPagoService } from "./mercado-pago.service";

@Controller()
export class MercadoPagoController {
  constructor(private readonly mercadoPagoService: MercadoPagoService) {}

  @Get("integrations/mercadopago/connect-url")
  async connectUrl(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{ url: string }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.mercadoPagoService.getConnectUrl(req.tenantId);
  }

  @Get("integrations/mercadopago/status")
  async status(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    provider: "mercadopago";
    configured: boolean;
    status: "disconnected" | "connected" | "expired" | "error";
    accountId: string | null;
    accountLabel: string | null;
    publicKey: string | null;
    connectedAt: string | null;
    expiresAt: string | null;
    lastError: string | null;
  }> {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.mercadoPagoService.getStatus(req.tenantId);
  }

  @Post("integrations/mercadopago/disconnect")
  async disconnect(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{ disconnected: boolean }> {
    requireRole(req.auth?.role, ["admin"]);
    return this.mercadoPagoService.disconnect(req.tenantId);
  }

  @Get("integrations/mercadopago/callback")
  async callback(
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const html = await this.mercadoPagoService.handleCallback({
      code: String(req.query.code ?? ""),
      state: String(req.query.state ?? ""),
      error: String(req.query.error ?? ""),
      error_description: String(req.query.error_description ?? "")
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  }

  @Post("payments/mercadopago/webhook")
  async webhook(
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const result = await this.mercadoPagoService.handleWebhook({
      query: req.query as Record<string, unknown>,
      body: (req.body ?? {}) as Record<string, unknown>,
      headers: req.headers
    });
    res.status(200).json(result);
  }
}
