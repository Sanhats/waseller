/**
 * Inserta mensajes demo en `public.messages` para que el chat del dashboard
 * (`GET /api/conversations/:phone`) muestre hilo entrante/saliente.
 * Borra mensajes previos del mismo tenant+teléfono para poder re-ejecutar seeds.
 */

import type { MessageDirection } from "@prisma/client";
import { prisma } from "../../../packages/db/src";

export type DemoChatInput = {
  lastMessage: string;
  conversationStage: string;
  /** Si es manual_paused, el bot indica pausa humana */
  conversationState?: string;
};

function botReplyForDemo(input: DemoChatInput): string {
  if (input.conversationState === "manual_paused") {
    return "Tomamos nota. Un vendedor puede seguir el chat en breve; mientras tanto quedó en pausa.";
  }
  const stage = input.conversationStage;
  const byStage: Record<string, string> = {
    waiting_product: "Contame qué producto buscás o si preferís que te recomiende algo del catálogo.",
    waiting_variant: "Para esa remera tengo varias variantes. ¿Qué color y talle necesitás?",
    variant_offered: "Perfecto, esa combinación está disponible. ¿Querés que te reserve una unidad?",
    waiting_reservation_confirmation: "Cuando me confirmes si la reservamos, avanzo con el stock.",
    reserved_waiting_payment_method:
      "Listo, quedó reservada. ¿Preferís Mercado Pago o pagar en efectivo al retirar?",
    payment_link_sent:
      "Acá está el link de Mercado Pago. Cuando se acredite te avisamos por este chat.",
    waiting_payment_confirmation: "Gracias. En cuanto veamos el pago acreditado te lo confirmo.",
    sale_confirmed: "¡Listo! Gracias por tu compra. Cualquier cosa escribinos."
  };
  if (byStage[stage]) return byStage[stage];
  if (input.conversationState === "lead_closed") {
    return "Gracias por escribirnos. Si cambiás de opinión, acá estamos.";
  }
  return "Gracias por el mensaje. Seguimos a tu disposición.";
}

/**
 * Crea un hilo corto: saludo → bot → mensaje clave del cliente → respuesta del bot.
 */
export async function replaceAndInsertDemoMessages(
  tenantId: string,
  phone: string,
  input: DemoChatInput
): Promise<void> {
  await prisma.message.deleteMany({ where: { tenantId, phone } });

  const steps: Array<{ direction: MessageDirection; message: string }> = [
    { direction: "incoming", message: "Hola 👋" },
    { direction: "outgoing", message: "¡Hola! Gracias por escribirnos. ¿En qué te ayudo?" },
    { direction: "incoming", message: input.lastMessage },
    { direction: "outgoing", message: botReplyForDemo(input) }
  ];

  const base = Date.now() - steps.length * 90_000;
  for (let i = 0; i < steps.length; i++) {
    await prisma.message.create({
      data: {
        tenantId,
        phone,
        message: steps[i].message,
        direction: steps[i].direction,
        createdAt: new Date(base + i * 90_000)
      }
    });
  }
}
