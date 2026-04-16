"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONVERSATION_STAGE_LABELS_ES = exports.CONVERSATION_STATE_LABELS_ES = void 0;
exports.labelConversationState = labelConversationState;
exports.labelConversationStage = labelConversationStage;
/** Estados de fila `conversations.state` (control operativo del chat). */
exports.CONVERSATION_STATE_LABELS_ES = {
    open: "Bot activo",
    manual_paused: "Pausa manual",
    lead_closed: "Chat cerrado"
};
/**
 * Etapa del embudo en `conversation_memory.facts.conversationStage`
 * (alineado con `ConversationStageV1` en @waseller/queue).
 */
exports.CONVERSATION_STAGE_LABELS_ES = {
    waiting_product: "Buscando producto",
    waiting_variant: "Eligiendo variante",
    variant_offered: "Variante ofrecida",
    waiting_reservation_confirmation: "Confirma reserva",
    reserved_waiting_payment_method: "Reserva · medio de pago",
    payment_link_sent: "Link de pago enviado",
    waiting_payment_confirmation: "Confirma pago",
    sale_confirmed: "Venta confirmada"
};
function labelConversationState(state) {
    if (!state)
        return "—";
    return exports.CONVERSATION_STATE_LABELS_ES[state] ?? state;
}
function labelConversationStage(stage) {
    if (!stage)
        return "—";
    return exports.CONVERSATION_STAGE_LABELS_ES[stage] ?? stage;
}
