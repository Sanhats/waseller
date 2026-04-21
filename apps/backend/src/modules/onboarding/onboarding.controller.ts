import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";
import { AuthTokenPayload } from "../../../../../packages/shared/src";
import { requireRole } from "../../common/auth/require-role";
import { OnboardingService } from "./onboarding.service";

@Controller("onboarding")
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get("status")
  async status(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    generatedAt: string;
    tenantName: string;
    allCompleted: boolean;
    completionPercent: number;
    whatsapp: {
      tenantWhatsappNumber: string | null;
      sessionStatus: "connecting" | "connected" | "disconnected" | "qr_required" | "not_connected";
      qrAvailable: boolean;
      lastConnectedAt?: string;
      retries?: number;
      lastError?: string;
    };
    mercadoPago: {
      provider: "mercadopago";
      configured: boolean;
      status: "disconnected" | "connected" | "expired" | "error";
      accountId: string | null;
      accountLabel: string | null;
      publicKey: string | null;
      connectedAt: string | null;
      expiresAt: string | null;
      lastError: string | null;
    };
    steps: Array<{
      key: string;
      title: string;
      description: string;
      completed: boolean;
      href: string;
      metric: string;
    }>;
  }> {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.onboardingService.getStatus(req.tenantId);
  }

  @Get("whatsapp/session")
  async whatsappSession(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    tenantWhatsappNumber: string | null;
    sessionStatus: "connecting" | "connected" | "disconnected" | "qr_required" | "not_connected";
    qrAvailable: boolean;
    lastConnectedAt?: string;
    retries?: number;
    lastError?: string;
  }> {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.onboardingService.getWhatsappState(req.tenantId);
  }

  @Post("whatsapp/connect")
  async whatsappConnect(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Body() body?: { whatsappNumber?: string }
  ): Promise<{
    tenantWhatsappNumber: string | null;
    sessionStatus: "connecting" | "connected" | "disconnected" | "qr_required" | "not_connected";
    qrAvailable: boolean;
    lastConnectedAt?: string;
    retries?: number;
    lastError?: string;
  }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.onboardingService.connectWhatsapp(req.tenantId, body?.whatsappNumber);
  }

  @Post("whatsapp/disconnect")
  async whatsappDisconnect(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload }
  ): Promise<{
    tenantWhatsappNumber: string | null;
    sessionStatus: "connecting" | "connected" | "disconnected" | "qr_required" | "not_connected";
    qrAvailable: boolean;
    lastConnectedAt?: string;
    retries?: number;
    lastError?: string;
  }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.onboardingService.disconnectWhatsapp(req.tenantId);
  }

  @Get("whatsapp/qr.png")
  async whatsappQr(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Res() res: Response
  ): Promise<void> {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    const png = await this.onboardingService.getWhatsappQrPng(req.tenantId);
    if (!png) {
      res.status(404).json({ message: "QR no disponible" });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(png);
  }
}
