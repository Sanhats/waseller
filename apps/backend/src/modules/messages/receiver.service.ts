import { Injectable } from "@nestjs/common";
import {
  JOB_SCHEMA_VERSION,
  buildCorrelationId,
  buildStableDedupeKey,
  incomingQueue
} from "../../../../../packages/queue/src";
import { IncomingMessageDto } from "./receiver.dto";

@Injectable()
export class MessageReceiverService {
  async enqueueIncoming(tenantId: string, payload: IncomingMessageDto): Promise<string> {
    const timestamp = payload.timestamp ?? new Date().toISOString();
    const dedupeKey = buildStableDedupeKey(
      tenantId,
      payload.phone,
      payload.externalMessageId,
      payload.message,
      timestamp
    );
    const job = await incomingQueue.add(
      "incoming-message-v1",
      {
        schemaVersion: JOB_SCHEMA_VERSION,
        correlationId: buildCorrelationId(),
        dedupeKey,
        tenantId,
        payload: {
          phone: payload.phone,
          message: payload.message,
          timestamp,
          externalMessageId: payload.externalMessageId,
          source: "api"
        },
        createdAt: new Date().toISOString()
      },
      {
        // BullMQ custom IDs cannot include ":" in this runtime.
        jobId: `incoming_${dedupeKey}`
      }
    );

    return job.id ?? "queued";
  }
}
