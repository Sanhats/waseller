import {
  ActiveOfferV1,
  ConversationInterpretationV1,
  ConversationNextActionV1,
  ConversationStageV1,
  LlmDecisionV1
} from "../../../../packages/queue/src";

const SENSITIVE_ACTIONS = new Set<ConversationNextActionV1>(["reserve_stock", "share_payment_link", "close_lead"]);

export const normalizeConversationText = (value: string): string =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

export const resolveExpectedCustomerAction = (stage?: ConversationStageV1 | null): string | null => {
  switch (stage) {
    case "waiting_product":
      return "share_product";
    case "waiting_variant":
      return "choose_variant";
    case "variant_offered":
    case "waiting_reservation_confirmation":
      return "confirm_reservation";
    case "reserved_waiting_payment_method":
      return "choose_payment_method";
    case "payment_link_sent":
    case "waiting_payment_confirmation":
      return "confirm_payment";
    case "sale_confirmed":
      return "post_sale_ack";
    default:
      return null;
  }
};

export const resolveStageFromContext = (input: {
  previousStage?: ConversationStageV1 | null;
  intent?: string | null;
  hasVariant?: boolean;
  missingAxes?: string[];
  unavailableCombination?: boolean;
  hasReservation?: boolean;
  paymentLinkSent?: boolean;
  paymentApproved?: boolean;
}): ConversationStageV1 => {
  if (input.paymentApproved) return "sale_confirmed";
  if (input.paymentLinkSent) return "payment_link_sent";
  if (input.hasReservation) return "reserved_waiting_payment_method";
  if (input.unavailableCombination) return "waiting_variant";
  if ((input.missingAxes ?? []).length > 0) return "waiting_variant";
  if (input.hasVariant) return "waiting_reservation_confirmation";
  if (input.intent === "buscar_producto" || input.intent === "consultar_precio") return "waiting_variant";
  return input.previousStage ?? "waiting_product";
};

export const buildActiveOfferSnapshot = (input: {
  existing?: ActiveOfferV1 | null;
  productName?: string | null;
  variantId?: string | null;
  attributes?: Record<string, string>;
  price?: number | null;
  availableStock?: number | null;
  alternativeVariants?: Array<{ variantId?: string | null; attributes: Record<string, string>; availableStock?: number | null }>;
  expectedCustomerAction?: string | null;
}): ActiveOfferV1 | null => {
  const productName = String(input.productName ?? input.existing?.productName ?? "").trim();
  const variantId = String(input.variantId ?? input.existing?.variantId ?? "").trim();
  const attributes = input.attributes ?? input.existing?.attributes ?? {};
  const hasMeaningfulOffer = Boolean(productName || variantId || Object.keys(attributes).length > 0);
  if (!hasMeaningfulOffer) return input.existing ?? null;
  return {
    productName: (productName || input.existing?.productName) ?? null,
    variantId: (variantId || input.existing?.variantId) ?? null,
    attributes,
    price: input.price ?? input.existing?.price ?? null,
    availableStock: input.availableStock ?? input.existing?.availableStock ?? null,
    alternativeVariants: input.alternativeVariants ?? input.existing?.alternativeVariants ?? [],
    expectedCustomerAction: input.expectedCustomerAction ?? input.existing?.expectedCustomerAction ?? null
  };
};

export const resolvePolicyAction = (input: {
  interpretation?: ConversationInterpretationV1 | null;
  decision: LlmDecisionV1;
  shadowMode: boolean;
  allowSensitiveActions: boolean;
  requiresHuman: boolean;
  forbiddenActions?: string[];
  paymentMethods?: string[];
}): {
  recommendedAction: ConversationNextActionV1;
  executedAction: string;
  flags: string[];
} => {
  const flags: string[] = [];
  let recommendedAction = (input.interpretation?.nextAction ??
    input.decision.nextAction ??
    "reply_only") as ConversationNextActionV1;

  if ((input.forbiddenActions ?? []).includes(recommendedAction)) {
    recommendedAction = "ask_clarification";
    flags.push("rubro_forbidden_action");
  }
  if (recommendedAction === "share_payment_link" && !(input.paymentMethods ?? []).includes("link_pago")) {
    recommendedAction = "offer_reservation";
    flags.push("payment_method_link_not_allowed");
  }

  if (input.requiresHuman) {
    return { recommendedAction, executedAction: "handoff_human", flags };
  }
  if (input.shadowMode) {
    return { recommendedAction, executedAction: "shadow_recommendation_only", flags };
  }
  if (SENSITIVE_ACTIONS.has(recommendedAction) && !input.allowSensitiveActions) {
    flags.push("sensitive_action_blocked");
    return { recommendedAction, executedAction: "ask_clarification", flags };
  }
  return { recommendedAction, executedAction: recommendedAction, flags };
};
