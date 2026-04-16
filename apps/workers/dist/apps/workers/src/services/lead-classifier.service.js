"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadClassifierService = void 0;
const src_1 = require("../../../../packages/shared/src");
class LeadClassifierService {
    classify(intent, message) {
        const lower = message
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
        const score = (0, src_1.computeLeadScore)({
            askedPrice: intent === "consultar_precio" ||
                lower.includes("precio") ||
                lower.includes("cuanto") ||
                lower.includes("vale"),
            askedStock: intent === "buscar_producto" ||
                intent === "consultar_talle" ||
                intent === "consultar_color" ||
                intent === "elegir_variante" ||
                intent === "pedir_alternativa" ||
                lower.includes("stock") ||
                lower.includes("talle") ||
                lower.includes("color") ||
                lower.includes("tenes") ||
                lower.includes("tienen") ||
                lower.includes("hay") ||
                lower.includes("queda") ||
                lower.includes("quedan"),
            purchaseConfirmation: intent === "confirmar_compra" ||
                intent === "aceptar_oferta" ||
                intent === "pedir_link_pago" ||
                intent === "elegir_medio_pago" ||
                intent === "reportar_pago"
        });
        return {
            score,
            status: (0, src_1.scoreToLeadStatus)(score)
        };
    }
}
exports.LeadClassifierService = LeadClassifierService;
