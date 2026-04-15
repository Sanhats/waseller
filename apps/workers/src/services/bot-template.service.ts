import { prisma } from "../../../../packages/db/src";

type TemplateMap = Record<string, string>;

const CACHE_TTL_MS = Number(process.env.BOT_TEMPLATE_CACHE_MS ?? 60_000);

const DEFAULT_TEMPLATES: TemplateMap = {
  payment_report_received:
    "Gracias por avisar. Registramos el pago reportado de {product_name}. Un asesor lo valida y te confirmamos por este medio en breve.",
  payment_cash_available:
    "Perfecto, tu reserva de {product_name} está activa. Podemos tomar pago en efectivo al retiro. Si querés, te derivamos con un asesor para coordinar entrega y cierre.",
  payment_options_overview:
    "Para {product_name} podés pagar con Mercado Pago (link) o en efectivo al retiro. Precio ${price}. ¿Querés que te reserve una y avanzamos con la opción que prefieras?",
  payment_link_offer:
    "Perfecto, puedo ayudarte a avanzar con {product_name}. Precio ${price}. ¿Querés que te comparta el link de pago?",
  payment_link_generated:
    "Perfecto, te comparto el link de pago de {product_name}: {payment_url} Cuando se acredite te confirmamos por este medio.",
  payment_link_ready_for_review:
    "Perfecto, ya te estamos preparando el link de pago de {product_name}. En un instante te lo compartimos por este medio.",
  payment_link_unavailable:
    "Todavía no tenemos Mercado Pago conectado para generar el link de pago de {product_name}. Si querés, podemos coordinar pago en efectivo al retirar.",
  stock_offer:
    "{product_name} está en ${price} y tenemos {available_stock} unidad(es) disponibles. ¿Querés que te reserve una?",
  no_product_prompt:
    "Gracias por escribirnos. Decime qué producto estás buscando y te paso precio y disponibilidad al instante.",
  lead_no_product:
    "Gracias por escribirnos. Contame qué producto te interesa y te comparto precio y stock al instante.",
  manual_payment_validation:
    "Gracias por avisar. Registramos el pago reportado de {product_name}. Queda pendiente de validación por un asesor y te confirmamos por este medio en breve.",
  reservation_payment_link_handoff:
    "Perfecto, tu reserva de {product_name} está activa. Ya te derivamos con un asesor para enviarte el link de pago y cerrar la compra ahora.",
  reservation_active_recap:
    "Perfecto, ya dejamos {product_name} reservado para vos. Precio: ${price}. ¿Preferís Mercado Pago o efectivo al retirar?",
  reservation_no_stock_recap:
    "Perfecto, registramos tu intención para {product_name}. En este momento no hay unidades libres para reservar, ¿te aviso apenas ingrese stock?",
  size_no_stock:
    "De {product_name} no tenemos stock disponible en este momento. Si querés, te aviso cuando ingrese nuevamente.",
  size_with_options:
    "De {product_name} tenemos talle {sizes}. Precio ${price} y {available_stock} unidad(es) disponibles. ¿Te reservo una?",
  size_need_input:
    "Tenemos {product_name} disponible por ${price}. Decime qué talle buscás y te confirmo en el momento.",
  price_response:
    "{product_name} está en ${price}. Tenemos {available_stock} unidad(es) disponibles. ¿Querés que te reserve una?",
  price_no_stock:
    "{product_name} está en ${price}, pero ahora no tenemos stock disponible. ¿Te aviso apenas repongamos?",
  product_available:
    "Sí, tenemos {product_name}. Quedan {available_stock} unidad(es) y el precio es ${price}. ¿La reservamos?",
  product_unavailable:
    "Ahora mismo {product_name} está sin stock. Si querés, te aviso apenas vuelva a ingresar.",
  generic_product_response:
    "Te confirmo {product_name}: precio ${price} y {available_stock} unidad(es) disponibles. ¿Querés que te reserve una ahora?",
  generic_product_no_stock:
    "{product_name} tiene precio ${price}, pero por el momento no hay stock disponible.",
  payment_approved_auto:
    "Recibimos el pago de {product_name}. Ya quedó confirmado y seguimos por este medio con la entrega.",
  payment_pending_auto:
    "Tu pago de {product_name} quedó registrado como pendiente. Apenas se acredite te confirmamos por este medio.",
  payment_rejected_auto:
    "Vimos un inconveniente con el pago de {product_name}. Si querés, te generamos un nuevo link o seguimos con otra forma de pago.",
  orchestrator_guardrail_handoff:
    "Quiero asegurarme de darte la mejor respuesta. Te paso con un asesor para confirmar los detalles y ayudarte a cerrar la compra.",
  orchestrator_auto_handoff_summary:
    "Derivación automática a asesor por baja confianza o necesidad de atención humana."
};

const normalizeKey = (value: string): string => String(value ?? "").trim().toLowerCase();

const renderTemplate = (template: string, variables: Record<string, string | number | boolean | null | undefined>): string => {
  let output = template;
  for (const [key, value] of Object.entries(variables)) {
    output = output.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return output;
};

export class BotTemplateService {
  private cache = new Map<string, { expiresAt: number; templates: TemplateMap }>();

  private async loadTenantTemplates(tenantId: string): Promise<TemplateMap> {
    const now = Date.now();
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > now) return cached.templates;

    try {
      const rows = (await (prisma as any).$queryRaw`
        select key, template
        from public.bot_response_templates
        where tenant_id::text = ${tenantId}
          and is_active = true
      `) as Array<{ key: string; template: string }>;
      const merged: TemplateMap = { ...DEFAULT_TEMPLATES };
      for (const row of rows) {
        const key = normalizeKey(row.key);
        const template = String(row.template ?? "").trim();
        if (!key || !template) continue;
        merged[key] = template;
      }
      this.cache.set(tenantId, { expiresAt: now + CACHE_TTL_MS, templates: merged });
      return merged;
    } catch {
      const fallback = { ...DEFAULT_TEMPLATES };
      this.cache.set(tenantId, { expiresAt: now + CACHE_TTL_MS, templates: fallback });
      return fallback;
    }
  }

  async getTemplate(tenantId: string, key: string): Promise<string> {
    const templates = await this.loadTenantTemplates(tenantId);
    return templates[normalizeKey(key)] ?? DEFAULT_TEMPLATES[normalizeKey(key)] ?? "";
  }

  async render(
    tenantId: string,
    key: string,
    variables: Record<string, string | number | boolean | null | undefined>
  ): Promise<string> {
    const template = await this.getTemplate(tenantId, key);
    if (!template) return "";
    return renderTemplate(template, variables);
  }
}
