import { Body, Controller, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { MessageReceiverService } from "./receiver.service";
import { IncomingMessageDto } from "./receiver.dto";

@Controller("messages")
export class MessageReceiverController {
  constructor(private readonly receiverService: MessageReceiverService) {}

  @Post("incoming")
  async receiveIncoming(
    @Req() request: Request & { tenantId: string },
    @Body() body: IncomingMessageDto
  ): Promise<{ status: string; jobId: string }> {
    const jobId = await this.receiverService.enqueueIncoming(request.tenantId, body);
    return { status: "queued", jobId };
  }
}
