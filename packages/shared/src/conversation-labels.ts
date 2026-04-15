/** Estados de fila `conversations.state` (control operativo del chat). */
export const CONVERSATION_STATE_LABELS_ES: Record<string, string> = {
  open: "Bot activo",
  manual_paused: "Pausa manual",
  lead_closed: "Chat cerrado"
};

/**
 * Etapa del embudo en `conversation_memory.facts.conversationStage`
 * (alineado con `ConversationStageV1` en @waseller/queue).
 */
export const CONVERSATION_STAGE_LABELS_ES: Record<string, string> = {
  waiting_product: "Buscando producto",
  waiting_variant: "Eligiendo variante",
  variant_offered: "Variante ofrecida",
  waiting_reservation_confirmation: "Confirma reserva",
  reserved_waiting_payment_method: "Reserva · medio de pago",
  payment_link_sent: "Link de pago enviado",
  waiting_payment_confirmation: "Confirma pago",
  sale_confirmed: "Venta confirmada"
};

export function labelConversationState(state: string | null | undefined): string {
  if (!state) return "—";
  return CONVERSATION_STATE_LABELS_ES[state] ?? state;
}

export function labelConversationStage(stage: string | null | undefined): string {
  if (!stage) return "—";
  return CONVERSATION_STAGE_LABELS_ES[stage] ?? stage;
}
