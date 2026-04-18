import type { ConversationInterpretationV1, ConversationNextActionV1, LlmDecisionV1 } from "./contracts";
export type ValidationIssue = {
    path: string;
    message: string;
};
export declare const CONVERSATION_NEXT_ACTIONS: readonly ["reply_only", "ask_clarification", "confirm_variant", "offer_reservation", "reserve_stock", "share_payment_link", "suggest_alternative", "handoff_human", "close_lead", "manual_review"];
export declare const CONVERSATION_STAGES: readonly ["waiting_product", "waiting_variant", "variant_offered", "waiting_reservation_confirmation", "reserved_waiting_payment_method", "payment_link_sent", "waiting_payment_confirmation", "sale_confirmed"];
/**
 * Valida JSON externo (p. ej. salida de CrewAI) contra `ConversationInterpretationV1`.
 */
export declare function parseExternalConversationInterpretation(input: unknown): {
    ok: true;
    value: ConversationInterpretationV1;
} | {
    ok: false;
    error: string;
    issues: ValidationIssue[];
};
/**
 * Valida JSON externo contra `LlmDecisionV1`.
 */
export declare function parseExternalLlmDecision(input: unknown): {
    ok: true;
    value: LlmDecisionV1;
} | {
    ok: false;
    error: string;
    issues: ValidationIssue[];
};
export type ShadowCompareCandidateDecision = {
    draftReply?: string;
    intent?: string;
    nextAction?: ConversationNextActionV1;
    recommendedAction?: string;
    confidence?: number;
    reason?: string;
};
export type ShadowCompareHttpResponse = {
    candidateDecision?: ShadowCompareCandidateDecision;
    candidateInterpretation?: Partial<ConversationInterpretationV1>;
};
/**
 * Respuesta esperada del POST `LLM_SHADOW_COMPARE_URL` (campos opcionales para no forzar un contrato rígido al comparar).
 */
export declare function parseShadowCompareHttpResponse(input: unknown): {
    ok: true;
    value: ShadowCompareHttpResponse;
} | {
    ok: false;
    error: string;
    issues: ValidationIssue[];
};
export declare function summarizeDecisionDiff(baseline: Pick<LlmDecisionV1, "draftReply" | "intent" | "nextAction" | "confidence" | "recommendedAction">, candidate: ShadowCompareCandidateDecision): Record<string, string | boolean | number | null>;
/**
 * JSON Schema (draft-07) equivalente a `ConversationInterpretationV1` para herramientas externas.
 */
export declare const conversationInterpretationV1JsonSchema: {
    readonly $schema: "http://json-schema.org/draft-07/schema#";
    readonly title: "ConversationInterpretationV1";
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["intent", "confidence", "entities", "references", "missingFields", "nextAction", "source"];
    readonly properties: {
        readonly intent: {
            readonly type: "string";
        };
        readonly confidence: {
            readonly type: "number";
        };
        readonly entities: {
            readonly type: "object";
            readonly additionalProperties: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "number";
                }, {
                    readonly type: "boolean";
                }, {
                    readonly type: "null";
                }, {
                    readonly type: "object";
                    readonly additionalProperties: {
                        readonly type: "string";
                    };
                }];
            };
        };
        readonly references: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly required: readonly ["kind"];
                readonly properties: {
                    readonly kind: {
                        readonly type: "string";
                        readonly enum: readonly string[];
                    };
                    readonly value: {
                        readonly type: readonly ["string", "null"];
                    };
                    readonly axis: {
                        readonly type: readonly ["string", "null"];
                    };
                    readonly index: {
                        readonly type: readonly ["number", "null"];
                    };
                    readonly confidence: {
                        readonly type: "number";
                    };
                    readonly metadata: {
                        readonly type: "object";
                        readonly additionalProperties: {
                            readonly oneOf: readonly [{
                                readonly type: "string";
                            }, {
                                readonly type: "number";
                            }, {
                                readonly type: "boolean";
                            }, {
                                readonly type: "null";
                            }];
                        };
                    };
                };
            };
        };
        readonly conversationStage: {
            readonly type: "string";
            readonly enum: readonly string[];
        };
        readonly missingFields: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
        readonly nextAction: {
            readonly type: "string";
            readonly enum: readonly string[];
        };
        readonly source: {
            readonly type: "string";
            readonly enum: readonly string[];
        };
        readonly notes: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
    };
};
/**
 * JSON Schema (draft-07) equivalente a `LlmDecisionV1` para herramientas externas.
 */
export declare const llmDecisionV1JsonSchema: {
    readonly $schema: "http://json-schema.org/draft-07/schema#";
    readonly title: "LlmDecisionV1";
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["intent", "leadStage", "confidence", "entities", "nextAction", "reason", "requiresHuman", "recommendedAction", "draftReply", "handoffRequired", "qualityFlags", "source"];
    readonly properties: {
        readonly intent: {
            readonly type: "string";
        };
        readonly leadStage: {
            readonly type: "string";
            readonly enum: readonly string[];
        };
        readonly confidence: {
            readonly type: "number";
        };
        readonly entities: {
            readonly type: "object";
            readonly additionalProperties: {
                readonly oneOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "number";
                }, {
                    readonly type: "boolean";
                }, {
                    readonly type: "null";
                }];
            };
        };
        readonly nextAction: {
            readonly type: "string";
            readonly enum: readonly string[];
        };
        readonly reason: {
            readonly type: "string";
        };
        readonly requiresHuman: {
            readonly type: "boolean";
        };
        readonly policyBand: {
            readonly type: "string";
            readonly enum: readonly string[];
        };
        readonly executionMode: {
            readonly type: "string";
            readonly enum: readonly string[];
        };
        readonly policy: {
            readonly type: "object";
        };
        readonly verification: {
            readonly type: "object";
        };
        readonly recommendedAction: {
            readonly type: "string";
        };
        readonly draftReply: {
            readonly type: "string";
        };
        readonly handoffRequired: {
            readonly type: "boolean";
        };
        readonly qualityFlags: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
        readonly source: {
            readonly type: "string";
            readonly enum: readonly string[];
        };
        readonly provider: {
            readonly type: "string";
            readonly enum: readonly string[];
        };
        readonly model: {
            readonly type: "string";
        };
    };
};
