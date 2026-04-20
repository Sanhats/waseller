"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyReplyGuardrails = exports.resolvePolicyAction = exports.buildActiveOfferSnapshot = exports.resolveStageFromContext = exports.resolveExpectedCustomerAction = exports.normalizeConversationText = void 0;
const SENSITIVE_ACTIONS = new Set(["reserve_stock", "share_payment_link", "close_lead"]);
const normalizeConversationText = (value) => String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
exports.normalizeConversationText = normalizeConversationText;
const resolveExpectedCustomerAction = (stage) => {
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
exports.resolveExpectedCustomerAction = resolveExpectedCustomerAction;
const resolveStageFromContext = (input) => {
    if (input.paymentApproved)
        return "sale_confirmed";
    if (input.paymentLinkSent)
        return "payment_link_sent";
    if (input.hasReservation)
        return "reserved_waiting_payment_method";
    if (input.unavailableCombination)
        return "waiting_variant";
    if ((input.missingAxes ?? []).length > 0)
        return "waiting_variant";
    if (input.hasVariant)
        return "waiting_reservation_confirmation";
    if (input.intent === "buscar_producto" || input.intent === "consultar_precio")
        return "waiting_variant";
    return input.previousStage ?? "waiting_product";
};
exports.resolveStageFromContext = resolveStageFromContext;
const buildActiveOfferSnapshot = (input) => {
    const productName = String(input.productName ?? input.existing?.productName ?? "").trim();
    const variantId = String(input.variantId ?? input.existing?.variantId ?? "").trim();
    const attributes = input.attributes ?? input.existing?.attributes ?? {};
    const hasMeaningfulOffer = Boolean(productName || variantId || Object.keys(attributes).length > 0);
    if (!hasMeaningfulOffer)
        return input.existing ?? null;
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
exports.buildActiveOfferSnapshot = buildActiveOfferSnapshot;
const resolvePolicyAction = (input) => {
    const flags = [];
    let recommendedAction = (input.interpretation?.nextAction ??
        input.decision.nextAction ??
        "reply_only");
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
exports.resolvePolicyAction = resolvePolicyAction;
const normalizeForPolicy = (value) => value.trim().replace(/\s+/g, " ");
/**
 * Misma lógica que el orquestador antes de enviar: evita respuestas vacías, eco o role confusion.
 */
const applyReplyGuardrails = (rawReply, guardrailFallbackMessage, incomingText, confidence, threshold) => {
    const flags = [];
    const cleaned = normalizeForPolicy(rawReply);
    const normalizedIncoming = normalizeForPolicy(incomingText).toLowerCase();
    const normalizedReply = cleaned.toLowerCase();
    if (cleaned.length < 5)
        flags.push("empty_reply");
    if (/garantizado|100% seguro|promesa total/i.test(cleaned))
        flags.push("overpromise");
    if (normalizedReply && normalizedReply === normalizedIncoming)
        flags.push("echo_reply");
    const roleConfusionPattern = /^(si+|sii+|dale|ok|perfecto)?\s*[,.-]?\s*(enviame|enviame|mandame|pasame|quiero)\b/i;
    const hasBusinessSignal = /(tenemos|precio|stock|reserva|asesor|podemos|te comparto|te paso|disponible)/i.test(cleaned);
    if (roleConfusionPattern.test(cleaned) && !hasBusinessSignal)
        flags.push("role_confusion");
    if (confidence < threshold)
        flags.push("low_confidence");
    if (flags.length > 0) {
        return {
            message: guardrailFallbackMessage,
            blocked: true,
            flags
        };
    }
    return { message: cleaned, blocked: false, flags };
};
exports.applyReplyGuardrails = applyReplyGuardrails;
