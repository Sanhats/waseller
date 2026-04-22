"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentDetectionService = void 0;
class IntentDetectionService {
    normalize(text) {
        return text
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }
    hasAny(text, phrases) {
        return phrases.some((phrase) => text.includes(phrase));
    }
    businessKeywords = [
        "producto",
        "productos",
        "precio",
        "cuesta",
        "sale",
        "stock",
        "disponible",
        "disponibilidad",
        "hay",
        "comprar",
        "compro",
        "compra",
        "reserv",
        "apartar",
        "talle",
        "color",
        "modelo",
        "blanco",
        "negro",
        "rojo",
        "envio",
        "envíos",
        "entrega",
        "promocion",
        "promo",
        "oferta",
        "tenes",
        "tenés",
        "tienen",
        "paso a buscar",
        "retiro",
        "me lo llevo",
        "me la llevo",
        "cuanto",
        "vale",
        "queda",
        "quedan",
        "retiro por",
        "pasame link",
        "pasame el link",
        "pasame alias",
        "te transfiero",
        "te pago",
        "te abono",
        "quiero ese",
        "quiero esa",
        "me interesa",
        "mandame el link",
        "enviame el link",
        "asesor",
        "humano",
        "persona",
        "la otra",
        "la blanca",
        "la negra",
        "la roja"
    ];
    detect(message) {
        const text = this.normalize(message);
        const words = text.split(/\s+/).filter(Boolean);
        const shortText = text.trim();
        const isMostlyThanks = this.hasAny(text, ["gracias", "muchas gracias", "mil gracias"]) &&
            !this.hasAny(text, ["precio", "stock", "link", "pago", "compr", "reserv", "talle", "envio"]);
        const hasStrongBuySignal = this.hasAny(text, ["quiero", "comprar", "compro", "confirmo", "reserv", "apartar"]) &&
            this.hasAny(text, ["pasame", "alias", "link", "pago", "transfer", "efectivo"]);
        const asksHuman = this.hasAny(text, ["asesor", "humano", "persona", "vendedor", "hablar con alguien", "atencion humana"]) ||
            /hablar con (alguien|una persona|un asesor)/.test(text);
        const asksPaymentLink = /(pasame|enviame|mandame|compartime|compartime).*(link|checkout)/.test(text) ||
            this.hasAny(text, ["link de pago", "mandame link", "enviame link", "pasame el link"]);
        const asksAlternative = this.hasAny(text, [
            "que otra",
            "qué otra",
            "otra opcion",
            "otra opción",
            "alguna otra",
            "alguna opcion",
            "alguna opción",
            "tenes otra",
            "tienes otra",
            "la otra"
        ]) || /otra\b/.test(text);
        const rejectsOffer = this.hasAny(text, ["esa no", "no esa", "no me sirve", "no me va", "no me gusta", "prefiero otra"]) ||
            /^(no|nop|ni ahi|ni ah[ií])[.!? ]*$/.test(shortText);
        const acceptsOffer = /^(si|sí|si dale|sí dale|dale|de una|ok|oka|okey|perfecto|joya|me sirve|me va|voy con esa|esa quiero|la quiero|lo quiero)[.!? ]*$/.test(shortText) ||
            this.hasAny(text, ["dejame una", "dejame uno", "esa quiero", "voy con esa", "me sirve"]);
        const choosesVariantByReference = this.hasAny(text, ["la blanca", "la negra", "la roja", "la azul", "la de 39", "la de 40", "la otra", "esa"]) ||
            ((text.includes("talle") || text.includes("color")) && words.length <= 8);
        const asksShipping = this.hasAny(text, ["envio", "envío", "hacen envios", "hacen envíos", "mandan", "entrega", "correo", "moto"]);
        const asksPickup = this.hasAny(text, ["retiro", "retirar", "paso a buscar", "se retira", "retiro por", "paso manana", "paso mañana"]);
        const choosesPaymentMethod = this.hasAny(text, ["efectivo", "transferencia", "alias", "tarjeta", "debito", "débito", "credito", "crédito"]) &&
            !asksPaymentLink;
        if (isMostlyThanks)
            return "saludo";
        if (asksHuman)
            return "pedir_asesor";
        const paidReportPhrases = [
            "ya pague",
            "ya pagué",
            "pago realizado",
            "pagué",
            "pague",
            "ya transferi",
            "ya transferí",
            "te transferi",
            "te transferí",
            "transferencia hecha",
            "te mande el comprobante",
            "te mandé el comprobante",
            "envie comprobante",
            "envié comprobante"
        ];
        if (this.hasAny(text, paidReportPhrases)) {
            return "reportar_pago";
        }
        if (asksPaymentLink)
            return "pedir_link_pago";
        if (choosesPaymentMethod)
            return "elegir_medio_pago";
        if (asksShipping)
            return "preguntar_envio";
        if (asksPickup)
            return "preguntar_retiro";
        if (asksAlternative)
            return "pedir_alternativa";
        if (rejectsOffer)
            return "rechazar_oferta";
        if (acceptsOffer)
            return "aceptar_oferta";
        // Preguntas de catálogo (color/talle) deben ir antes de `choosesVariantByReference`: ese heurístico
        // trata cualquier mensaje corto con "color"/"talle" como elección de variante ("la negra", etc.),
        // y frases como "que colores tenes?" quedarían como `elegir_variante` en lugar de `consultar_*`.
        const asksWhichColors = /\b(que|cuales)\s+(color|colores)\b/.test(text) ||
            /\b(color|colores)\s+(tenes|tienen|hay|manejan)\b/.test(text) ||
            /\bde\s+que\s+(color|colores)\b/.test(text) ||
            /\botros\s+(color|colores)\b/.test(text) ||
            /\b(que|cuales)\s+otros\s+(color|colores)\b/.test(text);
        if (asksWhichColors)
            return "consultar_color";
        const asksWhichTalles = /\b(que|cuales)\s+(talle|talles|talla|tallas)\b/.test(text) ||
            /\b(talle|talles|talla|tallas)\s+(tenes|tienen|hay)\b/.test(text) ||
            /\bde\s+que\s+(talle|talles|talla|tallas)\b/.test(text);
        if (asksWhichTalles)
            return "consultar_talle";
        if (choosesVariantByReference)
            return text.includes("color") || /la\s+\w+/.test(text) ? "elegir_variante" : "consultar_talle";
        const confirmPhrases = [
            "quiero comprar",
            "comprar",
            "compro",
            "confirmo",
            "lo compro",
            "reserv",
            "apartar",
            "paso a buscar",
            "las paso a buscar",
            "manana paso",
            "me lo llevo",
            "me la llevo",
            "te confirmo",
            "pasame link",
            "pasame el link",
            "enviame el link",
            "enviame link",
            "enviame el link de pago",
            "enviame link de pago",
            "mandame el link",
            "mandame link",
            "pasame alias",
            "te transfiero",
            "te pago",
            "te abono",
            "quiero ese",
            "quiero esa"
        ];
        if (hasStrongBuySignal || this.hasAny(text, confirmPhrases)) {
            return "confirmar_compra";
        }
        if (text.includes("cancel"))
            return "cancelar";
        const pricePhrases = ["precio", "cuesta", "cuanto", "vale", "valor"];
        if (this.hasAny(text, pricePhrases))
            return "consultar_precio";
        if (text.includes("talle") ||
            text.includes("numero tenes") ||
            text.includes("número tenes") ||
            text.includes("que numero") ||
            text.includes("que talle")) {
            return "consultar_talle";
        }
        if (text.includes("color") || text.includes("de que color") || text.includes("qué color")) {
            return "consultar_color";
        }
        if (text.includes("stock") ||
            text.includes("hay") ||
            text.includes("tenes") ||
            text.includes("tenés") ||
            text.includes("tienen") ||
            text.includes("queda") ||
            text.includes("quedan") ||
            text.includes("disponible") ||
            text.includes("disponibilidad")) {
            return "buscar_producto";
        }
        if (text.includes("hola") || text.includes("buenas"))
            return "saludo";
        if (text.includes(",") || (text.includes(" y ") && words.length >= 4))
            return "multi_producto";
        if (text.includes("sin stock") || text.includes("agotado"))
            return "sin_stock";
        return "desconocida";
    }
    isBusinessRelated(message, hasMatchedProduct = false) {
        if (hasMatchedProduct)
            return true;
        const text = this.normalize(message);
        return this.businessKeywords.some((keyword) => text.includes(keyword));
    }
}
exports.IntentDetectionService = IntentDetectionService;
