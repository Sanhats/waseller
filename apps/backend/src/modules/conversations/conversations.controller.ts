import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { AuthTokenPayload } from "../../../../../packages/shared/src";
import { requireRole } from "../../common/auth/require-role";
import { ConversationsService } from "./conversations.service";

@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get(":phone")
  async getConversation(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string
  ): Promise<unknown[]> {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.conversationsService.listMessages(req.tenantId, phone);
  }

  @Get(":phone/state")
  async getConversationState(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string
  ): Promise<{ state: string; botPaused: boolean; leadClosed: boolean }> {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.conversationsService.getState(req.tenantId, phone);
  }

  @Get(":phone/payment-links")
  async getPaymentLinks(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string
  ): Promise<
    Array<{
      id: string;
      status: string;
      title: string;
      amount: number;
      currency: string;
      checkoutUrl: string | null;
      sandboxCheckoutUrl: string | null;
      createdAt: string;
      updatedAt: string;
      paymentLinkSentAt: string | null;
      productName: string | null;
      variantAttributes: Record<string, string>;
      outboundMessagePreview: string | null;
    }>
  > {
    requireRole(req.auth?.role, ["admin", "vendedor", "viewer"]);
    return this.conversationsService.listPaymentReviews(req.tenantId, phone);
  }

  @Post(":phone/reply")
  async manualReply(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string,
    @Body() body: { message: string }
  ): Promise<{ queued: boolean }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.conversationsService.manualReply(req.tenantId, phone, body.message);
  }

  @Post(":phone/payment-links/prepare")
  async preparePaymentDraft(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string
  ): Promise<{ paymentAttemptId: string; checkoutUrl: string; reusedExisting: boolean }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.conversationsService.prepareDraftPaymentLink(req.tenantId, phone);
  }

  @Post(":phone/payment-links/:attemptId/send")
  async sendPaymentLink(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string,
    @Param("attemptId") attemptId: string
  ): Promise<{ queued: boolean; attemptId: string }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.conversationsService.sendPreparedPaymentLink(req.tenantId, phone, attemptId);
  }

  @Post(":phone/resolve")
  async resolveChat(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string
  ): Promise<{ state: string; botPaused: boolean }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.conversationsService.resolveChat(req.tenantId, phone);
  }

  @Post(":phone/reopen")
  async reopenChat(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string
  ): Promise<{ state: string; botPaused: boolean }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.conversationsService.reopenChat(req.tenantId, phone);
  }

  @Post(":phone/close-lead")
  async closeLead(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string
  ): Promise<{ state: string; botPaused: boolean; leadClosed: boolean }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.conversationsService.closeLead(req.tenantId, phone);
  }

  /** Oculta el contacto del listado de conversaciones (no borra mensajes ni el lead). */
  @Post(":phone/archive")
  async archiveFromInbox(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string
  ): Promise<{ ok: true }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.conversationsService.archiveFromInbox(req.tenantId, phone);
  }

  @Post(":phone/unarchive")
  async unarchiveFromInbox(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string
  ): Promise<{ ok: true }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.conversationsService.unarchiveFromInbox(req.tenantId, phone);
  }

  @Post(":phone/handoff")
  async handoffAssistive(
    @Req() req: Request & { tenantId: string; auth?: AuthTokenPayload },
    @Param("phone") phone: string,
    @Body() body: { reason?: string }
  ): Promise<{ state: string; botPaused: boolean; summary: string }> {
    requireRole(req.auth?.role, ["admin", "vendedor"]);
    return this.conversationsService.handoffAssistive(req.tenantId, phone, body.reason ?? "");
  }
}
