"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageReceiverService = void 0;
const common_1 = require("@nestjs/common");
const src_1 = require("../../../../../packages/queue/src");
let MessageReceiverService = class MessageReceiverService {
    async enqueueIncoming(tenantId, payload) {
        const timestamp = payload.timestamp ?? new Date().toISOString();
        const dedupeKey = (0, src_1.buildStableDedupeKey)(tenantId, payload.phone, payload.externalMessageId, payload.message, timestamp);
        const job = await src_1.incomingQueue.add("incoming-message-v1", {
            schemaVersion: src_1.JOB_SCHEMA_VERSION,
            correlationId: (0, src_1.buildCorrelationId)(),
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
        }, {
            // BullMQ custom IDs cannot include ":" in this runtime.
            jobId: `incoming_${dedupeKey}`
        });
        return job.id ?? "queued";
    }
};
exports.MessageReceiverService = MessageReceiverService;
exports.MessageReceiverService = MessageReceiverService = __decorate([
    (0, common_1.Injectable)()
], MessageReceiverService);
