import { computeLeadScore, scoreToLeadStatus } from "../../../../packages/shared/src";
import type { LeadStatus } from "../../../../packages/shared/src";
import type { Intent } from "./intent-detection.service";

export class LeadClassifierService {
  classify(intent: Intent, message: string): { score: number; status: LeadStatus } {
    const lower = message
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const score = computeLeadScore({
      askedPrice:
        intent === "consultar_precio" ||
        lower.includes("precio") ||
        lower.includes("cuanto") ||
        lower.includes("vale"),
      askedStock:
        intent === "buscar_producto" ||
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
      purchaseConfirmation:
        intent === "confirmar_compra" ||
        intent === "aceptar_oferta" ||
        intent === "pedir_link_pago" ||
        intent === "elegir_medio_pago" ||
        intent === "reportar_pago"
    });

    return {
      score,
      status: scoreToLeadStatus(score)
    };
  }
}
