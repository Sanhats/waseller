/** Estados de fila `conversations.state` (control operativo del chat). */
export declare const CONVERSATION_STATE_LABELS_ES: Record<string, string>;
/**
 * Etapa del embudo en `conversation_memory.facts.conversationStage`
 * (alineado con `ConversationStageV1` en @waseller/queue).
 */
export declare const CONVERSATION_STAGE_LABELS_ES: Record<string, string>;
export declare function labelConversationState(state: string | null | undefined): string;
export declare function labelConversationStage(stage: string | null | undefined): string;
